const statusEl = document.getElementById('status');
const langEl = document.getElementById('lang');
const rateEl = document.getElementById('rate');
const voiceEl = document.getElementById('voice');
const toggleBtn = document.getElementById('toggleRead');
let readingMode = false;  // true => button means "Stop reading"

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setLang(lang) {
  langEl.textContent = `language: ${lang || '—'}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab;
}

async function updateDetectedLanguage() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return;

    const res = await chrome.runtime.sendMessage(
        {type: 'GET_DETECTED_LANGUAGE', tabId: tab.id});

    if (res?.lang)
      setLang(res.lang);
    else
      setLang('');
  } catch {
    setLang('');
  }
}

function sortVoices(voices) {
  return [...voices].sort((a, b) => {
    const la = (a.lang || '').toLowerCase();
    const lb = (b.lang || '').toLowerCase();
    if (la !== lb) return la.localeCompare(lb);
    return (a.voiceName || '').localeCompare(b.voiceName || '');
  });
}

async function loadVoices() {
  const voices = await chrome.tts.getVoices();
  const sorted = sortVoices(voices);

  const {selectedVoiceName} =
      await chrome.storage.sync.get({selectedVoiceName: ''});

  voiceEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Auto (match page language)';
  voiceEl.appendChild(placeholder);

  for (const v of sorted) {
    const opt = document.createElement('option');
    opt.value = v.voiceName || '';
    const lang = v.lang ? ` (${v.lang})` : '';
    const local = v.localService ? ' • local' : '';
    opt.textContent = `${v.voiceName || 'Unnamed'}${lang}${local}`;
    if (v.voiceName && v.voiceName === selectedVoiceName) opt.selected = true;
    voiceEl.appendChild(opt);
  }
}

function setToggleMode(isReading) {
  readingMode = isReading;
  toggleBtn.textContent = isReading ? 'Stop reading' : 'Read main body';
}

async function refreshTtsState() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return setToggleMode(false);

    const res = await chrome.runtime.sendMessage({type: 'GET_TTS_STATE'});

    // Only show "Stop reading" if speech is active AND it was started for this
    // tab.
    if (res?.ok && res.isSpeaking && res.tabId === tab.id)
      setToggleMode(true);
    else
      setToggleMode(false);
  } catch {
    setToggleMode(false);
  }
}

voiceEl.addEventListener('change', async () => {
  // If user picks a specific voice, store it. If they pick Auto, clear stored
  // selection.
  await chrome.storage.sync.set({selectedVoiceName: voiceEl.value});
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadVoices();
  setStatus('Idle');
  await refreshTtsState();
  await updateDetectedLanguage();
  setInterval(refreshTtsState, 500);
});

toggleBtn.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return;

    if (readingMode) {
      // Stop mode
      await chrome.runtime.sendMessage({type: 'STOP_READING'});
      setStatus('Stopped.');
      setToggleMode(false);
      return;
    }

    // Start mode (always reads from beginning)
    setStatus('Extracting main text…');

    const rate = Number(rateEl.value);
    const voiceName = voiceEl.value || '';  // empty => Auto

    const res = await chrome.runtime.sendMessage(
        {type: 'READ_MAIN_BODY', tabId: tab.id, rate, voiceName});

    if (!res?.ok) {
      setStatus(res?.error || 'Failed.');
      setToggleMode(false);
      return;
    }

    setLang(res.lang || '');
    setStatus('Reading…');
    setToggleMode(true);
  } catch (e) {
    setStatus(String(e?.message || e));
    setToggleMode(false);
  }
});

document.getElementById('pause').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'PAUSE_READING'});
  setStatus('Paused.');
});

document.getElementById('resume').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'RESUME_READING'});
  setStatus('Reading…');
});
