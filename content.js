chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'EXTRACT_MAIN_TEXT') return;

  try {
    // Prefer Readability extraction (best for "ignore menus" behavior).
    const docClone = document.cloneNode(true);

    // Remove obvious junk from the clone to help Readability.
    for (const sel
             of ['nav', 'header', 'footer', 'aside', '[role=\'navigation\']',
                 '[role=\'banner\']', '[role=\'contentinfo\']', '.menu',
                 '.navbar', '.sidebar', '.toc', '.ads', '.advert', '.cookie',
                 '.modal', '.popup']) {
      docClone.querySelectorAll(sel).forEach((el) => el.remove());
    }

    let text = '';
    if (typeof Readability === 'function') {
      const article = new Readability(docClone).parse();
      text = (article?.textContent || '').trim();
    }

    // Fallback: try <main>, then biggest text container.
    if (!text) {
      const main = document.querySelector('main');
      if (main) text = main.innerText.trim();
    }

    if (!text) {
      // Heuristic: pick the element with the most text.
      const candidates =
          Array.from(document.querySelectorAll('article, section, div'));
      let best = null;
      let bestLen = 0;
      for (const el of candidates) {
        const t = (el.innerText || '').trim();
        const len = t.length;
        if (len > bestLen) {
          bestLen = len;
          best = t;
        }
      }
      text = (best || '').trim();
    }

    // Final cleanup: collapse whitespace.
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    sendResponse({ok: true, text});
  } catch (e) {
    sendResponse({ok: false, text: '', error: String(e?.message || e)});
  }

  return true;
});
