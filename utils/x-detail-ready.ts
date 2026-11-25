import { PRIMARY, PRIMARY_POST as READY_TWEET, POST as TWEET } from './x-dom.ts';
export const DETAIL_READY_MESSAGE = 'site-enhancer:x-detail-ready';

/** Notify the owner as soon as React renders post content, without waiting for media or window.load. */
export function observeDetailReady(doc: Document, ready: () => void) {
  const observer = new doc.defaultView!.MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target as Element;
        if (target.matches(`${PRIMARY}, ${TWEET}`) && containsReadyTweet(target)) return complete();
      } else {
        for (const node of record.addedNodes) {
          if (containsReadyTweet(node)) return complete();
        }
      }
    }
  });
  function containsReadyTweet(node: Node) {
    if (node.nodeType !== 1 || !doc.contains(node)) return false;
    const element = node as Element;
    if (element.matches(TWEET) && element.closest(PRIMARY)) return true;
    if (!element.firstElementChild) return false;
    return Boolean(element.querySelector(element.closest(PRIMARY) ? TWEET : READY_TWEET));
  }
  function complete() {
    observer.disconnect();
    ready();
  }
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid'] });
  if (doc.querySelector(READY_TWEET)) complete();
  return () => observer.disconnect();
}
