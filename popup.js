const statusEl = document.getElementById('status');
const langEl = document.getElementById('lang');
const rateLabelEl = document.getElementById('rateLabel');
const rateEl = document.getElementById('rate');
const voiceEl = document.getElementById('voice');
const startStopButton = document.getElementById('toggleStartStop');
const pauseResumeButton = document.getElementById('togglePauseResume');
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

function setRateLabel(value) {
  const v = Number(value);
  rateLabelEl.textContent = `Speed: ${v.toFixed(1)}×`;
}

async function updateDetectedLanguage() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      return;
    }

    const res = await chrome.runtime.sendMessage(
        {type: 'GET_DETECTED_LANGUAGE', tabId: tab.id});

    if (res?.lang) {
      setLang(res.lang);
    } else {
      setLang('');
    }
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
    if (v.voiceName && v.voiceName === selectedVoiceName) {
      opt.selected = true;
    }
    voiceEl.appendChild(opt);
  }
}

function setStartStopButtonModes(isReading) {
  readingMode = isReading;
  startStopButton.textContent = isReading ? 'Stop reading' : 'Read main body';

  // Enable pause/resume only while reading
  pauseResumeButton.disabled = !isReading;
  if (!isReading) {
    pauseResumeButton.textContent = 'Pause';
  }
}

function setPauseResumeButtonMode(isReading, isPaused) {
  pauseResumeButton.disabled = !isReading;
  if (isReading) {
    pauseResumeButton.textContent = isPaused ? 'Resume' : 'Pause';
  } else {
    pauseResumeButton.textContent = 'Pause/Resume';
  }
}

async function refreshButtonStates() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      setStartStopButtonModes(false);
      setPauseResumeButtonMode(false);
    } else {
      const res = await chrome.runtime.sendMessage({type: 'GET_BUTTON_STATES'});

      // Only show "Stop reading" if speech is active AND it was started for
      // this tab.
      const activeForThisTab =
          res?.ok && res.isSpeaking && res.tabId === tab.id;
      setStartStopButtonModes(!!activeForThisTab);
      setPauseResumeButtonMode(!!activeForThisTab, !!res.isPaused);
    }
  } catch {
    setStartStopButtonModes(false);
    setPauseResumeButtonMode(false);
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
  setRateLabel(rateEl.value);
  await updateDetectedLanguage();
  await refreshButtonStates();
  setInterval(refreshButtonStates, 500);
});

startStopButton.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return;

    if (readingMode) {
      // Stop mode
      await chrome.runtime.sendMessage({type: 'STOP_READING'});
      setStatus('Stopped.');
      setStartStopButtonModes(false);
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
      setStartStopButtonModes(false);
      return;
    }

    setLang(res.lang || '');
    setStatus('Reading…');
    setStartStopButtonModes(true);
  } catch (e) {
    setStatus(String(e?.message || e));
    setStartStopButtonModes(false);
  }
});

pauseResumeButton.addEventListener('click', async () => {
  if (pauseResumeButton.disabled) return;

  try {
    const res = await chrome.runtime.sendMessage({type: 'TOGGLE_PAUSE_RESUME'});
    if (!res?.ok) return;

    pauseResumeButton.textContent = res.isPaused ? 'Resume' : 'Pause';
    setStatus(res.isPaused ? 'Paused.' : 'Reading…');
  } catch {
    // ignore
  }
});

rateEl.addEventListener('input', () => {
  setRateLabel(rateEl.value);
});
