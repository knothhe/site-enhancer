import { QUOTE_REQUEST, QUOTE_URL, quoteComponentPath, normalizeQuoteUrl } from '../utils/x-quote';

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  main() {
    if (window.top !== window && window.name !== 'site-enhancer-x-detail') return;
    const resolve = (event: Event) => {
      const card = event.target;
      if (!(card instanceof Element) || !card.matches('[role="link"]') || !card.closest('article[data-testid="tweet"]')) return;
      const path = quoteComponentPath(card);
      const url = path && normalizeQuoteUrl(path, location.origin);
      if (url) card.setAttribute(QUOTE_URL, url);
    };
    // MAIN scripts have no extension context; replace any previous bridge on reinjection.
    const host = window as Window & { __seQuoteCleanup?: () => void };
    host.__seQuoteCleanup?.();
    document.addEventListener(QUOTE_REQUEST, resolve);
    host.__seQuoteCleanup = () => document.removeEventListener(QUOTE_REQUEST, resolve);
  },
});
