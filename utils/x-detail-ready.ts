export const DETAIL_READY_MESSAGE = 'site-enhancer:x-detail-ready';

/** Notify the owner as soon as React renders post content, without waiting for media or window.load. */
export function observeDetailReady(doc: Document, ready: () => void) {
  let done = false;
  const observer = new doc.defaultView!.MutationObserver(check);
  function check() {
    if (done || !doc.querySelector('[data-testid="primaryColumn"] [data-testid="tweet"]')) return;
    done = true;
    observer.disconnect();
    ready();
  }
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid'] });
  check();
  return () => { done = true; observer.disconnect(); };
}
