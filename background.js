const tabLangMap = new Map();
let isSpeaking = false;
let isPaused = false;
let currentTabId = null;
let readingRate = 1.0;
let stopRequested = false;

let job = {
  sentences: [],
  total: 0,
  idx: 0,  // 0-based current sentence index
  currentSentenceText: '',
  lang: '',
  voiceNameUsed: '',
  readingRate
};

function splitIntoSentences(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];

  // Split on sentence end punctuation followed by space + a likely next
  // sentence start. Also splits on line breaks that Readability might preserve.
  const parts = t.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9“"(\[])/g);

  // Fallback: if we didn’t split much (e.g. all lowercase), do a softer split.
  const rough = parts.length < 3 ? t.split(/(?<=[.!?])\s+/g) : parts;

  return rough.map(s => s.trim()).filter(s => s.length > 0);
}


// Reads long text in chunks so Chrome TTS doesn't truncate.
function chunkText(text, maxLen = 1500) {
  const chunks = [];
  let i = 0;

  while (i < text.length) {
    const slice = text.slice(i, i + maxLen);

    // Try to break at a sentence boundary.
    let cut = Math.max(
        slice.lastIndexOf('. '), slice.lastIndexOf('! '),
        slice.lastIndexOf('? '), slice.lastIndexOf('\n'));

    if (cut < 200) cut = slice.lastIndexOf(' ');  // fallback
    if (cut < 1) cut = slice.length;

    chunks.push(slice.slice(0, cut + 1).trim());
    i += cut + 1;
  }
  return chunks.filter(Boolean);
}

async function ensureScriptsInjected(tabId) {
  // Inject Readability + content extractor on demand.
  await chrome.scripting.executeScript(
      {target: {tabId}, files: ['readability.js', 'content.js']});
}

function normalizeLang(lang) {
  return (lang || '').toLowerCase().replace('_', '-').trim();
}

function primaryLang(lang) {
  const l = normalizeLang(lang);
  return l.split('-')[0] || '';
}

async function pickVoiceForLang(lang) {
  const target = normalizeLang(lang);
  const primary = primaryLang(lang);
  if (!target && !primary) return '';

  const voices = await chrome.tts.getVoices();

  // Score voices: prefer exact lang match, then primary match, prefer local
  // service
  function score(v) {
    const vLang = normalizeLang(v.lang);
    let s = 0;

    if (target && vLang === target) s += 100;
    if (primary && vLang.startsWith(primary + '-')) s += 60;
    if (primary && vLang === primary) s += 55;

    if (v.localService) s += 10;

    return s;
  }

  let best = null;
  let bestScore = 0;

  for (const v of voices) {
    const s = score(v);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }

  return bestScore > 0 ? (best.voiceName || '') : '';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'TOGGLE_PAUSE_RESUME') {
      if (!isSpeaking) return sendResponse({ok: false, error: 'Not reading.'});

      if (isPaused) {
        chrome.tts.resume();
        isPaused = false;
        return sendResponse({ok: true, isPaused});
      } else {
        chrome.tts.pause();
        isPaused = true;
        return sendResponse({ok: true, isPaused});
      }
    }

    if (msg?.type === 'STOP_READING') {
      stopRequested = true;
      chrome.tts.stop();
      isSpeaking = false;
      isPaused = false;
      currentTabId = null;
      job = {
        sentences: [],
        total: 0,
        idx: 0,
        currentSentenceText: '',
        lang: '',
        voiceNameUsed: '',
        readingRate
      };
      return sendResponse({ok: true});
    }

    if (msg?.type === 'READ_MAIN_BODY') {
      // Stop any previous speech, then speak in chunks.
      stopRequested = true;
      chrome.tts.stop();

      const {tabId, rate, voiceName} = msg;
      if (!tabId) return sendResponse({ok: false, error: 'Missing tabId.'});

      await ensureScriptsInjected(tabId);

      // Ask the content script to extract the main body text.
      const extracted =
          await chrome.tabs.sendMessage(tabId, {type: 'EXTRACT_MAIN_TEXT'});
      const text = extracted?.text?.trim();

      if (!text) {
        return sendResponse(
            {ok: false, error: 'No readable main text found on this page.'});
      }

      const sentences = splitIntoSentences(text);
      if (!sentences.length) {
        return sendResponse({ok: false, error: 'No readable sentences found.'});
      }
      job.sentences = sentences;
      job.total = sentences.length;
      job.idx = 0;
      job.currentSentenceText = '';
      job.lang = extracted?.lang || '';
      job.rate = typeof rate === 'number' ? rate : 1.0;
      job.voiceNameUsed = (voiceName || '').trim();
      // If popup is in Auto mode (voiceName is empty), pick a matching voice.
      if (!job.voiceNameUsed) {
        job.voiceNameUsed = await pickVoiceForLang(job.lang);
      }

      const speakNextSentence = () => {
        if (stopRequested || job.idx >= job.total) {
          isSpeaking = false;
          isPaused = false;
          currentTabId = null;
          return;
        }

        const sentence = job.sentences[job.idx];
        job.currentSentenceText = sentence;

        chrome.tts.speak(sentence, {
          rate: readingRate,
          voiceName: job.voiceNameUsed || undefined,
          lang: job.lang || undefined,
          enqueue: false,
          onEvent: (ev) => {
            if (stopRequested) {
              return;
            }

            if (ev.type === 'end' || ev.type === 'error') {
              // Skip problematic chunk and continue.
              job.idx += 1;
              speakNextSentence();
            } else if (ev.type === 'interrupted') {
              // stopRequested was already checked above, so we're updating the
              // reading rate.
              speakNextSentence();
            }
          }
        });
      };

      isSpeaking = true;
      isPaused = false;
      currentTabId = tabId;
      stopRequested = false;
      speakNextSentence();

      return sendResponse(
          {ok: true, lang: job.lang, voiceNameUsed: job.voiceNameUsed || ''});
    }

    if (msg?.type === 'GET_DETECTED_LANGUAGE') {
      const lang = tabLangMap.get(msg.tabId) || '';
      return sendResponse({ok: true, lang});
    }

    if (msg?.type === 'GET_BUTTON_STATES') {
      return sendResponse(
          {ok: true, isSpeaking, isPaused, tabId: currentTabId});
    }

    if (msg?.type === 'SET_READING_RATE') {
      readingRate = typeof msg.readingRate === 'number' ? msg.readingRate : 1.0;
      if (isSpeaking) {
        chrome.tts.stop();
      }
      return sendResponse({ok: true});
    }

    if (msg?.type === 'GET_READING_RATE') {
      return sendResponse({ok: true, readingRate});
    }

    if (msg?.type === 'GET_PROGRESS_STATE') {
      return sendResponse({
        ok: true,
        isSpeaking,
        isPaused,
        tabId: currentTabId,
        totalSentences: job.total,
        currentSentenceIndex: job.idx,
        currentSentenceText: job.currentSentenceText || ''
      });
    }


    sendResponse({ok: false, error: 'Unknown message type.'});
  })().catch((e) => sendResponse({ok: false, error: String(e?.message || e)}));

  // Keep the message channel open for async response.
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url || !tabId) return;

  (async () => {
    try {
      await chrome.scripting.executeScript(
          {target: {tabId}, files: ['readability.js', 'content.js']});

      const res =
          await chrome.tabs.sendMessage(tabId, {type: 'DETECT_LANGUAGE_ONLY'});

      if (res?.lang) {
        tabLangMap.set(tabId, res.lang);
      }
    } catch {
      // Ignore injection failures (chrome:// pages, PDFs, etc.)
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabLangMap.delete(tabId);
});
