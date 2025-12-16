const statusEl = document.getElementById('status');
const langEl = document.getElementById('lang');
const rateEl = document.getElementById('rate');
const voiceEl = document.getElementById('voice');

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

voiceEl.addEventListener('change', async () => {
  // If user picks a specific voice, store it. If they pick Auto, clear stored
  // selection.
  await chrome.storage.sync.set({selectedVoiceName: voiceEl.value});
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadVoices();
  setStatus('Idle');
  await updateDetectedLanguage();
});

document.getElementById('read').addEventListener('click', async () => {
  try {
    setStatus('Extracting main text…');
    const tab = await getActiveTab();
    if (!tab?.id) return setStatus('No active tab found.');

    const rate = Number(rateEl.value);

    // If voice dropdown is on Auto (empty string), send empty voiceName.
    const voiceName = voiceEl.value || '';

    const res = await chrome.runtime.sendMessage(
        {type: 'READ_MAIN_BODY', tabId: tab.id, rate, voiceName});

    if (!res?.ok) {
      setStatus(res?.error || 'Failed.');
      return;
    }

    setLang(res.lang || '');
    setStatus('Reading…');
  } catch (e) {
    setStatus(String(e?.message || e));
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

document.getElementById('stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'STOP_READING'});
  setStatus('Stopped.');
});
