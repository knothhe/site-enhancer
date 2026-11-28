// Read X's explicit reply relation in the page's React world on demand. Match both
// IDs in the caller because X can recycle article elements as the timeline scrolls.
const REQUEST = 'site-enhancer-read-reply';
const RESPONSE = 'site-enhancer-reply-ids';

export function installReplyResolver(doc: Document) {
  type Fiber = {
    memoizedProps?: { tweet?: { id_str?: unknown; in_reply_to_status_id_str?: unknown } };
    return?: Fiber;
  };
  const view = doc.defaultView!;
  const resolve = (event: Event) => {
    const post = event.target;
    if (!(post instanceof view.Element) || !post.matches('article')) return;
    const key = Object.keys(post).find(name => name.startsWith('__reactFiber$'));
    if (!key) return;
    let fiber: Fiber | undefined = (post as unknown as Record<string, Fiber>)[key];
    for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
      const tweet = fiber.memoizedProps?.tweet;
      if (!tweet) continue;
      const { id_str: child, in_reply_to_status_id_str: parent } = tweet;
      if (typeof child === 'string' && /^\d+$/.test(child) && typeof parent === 'string' && /^\d+$/.test(parent)) {
        post.dispatchEvent(new view.CustomEvent(RESPONSE, { detail: child + '/' + parent }));
      }
      return;
    }
  };
  doc.addEventListener(REQUEST, resolve);
  return () => doc.removeEventListener(REQUEST, resolve);
}

export function hasReplyParent(post: Element, child: string, parent: string) {
  let matches = false;
  const receive = (event: Event) => { matches = (event as CustomEvent).detail === child + '/' + parent; };
  post.addEventListener(RESPONSE, receive);
  try {
    post.dispatchEvent(new post.ownerDocument.defaultView!.Event(REQUEST, { bubbles: true }));
  } finally {
    post.removeEventListener(RESPONSE, receive);
  }
  return matches;
}
