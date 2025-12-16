const statusEl = document.getElementById('status');
const rateEl = document.getElementById('rate');
const voiceEl = document.getElementById('voice');

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab;
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
  placeholder.textContent = 'Default voice';
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
  await chrome.storage.sync.set({selectedVoiceName: voiceEl.value});
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadVoices();
    setStatus('Idle');
  } catch (e) {
    setStatus('Failed to load voices.');
  }
});

document.getElementById('read').addEventListener('click', async () => {
  try {
    setStatus('Extracting main text…');
    const tab = await getActiveTab();
    if (!tab?.id) return setStatus('No active tab found.');

    const rate = Number(rateEl.value);
    const voiceName = voiceEl.value || '';

    const res = await chrome.runtime.sendMessage(
        {type: 'READ_MAIN_BODY', tabId: tab.id, rate, voiceName});

    if (res?.ok)
      setStatus('Reading…');
    else
      setStatus(res?.error || 'Failed.');
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
