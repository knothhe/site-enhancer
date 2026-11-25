// x-web and responsive-web can coexist in separate documents of one tab.
export const WEB = 'html[data-app-env][data-app-version]';
export const COLUMN_MAIN = `main [data-testid="primaryColumn"], ${WEB} body > div > .flex > div + div.grid > main:has(+ aside)`;
export const PRIMARY = `[data-testid="primaryColumn"], ${WEB} main`;
export const POST = `[data-testid="tweet"], ${WEB} main article`;
export const PRIMARY_POST = `[data-testid="primaryColumn"] [data-testid="tweet"], ${WEB} main article`;
export const POST_LINK = '[role="link"][data-href]';
export const TIMESTAMP = 'a[href*="/status/"]:is(:has(time),[data-base-ui-tooltip-trigger])';
export const TEXT = '[data-testid="tweetText"],div[dir="auto"][lang]';
export const MENU_TRIGGER = '[data-testid="caret"],button[data-slot="xds-menu-trigger"][aria-haspopup="menu"]:has(use[href="#icon-more-dots-hor"])';
export const PHOTO = '[data-testid="tweetPhoto"],a[href*="/photo/"]';
export const PHOTO_IMAGE = '[data-testid="tweetPhoto"] img,article img[src*="pbs.twimg.com/media/"]';
export const PLAYER = ':is([data-testid="videoPlayer"],.relative.isolate.aspect-video)';

export function focusedPost(target: Element | null) {
  if (target?.matches(POST)) return target;
  if (target?.matches(POST_LINK)) return target.querySelector(':scope > article');
}

/** Two-pane pages without a timeline. */
export function isNativeRoute(pathname: string) {
  return /^\/(settings|messages|i\/(chat|grok))(?:\/|$)/.test(pathname);
}

// Streaming hydration can replace the head or discard document_start additions.
// Observe only the head and root, so timeline updates never trigger these repairs.
export function preserveWebStyles(styles: HTMLStyleElement[], attributes: string[] = [], restore?: () => void) {
  const doc = styles[0].ownerDocument;
  const root = doc.documentElement;
  let head = doc.head;
  const observer = new doc.defaultView!.MutationObserver(() => {
    if (!root.matches(WEB)) return;
    if (doc.head !== head) {
      head = doc.head;
      if (head) observer.observe(head, { childList: true });
    }
    for (const style of styles) {
      if (style.isConnected) continue;
      if (doc.getElementById(style.id)) return; // A newer extension instance owns the stylesheet.
      (head ?? root).append(style);
    }
    restore?.();
  });
  observer.observe(root, { childList: true, attributes: true, attributeFilter: attributes });
  if (head) observer.observe(head, { childList: true });
  return () => observer.disconnect();
}
