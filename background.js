const tabLangMap = new Map();

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

let stopRequested = false;

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
    if (msg?.type === 'PAUSE_READING') {
      chrome.tts.pause();
      return sendResponse({ok: true});
    }

    if (msg?.type === 'RESUME_READING') {
      chrome.tts.resume();
      return sendResponse({ok: true});
    }

    if (msg?.type === 'STOP_READING') {
      stopRequested = true;
      chrome.tts.stop();
      return sendResponse({ok: true});
    }

    if (msg?.type === 'READ_MAIN_BODY') {
      stopRequested = false;

      const {tabId, rate, voiceName} = msg;
      if (!tabId) return sendResponse({ok: false, error: 'Missing tabId.'});

      await ensureScriptsInjected(tabId);

      // Ask the content script to extract the main body text.
      const extracted =
          await chrome.tabs.sendMessage(tabId, {type: 'EXTRACT_MAIN_TEXT'});
      const text = extracted?.text?.trim();
      const lang = extracted?.lang || '';

      if (!text)
        return sendResponse(
            {ok: false, error: 'No readable main text found on this page.'});

      // Stop any previous speech, then speak in chunks.
      chrome.tts.stop();

      const chunks = chunkText(text);
      let idx = 0;

      let voiceNameUsed = (voiceName || '').trim();
      // If popup is in Auto mode (voiceName is empty), pick a matching voice.
      if (!voiceNameUsed) {
        voiceNameUsed = await pickVoiceForLang(lang);
      }

      const speakNext = () => {
        if (stopRequested) return;
        if (idx >= chunks.length) return;

        chrome.tts.speak(chunks[idx], {
          rate: typeof rate === 'number' ? rate : 1.0,
          voiceName: voiceNameUsed || undefined,
          lang: lang || undefined,
          enqueue: false,
          onEvent: (ev) => {
            if (stopRequested) return;

            if (ev.type === 'end') {
              idx += 1;
              speakNext();
            } else if (ev.type === 'error') {
              // Skip problematic chunk and continue.
              idx += 1;
              speakNext();
            }
          }
        });
      };

      speakNext();
      return sendResponse({ok: true, lang, voiceNameUsed: voiceNameUsed || ''});
    }

    if (msg?.type === 'GET_DETECTED_LANGUAGE') {
      const lang = tabLangMap.get(msg.tabId) || '';
      return sendResponse({ok: true, lang});
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
