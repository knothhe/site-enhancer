export const QUOTE_REQUEST = 'site-enhancer-resolve-quote';
export const QUOTE_URL = 'data-site-enhancer-quote-url';

// X's anchorless quote cards keep their destination on the link component.
// Read only that component's pathname, never the surrounding tweet data.
export function quoteComponentPath(element: Element): string | undefined {
  const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
  if (!key) return;
  type Fiber = { stateNode?: unknown; memoizedProps?: { link?: { pathname?: unknown } }; return?: Fiber };
  let fiber = (element as unknown as Record<string, Fiber>)[key];
  for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return!) {
    if (depth && (fiber.stateNode as Node | undefined)?.nodeType === 1) break;
    const path = fiber.memoizedProps?.link?.pathname;
    if (typeof path === 'string') return path;
  }
}

export function normalizeQuoteUrl(path: string, origin: string): string | undefined {
  try {
    const url = new URL(path, origin);
    if (!['https:', 'http:'].includes(url.protocol) || !/^(?:www\.)?(?:x|twitter)\.com$/.test(url.hostname)) return;
    if (!/^\/(?:\w+\/status|i\/web\/status)\/\d+\/?$/.test(url.pathname)) return;
    return origin + url.pathname;
  } catch { return; }
}

export function resolveQuoteUrl(card: Element, origin: string): string | undefined {
  card.removeAttribute(QUOTE_URL);
  const EventClass = card.ownerDocument.defaultView!.Event;
  card.dispatchEvent(new EventClass(QUOTE_REQUEST, { bubbles: true }));
  const path = card.getAttribute(QUOTE_URL);
  card.removeAttribute(QUOTE_URL);
  return path ? normalizeQuoteUrl(path, origin) : undefined;
}
