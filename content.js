function normalize(text) {
  return (text || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
}

function detectLangFromDom() {
  // 1) <html lang="...">
  const htmlLang = document.documentElement?.getAttribute('lang');
  if (htmlLang && htmlLang.trim()) return htmlLang.trim().toLowerCase();

  // 2) meta hints
  const metaHttpEquiv =
      document.querySelector('meta[http-equiv="content-language"]')
          ?.getAttribute('content');
  if (metaHttpEquiv && metaHttpEquiv.trim())
    return metaHttpEquiv.trim().toLowerCase();

  const metaLang =
      document.querySelector('meta[name="language"]')?.getAttribute('content');
  if (metaLang && metaLang.trim()) return metaLang.trim().toLowerCase();

  const ogLocale = document.querySelector('meta[property="og:locale"]')
                       ?.getAttribute('content');
  if (ogLocale && ogLocale.trim())
    return ogLocale.trim().replace('_', '-').toLowerCase();

  return '';
}

function inferLangFromTextSample(text) {
  // Very lightweight heuristic: detect a few common languages from stop-words.
  // (No external libraries. Keeps privacy: all local.)
  const sample = (text || '').slice(0, 3000).toLowerCase();
  if (!sample) return '';

  const scores = {en: 0, de: 0, fr: 0, es: 0, it: 0, nl: 0};

  // super-common stopwords (tiny list on purpose)
  const patterns = {
    en: /\b(the|and|that|with|from|this|are|was|were|have|has|will)\b/g,
    de: /\b(der|die|das|und|mit|nicht|auf|für|ist|sind|war|haben)\b/g,
    fr: /\b(le|la|les|et|des|une|dans|pour|est|sont|avec|sur)\b/g,
    es: /\b(el|la|los|las|y|una|para|con|del|que|está|son|sobre)\b/g,
    it: /\b(il|lo|la|gli|le|e|una|per|con|del|che|sono|sulla)\b/g,
    nl: /\b(de|het|een|en|van|met|voor|dat|zijn|was|hebben|op)\b/g
  };

  for (const [lang, re] of Object.entries(patterns)) {
    const m = sample.match(re);
    scores[lang] = m ? m.length : 0;
  }

  let best = '';
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }

  // Require some confidence
  return bestScore >= 6 ? best : '';
}

function linkDensity(el) {
  const textLength = (el.innerText || '').length;
  if (!textLength) return 0;
  let linkTextLength = 0;
  el.querySelectorAll('a').forEach(a => {
    linkTextLength += (a.innerText || '').length;
  });
  return linkTextLength / textLength;
}

function pruneLowValueSections(container) {
  if (!container) return;
  const blocks = Array.from(container.children);
  for (const el of blocks) {
    const text = (el.innerText || '').trim();
    const textLen = text.length;

    if (textLen < 80) {
      el.remove();
      continue;
    }
    if (linkDensity(el) > 0.4) {
      el.remove();
      continue;
    }

    const role = el.getAttribute('role');
    if (role && ['navigation', 'contentinfo', 'complementary'].includes(role)) {
      el.remove();
      continue;
    }

    const cls = (el.className || '').toLowerCase();
    if (cls.includes('related') || cls.includes('popular') ||
        cls.includes('trending') || cls.includes('sidebar') ||
        cls.includes('footer') || cls.includes('promo') ||
        cls.includes('advert')) {
      el.remove();
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'EXTRACT_MAIN_TEXT') return;

  try {
    // --- Extract text (same approach as before) ---
    const docClone = document.cloneNode(true);

    docClone
        .querySelectorAll(
            'nav, header, footer, aside,' +
            '[role=\'navigation\'], [role=\'banner\'], [role=\'contentinfo\'],' +
            '.menu, .navbar, .sidebar, .toc, .ads, .advert, .cookie, .consent, .modal, .popup')
        .forEach(el => el.remove());

    let text = '';
    if (typeof Readability === 'function') {
      const article = new Readability(docClone).parse();
      text = article?.textContent || '';
    }
    text = normalize(text);

    if (!text || text.length < 400) {
      let node =
          document.querySelector('article') || document.querySelector('main');

      if (!node) {
        const candidates =
            Array.from(document.querySelectorAll('article, section, div'));
        node = candidates.reduce(
            (best, el) =>
                (el.innerText || '').length > (best?.innerText || '').length ?
                el :
                best,
            null);
      }

      if (node) {
        const clone = node.cloneNode(true);
        pruneLowValueSections(clone);
        text = normalize(clone.innerText);
      }
    }

    // --- Detect language ---
    let lang = detectLangFromDom();

    // If lang is a full tag like "de-CH", keep it. (Chrome TTS accepts
    // BCP-47-ish tags.) If no DOM lang, infer from text.
    if (!lang) lang = inferLangFromTextSample(text);

    sendResponse({ok: true, text, lang: lang || ''});
  } catch (e) {
    sendResponse(
        {ok: false, text: '', lang: '', error: String(e?.message || e)});
  }

  return true;
});
