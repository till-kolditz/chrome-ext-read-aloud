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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'STOP_READING') {
      stopRequested = true;
      chrome.tts.stop();
      return sendResponse({ok: true});
    }

    if (msg?.type === 'READ_MAIN_BODY') {
      stopRequested = false;

      const {tabId, rate} = msg;
      if (!tabId) return sendResponse({ok: false, error: 'Missing tabId.'});

      await ensureScriptsInjected(tabId);

      // Ask the content script to extract the main body text.
      const extracted =
          await chrome.tabs.sendMessage(tabId, {type: 'EXTRACT_MAIN_TEXT'});
      const text = extracted?.text?.trim();

      if (!text)
        return sendResponse(
            {ok: false, error: 'No readable main text found on this page.'});

      // Stop any previous speech, then speak in chunks.
      chrome.tts.stop();

      const chunks = chunkText(text);
      let idx = 0;

      const speakNext = () => {
        if (stopRequested) return;

        if (idx >= chunks.length) return;

        chrome.tts.speak(chunks[idx], {
          rate: typeof rate === 'number' ? rate : 1.0,
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
      return sendResponse({ok: true});
    }

    sendResponse({ok: false, error: 'Unknown message type.'});
  })().catch((e) => sendResponse({ok: false, error: String(e?.message || e)}));

  // Keep the message channel open for async response.
  return true;
});
