const statusEl = document.getElementById('status');
const rateEl = document.getElementById('rate');

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab;
}

document.getElementById('read').addEventListener('click', async () => {
  try {
    setStatus('Extracting main text…');
    const tab = await getActiveTab();
    if (!tab?.id) return setStatus('No active tab found.');

    // Ask background to inject + extract
    const rate = Number(rateEl.value);

    const res = await chrome.runtime.sendMessage(
        {type: 'READ_MAIN_BODY', tabId: tab.id, rate});

    if (res?.ok)
      setStatus('Reading…');
    else
      setStatus(res?.error || 'Failed.');
  } catch (e) {
    setStatus(String(e?.message || e));
  }
});

document.getElementById('stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'STOP_READING'});
  setStatus('Stopped.');
});
