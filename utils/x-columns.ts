import { DETAIL_READY_MESSAGE } from './x-detail-ready.ts';
import { installXImageViewer } from './x-image-viewer.ts';
import { installDetailHistory } from './x-detail-history.ts';
import { resolveQuoteUrl } from './x-quote.ts';
import { resolveLocale, type Locale } from './i18n.ts';
/** Three-column layout. The timeline remains owned by X; details use a same-origin frame. */
export const COLUMNS_MIN_WIDTH = 1080;
export const COLUMNS_WIDTH_KEY = 'site-enhancer:x-columns-widths';
export const COLUMNS_COLLAPSED_KEY = 'site-enhancer:x-nav-collapsed';
export const DETAIL_FRAME_NAME = 'site-enhancer-x-detail';
export type ColumnWidths = { nav: number; share: number };
export const DEFAULT_COLUMNS: ColumnWidths = { nav: 200, share: .52 };

export function parseColumnWidths(value: unknown): ColumnWidths {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_COLUMNS };
  const { nav, share } = value as ColumnWidths;
  return Number.isFinite(nav) && nav >= 88 && nav <= 280 && Number.isFinite(share) && share >= .25 && share <= .75
    ? { nav, share } : { ...DEFAULT_COLUMNS };
}
export function columnGeometry(width: number, preference: ColumnWidths) {
  const nav = Math.min(preference.nav, Math.max(88, width - 800));
  const available = width - nav;
  const feed = Math.max(360, Math.min(available - 360, Math.round(available * preference.share)));
  return { nav, feed, detail: available - feed };
}
/** The post's own timestamp link, skipping timestamps inside quoted-post cards. */
export function postPermalink(article: Element): string | undefined {
  return Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]:has(time)')).find(link => {
    const card = link.parentElement?.closest('[role="link"]');
    return !card || !article.contains(card);
  })?.href;
}
export function detailUrl(href: string, origin: string): string | undefined {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || !/^\/(?:[\w]+\/status|i\/web\/status)\/\d+\/?$/.test(url.pathname)) return;
    return url.origin + url.pathname;
  } catch { return; }
}

export const DETAIL_FRAME_CSS = `
html,body{min-width:0!important}
header[role="banner"],[data-testid="sidebarColumn"],[data-testid="DMDrawer"],[data-testid="chat-drawer-root"]{display:none!important}
main[role="main"],main[role="main"]>div,div:has(>[data-testid="primaryColumn"]),[data-testid="primaryColumn"]{width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;flex-grow:1!important}
[data-testid="primaryColumn"] .r-1ye8kvj:has(>section){max-width:none!important}
[data-testid="primaryColumn"]{border-left:0!important;border-right:0!important}
[data-testid="primaryColumn"]>div>div:has([data-testid="app-bar-back"]):not(:has(section)){display:none!important}
[data-testid="cellInnerDiv"]:has(article[data-testid="tweet"])>div{border-bottom-color:var(--se-x-border,rgba(127,127,127,.16))!important}
html{scrollbar-width:thin;scrollbar-color:#8885 transparent}
`;
const SCOPE = ':root[data-site-enhancer-columns]';
export const COLUMNS_CSS = `
${SCOPE}{--se-column-line:var(--se-x-border,rgba(127,127,127,.16));scrollbar-width:thin;scrollbar-color:#8885 transparent}
${SCOPE} [data-site-enhancer-column-header]{border-bottom-color:var(--se-column-line)!important}
${SCOPE} [data-testid="primaryColumn"]{border-left:0!important;border-right:0!important}
${SCOPE} [data-testid="cellInnerDiv"]:has(article[data-testid="tweet"])>div{border-bottom-color:var(--se-column-line)!important}
${SCOPE} header[role="banner"]{width:var(--se-nav)!important;flex:0 0 var(--se-nav)!important}
${SCOPE} header[role="banner"] [data-testid="SideNav_NewTweet_Button"]{width:calc(var(--se-nav) - 24px)!important;min-width:0!important}
${SCOPE} header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"]{max-width:var(--se-nav)!important;min-width:0!important}
${SCOPE} header[role="banner"]>div,${SCOPE} header[role="banner"]>div>div{width:var(--se-nav)!important;transition:none!important}
/* X's padded inner rail has its own fixed width and otherwise covers feed links. */
${SCOPE} header[role="banner"]>div>div>div{width:var(--se-nav)!important;box-sizing:border-box;min-width:0}
${SCOPE} main[role="main"]{width:var(--se-feed)!important;max-width:var(--se-feed)!important;flex:0 0 var(--se-feed)!important;margin-right:var(--se-detail)!important}
${SCOPE} main[role="main"]>div,${SCOPE} div:has(>[data-testid="primaryColumn"]),${SCOPE} [data-testid="primaryColumn"]{width:100%!important;max-width:100%!important;min-width:0!important}
${SCOPE} [data-testid="primaryColumn"] .r-1ye8kvj:has(>section){max-width:none!important}
${SCOPE} [data-testid="sidebarColumn"]{display:none!important}
${SCOPE} [data-site-enhancer-selected]{box-shadow:inset 2px 0 color-mix(in srgb,var(--se-x-accent,#1d9bf0) 55%,transparent);background-color:color-mix(in srgb,var(--se-x-accent,#1d9bf0) 4%,transparent)!important}
/* Compact navigation keeps every glyph on the same 24px / 48px grid. */
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"]>div>div>div{padding-left:0!important;padding-right:0!important;align-items:center!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] nav{width:100%!important;align-items:center!important;gap:4px!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] :is(nav a,nav button,nav [role="button"],h1 a,[data-testid="SideNav_NewTweet_Button"],[data-testid="SideNav_AccountSwitcher_Button"]){box-sizing:border-box!important;align-items:center!important;justify-content:center!important;width:48px!important;min-width:48px!important;max-width:48px!important;height:48px!important;min-height:48px!important;padding:0!important;margin-left:auto!important;margin-right:auto!important;flex-shrink:0!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] :is(nav a,nav button,nav [role="button"])>div{display:flex!important;align-items:center!important;justify-content:center!important;padding:12px!important;gap:0!important;margin:0!important;width:48px!important;height:48px!important;box-sizing:border-box!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] :is(nav a,nav button,nav [role="button"])>div>div:last-child:not(:first-child){display:none!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] :is(nav,h1) svg{width:24px!important;height:24px!important;min-width:24px!important;flex-shrink:0!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] h1{align-self:center!important;margin-left:auto!important;margin-right:auto!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_NewTweet_Button"]{background:var(--se-x-text,#0f1419)!important;color:var(--se-x-bg,#fff)!important;text-decoration:none!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_NewTweet_Button"]>div{display:none!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_NewTweet_Button"]::before{content:'';display:block;width:24px;height:24px;background:currentColor;clip-path:polygon(46% 12%,54% 12%,54% 46%,88% 46%,88% 54%,54% 54%,54% 88%,46% 88%,46% 54%,12% 54%,12% 46%,46% 46%)}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"]>div:not(:first-child){display:none!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"]>div:first-child{width:24px!important;height:24px!important;min-width:24px!important;flex-basis:24px!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"] :is(img,[data-testid^="UserAvatar-Container"]){width:24px!important;height:24px!important;min-width:24px!important}
#site-enhancer-nav-toggle{position:fixed;left:calc(var(--se-nav) - 18px);top:72px;z-index:5;width:32px;height:32px;padding:6px;border:1px solid var(--se-column-line);border-radius:50%;background:var(--se-x-bg,#fff);color:var(--se-x-text,#536471);cursor:pointer}
#site-enhancer-nav-toggle svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.65}
#site-enhancer-nav-toggle:focus-visible{outline:2px solid var(--se-x-accent,#1d9bf0);outline-offset:2px}
.se-column-divider[hidden]{display:none}
#site-enhancer-columns{position:fixed;right:0;top:0;bottom:0;width:var(--se-detail);z-index:3;display:flex;flex-direction:column;background:var(--se-x-bg,var(--se-native-bg,#fff));color:var(--se-x-text,var(--se-native-text,#0f1419));font:14px/1.5 system-ui;box-sizing:border-box}
#site-enhancer-columns *{box-sizing:border-box}
#site-enhancer-columns .se-column-toolbar{display:flex;align-items:center;gap:4px;flex:0 0 var(--se-column-header-height,54px);padding:0 16px;border-bottom:1px solid var(--se-column-line)}
#site-enhancer-columns .se-column-toolbar strong{font-size:15px;font-weight:650;letter-spacing:.01em;margin-right:auto;white-space:nowrap}
#site-enhancer-columns button,#site-enhancer-columns a{font:inherit;color:inherit;background:transparent;border:0;text-decoration:none;cursor:pointer;border-radius:9px}
#site-enhancer-columns .se-column-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex-shrink:0;padding:7px;color:var(--se-x-muted,var(--se-native-muted,#65717b));transition:background .15s,color .15s}
#site-enhancer-columns button:disabled{opacity:.28;cursor:default}
#site-enhancer-columns button:not(:disabled):hover,#site-enhancer-columns a:hover{background:color-mix(in srgb,currentColor 7%,transparent);color:var(--se-x-text,var(--se-native-text,#0f1419))}
#site-enhancer-columns svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
#site-enhancer-columns :focus-visible,.se-column-divider:focus-visible{outline:2px solid var(--se-x-accent,#1d9bf0);outline-offset:2px}
#site-enhancer-columns iframe{width:100%;flex:1;min-height:0;border:0;background:inherit}
#site-enhancer-columns iframe[style*="visibility: hidden"]{position:absolute;top:var(--se-column-header-height,54px);height:calc(100% - var(--se-column-header-height,54px))}
#site-enhancer-columns [hidden]{display:none!important}
/* Retain the cached browsing viewport: display:none resets inner layout and scroll in Chromium. */
#site-enhancer-columns iframe[hidden]{display:block!important;position:absolute;top:var(--se-column-header-height,54px);height:calc(100% - var(--se-column-header-height,54px));visibility:hidden!important;pointer-events:none}
#site-enhancer-columns .se-column-status{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 28px 96px;text-align:center;color:inherit}
#site-enhancer-columns .se-column-status strong{font-size:18px;font-weight:600;letter-spacing:-.02em}
#site-enhancer-columns .se-column-status p{color:var(--se-x-muted,var(--se-native-muted,#65717b));line-height:1.8;max-width:260px;margin:12px 0 0}
#site-enhancer-columns .se-status-icon{display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:18px;background:color-mix(in srgb,currentColor 4%,transparent);color:var(--se-x-muted,var(--se-native-muted,#65717b));margin-bottom:20px}
#site-enhancer-columns .se-status-icon svg{width:25px;height:25px;stroke-width:1.35}
#site-enhancer-columns .se-column-status button{margin-top:20px;padding:8px 20px;background:color-mix(in srgb,currentColor 6%,transparent);font-weight:600}
#site-enhancer-columns [data-state="loading"] .se-status-icon svg{animation:se-column-spin 1.4s linear infinite}
@keyframes se-column-spin{to{transform:rotate(360deg)}}
.se-column-divider{position:fixed;top:0;bottom:0;width:10px;margin-left:-5px;z-index:4;cursor:col-resize;touch-action:none;background:transparent;border:0;padding:0}
.se-column-divider::before{content:"";position:absolute;top:0;bottom:0;left:5px;width:1px;background:var(--se-column-line);transition:background .15s}
.se-column-divider::after{content:"";position:absolute;top:45%;left:4px;width:3px;height:32px;border-radius:3px;background:var(--se-x-accent,#73818d);opacity:0;transition:opacity .15s}
.se-column-divider:hover::after,.se-column-divider:focus-visible::after,${SCOPE}[data-site-enhancer-resizing] .se-column-divider::after{opacity:.7}
.se-column-divider:hover::before,.se-column-divider:focus-visible::before{background:color-mix(in srgb,var(--se-x-accent,#73818d) 40%,transparent)}
@media(prefers-reduced-motion:reduce){#site-enhancer-columns *, .se-column-divider::before,.se-column-divider::after{animation:none!important;transition:none!important}}
${SCOPE}[data-site-enhancer-resizing] iframe{pointer-events:none!important}
${SCOPE}[data-site-enhancer-resizing],${SCOPE}[data-site-enhancer-resizing] *{cursor:col-resize!important;user-select:none!important}
`;

const zh = {
  collapseNav: '收起侧边栏', expandNav: '展开侧边栏',
  saveFailed: '栏宽已调整，但无法保存', saveFailedHint: '本次页面仍会使用当前宽度。',
  empty: '选择一条推文', emptyHint: '点击时间线中的推文，在这里查看详情和回复。',
  loading: '正在加载详情…', loadingHint: '时间线会保留在原处。',
  frameTitle: '推文详情和回复', panel: '推文详情', title: '推文详情',
  failed: '详情暂时无法加载', failedHint: '请重新加载扩展和页面后重试，或在新标签页查看。', retryHint: '可以重试，或在新标签页查看。',
  newTab: '新标签页', retry: '重试', search: '搜索', back: '后退', forward: '前进', reset: '恢复栏宽', close: '关闭',
  resizeNav: '调整导航栏宽度', resizeDetail: '调整时间线和详情宽度', resizeHint: '拖动调整宽度；方向键微调；双击恢复默认',
};

export const COLUMNS_LABELS: Record<Locale, typeof zh> = {
  zh,
  en: {
    collapseNav: 'Collapse sidebar', expandNav: 'Expand sidebar',
    saveFailed: 'Column widths changed but couldn’t be saved', saveFailedHint: 'This page keeps the current widths.',
    empty: 'Select a post', emptyHint: 'Click a post in the timeline to see it and its replies here.',
    loading: 'Loading post…', loadingHint: 'The timeline stays where it is.',
    frameTitle: 'Post and replies', panel: 'Post details', title: 'Post',
    failed: 'Couldn’t load the post', failedHint: 'Reload the extension and the page, then try again, or open it in a new tab.', retryHint: 'Try again, or open it in a new tab.',
    newTab: 'New tab', retry: 'Retry', search: 'Search', back: 'Back', forward: 'Forward', reset: 'Reset widths', close: 'Close',
    resizeNav: 'Resize navigation', resizeDetail: 'Resize timeline and post', resizeHint: 'Drag to resize; arrow keys to nudge; double-click to reset',
  },
};

export function installXColumns(options: {
  prepareDetail?: (url: string) => Promise<string>;
  releaseDetail?: () => void;
} = {}) {
  const root = document.documentElement;
  const imageViewer = installXImageViewer();
  let collapsed = false;
  let navToggle: HTMLButtonElement | undefined;
  try { collapsed = localStorage.getItem(COLUMNS_COLLAPSED_KEY) === 'true'; } catch { /* Optional preference. */ }
  // Follow X's interface language, like the copy menu; the browser language is the fallback.
  // X may set or change <html lang> after document_start, so labels are re-applied on change.
  const currentLabels = () => COLUMNS_LABELS[resolveLocale(root.lang || navigator.language)];
  let t = currentLabels();
  let localize: Array<() => void> = [];
  let lastStatus: Parameters<typeof showStatus> | undefined;
  function localized(apply: () => void) { localize.push(apply); apply(); }
  const langObserver = new MutationObserver(() => {
    const next = currentLabels();
    if (next === t) return;
    t = next;
    localize.forEach(apply => apply());
    if (frame) frame.title = t.frameTitle;
    if (lastStatus && status && !status.hidden) showStatus(...lastStatus);
  });
  langObserver.observe(root, { attributes: true, attributeFilter: ['lang'] });
  const sheet = document.createElement('style');
  sheet.id = 'site-enhancer-columns-style';
  sheet.textContent = COLUMNS_CSS;
  (document.head ?? root).append(sheet);
  let enabled = false;
  let disposed = false;
  let panel: HTMLElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  // Keep only the current and most recent ready document connected, preserving scroll and reply drafts.
  const readyFrames = new Map<string, { frame: HTMLIFrameElement; doc: Document; scrollX: number; scrollY: number }>();
  const frameDocuments = new Map<HTMLIFrameElement, Document>();
  let checkFrame: (() => void) | undefined;
  let loadingFrame: HTMLIFrameElement | undefined;
  let status: HTMLElement;
  let openLink: HTMLAnchorElement;
  let retry: HTMLButtonElement;
  let dividers: HTMLElement[] = [];
  let selected: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let widths = { ...DEFAULT_COLUMNS };
  let drag: { kind: number; x: number; widths: ColumnWidths } | undefined;
  let returnFocus: HTMLElement | undefined;
  let selectedArticle: Element | undefined;
  let bodyObserver: MutationObserver | undefined;
  let headerObserver: MutationObserver | undefined;
  let sizeObserver: ResizeObserver | undefined;
  let measuredHeader: Element | undefined;
  let backButton: HTMLButtonElement;
  let forwardButton: HTMLButtonElement;
  const history = installDetailHistory(url => {
    if (!panel) return;
    if (url) {
      const cached = readyFrames.get(url);
      if (selected !== url || !frame || (cached && !reusable(url, cached))) openDetail(url);
    }
    else closeDetail(false);
  }, () => {
    if (!panel) return;
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
  }, () => !!panel && active());
  try { widths = parseColumnWidths(JSON.parse(localStorage.getItem(COLUMNS_WIDTH_KEY) ?? 'null')); } catch { /* Optional preference. */ }

  const viewportWidth = () => root.getBoundingClientRect().width || root.clientWidth || window.innerWidth;
  const active = () => enabled && viewportWidth() >= COLUMNS_MIN_WIDTH;
  function save() {
    try { localStorage.setItem(COLUMNS_WIDTH_KEY, JSON.stringify(widths)); }
    catch { showStatus('saveFailed', 'saveFailedHint', 'error'); }
  }
  type Label = keyof typeof COLUMNS_LABELS.en;
  function showStatus(title: Label, description: Label, state: 'empty' | 'loading' | 'error' = 'empty') {
    lastStatus = [title, description, state];
    status.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = t[title];
    const body = document.createElement('p');
    body.textContent = t[description];
    status.dataset.state = state;
    const decoration = document.createElement('span');
    decoration.className = 'se-status-icon';
    decoration.append(icon(state));
    status.append(decoration, heading, body, retry);
    status.hidden = false;
  }
  function stopFrameWatch() {
    clearInterval(timer);
    if (loadingFrame && checkFrame) loadingFrame.removeEventListener('load', checkFrame);
    loadingFrame = undefined; checkFrame = undefined;
  }
  function discardFrame(target: HTMLIFrameElement) {
    frameDocuments.get(target)?.removeEventListener('click', click, true);
    frameDocuments.delete(target);
    for (const [url, entry] of readyFrames) if (entry.frame === target) readyFrames.delete(url);
    target.remove();
  }
  function clearFrames() {
    stopFrameWatch();
    for (const entry of [...readyFrames.values()]) discardFrame(entry.frame);
    if (frame) discardFrame(frame);
  }
  function reusable(url: string, entry: { frame: HTMLIFrameElement; doc: Document }) {
    try {
      return entry.frame.isConnected && entry.frame.contentDocument === entry.doc &&
        detailUrl(entry.doc.location.origin + entry.doc.location.pathname, location.origin) === url;
    } catch { return false; }
  }
  function parkFrame() {
    stopFrameWatch();
    if (!frame) return;
    const entry = selected && readyFrames.get(selected);
    if (entry && entry.frame === frame && reusable(selected!, entry)) {
      entry.scrollX = entry.doc.defaultView?.scrollX || entry.doc.documentElement.scrollLeft;
      entry.scrollY = entry.doc.defaultView?.scrollY || entry.doc.documentElement.scrollTop;
      frame.hidden = true;
      for (const media of entry.doc.querySelectorAll<HTMLMediaElement>('video,audio')) {
        if (!media.paused) media.pause();
      }
    } else discardFrame(frame);
  }
  function detailReady(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.type !== DETAIL_READY_MESSAGE) return;
    checkFrame?.();
  }
  function closeDetail(restoreFocus = true) {
    if (frame || selected) options.releaseDetail?.();
    clearFrames();
    frame = undefined;
    selected = undefined;
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = undefined;
    openLink.hidden = true;
    retry.hidden = true;
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
    showStatus('empty', 'emptyHint');
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function openDetail(url: string) {
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find(article =>
      detailUrl(postPermalink(article) ?? '', location.origin) === url);
    selectedArticle?.setAttribute('data-site-enhancer-selected', '');
    parkFrame();
    frame = undefined;
    selected = url;
    openLink.href = url;
    openLink.hidden = false;
    retry.hidden = true;
    const cached = readyFrames.get(url);
    if (cached && reusable(url, cached)) {
      readyFrames.delete(url); readyFrames.set(url, cached);
      frame = cached.frame; frame.hidden = false; frame.title = t.frameTitle;
      status.hidden = true;
      cached.doc.defaultView?.scrollTo(cached.scrollX, cached.scrollY);
      return;
    }
    if (cached) discardFrame(cached.frame);
    // Bound the cache to two connected frames, including the incoming load.
    while (readyFrames.size > 1) discardFrame(readyFrames.values().next().value!.frame);
    showStatus('loading', 'loadingHint', 'loading');
    const current = document.createElement('iframe');
    current.name = DETAIL_FRAME_NAME;
    current.title = t.frameTitle;
    // Keep native popups, media and forms, but prevent a child route from replacing the timeline.
    current.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
    if (options.prepareDetail) {
      void options.prepareDetail(url).then(prepared => {
        if (frame === current && panel && !disposed) current.src = prepared;
      }).catch(() => {
        if (frame !== current || !panel || disposed) return;
        stopFrameWatch();
        discardFrame(current);
        frame = undefined;
        showStatus('failed', 'failedHint', 'error');
        retry.hidden = false;
      });
    } else current.src = url;
    current.style.visibility = 'hidden';
    frame = current;
    panel!.append(current);
    const started = Date.now();
    const check = () => {
      if (frame !== current || !panel || disposed) return;
      try {
        const doc = current.contentDocument;
        if (doc && doc.location.href !== 'about:blank') {
          if (!doc.getElementById('site-enhancer-detail-frame-style')) {
            const style = doc.createElement('style');
            style.id = 'site-enhancer-detail-frame-style';
            style.textContent = DETAIL_FRAME_CSS;
            (doc.head ?? doc.documentElement).append(style);
          }
          const primary = doc.querySelector('[data-testid="primaryColumn"]');
          if (primary && (primary.querySelector('[data-testid="tweet"]') ||
            (Date.now() - started > 1500 && !primary.querySelector('[role="progressbar"]') && (primary.textContent?.length ?? 0) > 50))) {
            doc.addEventListener('click', click, true);
            frameDocuments.set(current, doc);
            readyFrames.set(url, { frame: current, doc, scrollX: 0, scrollY: 0 });
            while (readyFrames.size > 2) discardFrame(readyFrames.values().next().value!.frame);
            current.style.visibility = '';
            status.hidden = true;
            retry.hidden = true;
            stopFrameWatch();
            return;
          }
        }
      } catch { /* Cross-origin redirects or a blocked frame fall back to a normal link. */ }
      if (Date.now() - started > 20000) {
        stopFrameWatch();
        discardFrame(current);
        frame = undefined;
        showStatus('failed', 'retryHint', 'error');
        retry.hidden = false;
      }
    };
    checkFrame = check; loadingFrame = current;
    current.addEventListener('load', check);
    // Fallback for blocked/missing frame scripts and error pages; normal readiness is event-driven.
    timer = setInterval(check, 250);
  }
  const paths = {
    back: 'M15 5l-7 7 7 7',
    forward: 'M9 5l7 7-7 7',
    search: 'M21 21l-4.5-4.5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15',
    reset: 'M4 4v5h5M4 9a8 8 0 1 1-1 7',
    external: 'M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    close: 'M6 6l12 12M18 6L6 18',
    empty: 'M5 4h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 3V5a1 1 0 0 1 1-1M8 8h8M8 12h5',
    loading: 'M20 12a8 8 0 1 1-8-8',
    error: 'M12 8v5M12 16v.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18',
  };
  function icon(name: keyof typeof paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    svg.append(path);
    return svg;
  }
  function iconControl(element: HTMLElement, label: Label, name: keyof typeof paths) {
    element.className = 'se-column-icon';
    localized(() => { element.setAttribute('aria-label', t[label]); element.title = t[label]; });
    element.replaceChildren(icon(name));
  }
  function button(label: Label, action: () => void, name?: keyof typeof paths) {
    const element = document.createElement('button');
    element.type = 'button';
    if (name) iconControl(element, label, name);
    else localized(() => { element.textContent = t[label]; });
    element.addEventListener('click', action);
    return element;
  }
  function reset() { collapsed = false; saveCollapsed(); widths = { ...DEFAULT_COLUMNS }; renderWidths(); save(); }
  function saveCollapsed() {
    try { localStorage.setItem(COLUMNS_COLLAPSED_KEY, String(collapsed)); }
    catch { /* Keep the current page preference when storage is unavailable. */ }
  }
  function renderToggle() {
    if (!navToggle) return;
    navToggle.title = collapsed ? t.expandNav : t.collapseNav;
    navToggle.setAttribute('aria-label', navToggle.title);
    navToggle.setAttribute('aria-expanded', String(!collapsed));
    const direction = collapsed ? 'forward' : 'back';
    if (navToggle.dataset.direction !== direction) {
      navToggle.dataset.direction = direction;
      navToggle.replaceChildren(icon(direction));
    }
  }
  function mount() {
    if (panel || !document.body) return;
    panel = document.createElement('aside');
    panel.id = 'site-enhancer-columns';
    const current = panel;
    localized(() => current.setAttribute('aria-label', t.panel));
    const toolbar = document.createElement('div');
    toolbar.className = 'se-column-toolbar';
    const title = document.createElement('strong');
    localized(() => { title.textContent = t.title; });
    openLink = document.createElement('a');
    iconControl(openLink, 'newTab', 'external');
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    retry = button('retry', () => { if (selected) openDetail(selected); });
    const search = document.createElement('a');
    search.href = '/explore';
    iconControl(search, 'search', 'search');
    backButton = button('back', () => history.back(), 'back');
    forwardButton = button('forward', () => history.forward(), 'forward');
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
    toolbar.append(title, backButton, forwardButton, search, button('reset', reset, 'reset'), openLink, button('close', () => { history.select(undefined); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }, 'close'));
    status = document.createElement('div');
    status.className = 'se-column-status';
    status.setAttribute('role', 'status');
    panel.append(toolbar, status);
    document.body.append(panel);
    navToggle = document.createElement('button');
    navToggle.type = 'button';
    navToggle.id = 'site-enhancer-nav-toggle';
    localized(renderToggle);
    navToggle.addEventListener('click', () => { end(); collapsed = !collapsed; saveCollapsed(); renderWidths(); });
    document.body.append(navToggle);
    bodyObserver = new MutationObserver(renderWidths);
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    sizeObserver = new window.ResizeObserver(() => { syncHeader(); renderWidths(); });
    sizeObserver.observe(root);
    headerObserver = new MutationObserver(() => { if (!measuredHeader?.isConnected) syncHeader(); });
    headerObserver.observe(document.body, { childList: true, subtree: true });
    syncHeader();
    dividers = [0, 1].map(kind => {
      const divider = document.createElement('div');
      divider.className = 'se-column-divider';
      divider.tabIndex = 0;
      divider.setAttribute('role', 'separator');
      divider.setAttribute('aria-orientation', 'vertical');
      localized(() => {
        divider.setAttribute('aria-label', kind === 0 ? t.resizeNav : t.resizeDetail);
        divider.title = t.resizeHint;
      });
      divider.addEventListener('dblclick', reset);
      divider.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag = { kind, x: event.clientX, widths: { ...widths } };
        divider.setPointerCapture(event.pointerId);
        root.setAttribute('data-site-enhancer-resizing', '');
      });
      divider.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') return reset();
        adjust(kind, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10));
        save();
      });
      document.body.append(divider);
      return divider;
    });
    if (!history.restore()) closeDetail(false);
  }
  function syncHeader() {
    if (!panel) return;
    if (!measuredHeader?.isConnected) {
      const primary = document.querySelector('[data-testid="primaryColumn"]');
      let candidate = primary?.querySelector('[role="tablist"], [data-testid="app-bar-back"]');
      if (measuredHeader) sizeObserver?.unobserve(measuredHeader);
      measuredHeader?.removeAttribute('data-site-enhancer-column-header');
      measuredHeader = undefined;
      while (candidate && candidate !== primary) {
        const rect = candidate.getBoundingClientRect();
        if (rect.height >= 32 && rect.height <= 120 && Math.abs(rect.top) < 2 && parseFloat(getComputedStyle(candidate).borderBottomWidth) > 0) {
          measuredHeader = candidate;
          measuredHeader.setAttribute('data-site-enhancer-column-header', '');
          sizeObserver?.observe(measuredHeader);
          break;
        }
        candidate = candidate.parentElement;
      }
    }
    const height = measuredHeader?.getBoundingClientRect().height;
    root.style.setProperty('--se-column-header-height', `${height && height >= 32 && height <= 120 ? height : 54}px`);
  }
  function renderWidths() {
    if (!panel) return;
    const { nav, feed, detail } = columnGeometry(viewportWidth(), collapsed ? { ...widths, nav: 88 } : widths);
    root.style.setProperty('--se-nav', `${nav}px`);
    root.style.setProperty('--se-feed', `${feed}px`);
    root.style.setProperty('--se-detail', `${detail}px`);
    root.toggleAttribute('data-site-enhancer-compact-nav', nav < 180);
    renderToggle();
    dividers.forEach((divider, index) => {
      divider.hidden = index === 0 && collapsed;
      divider.style.left = `${index === 0 ? nav : nav + feed}px`;
      divider.setAttribute('aria-valuenow', String(index === 0 ? nav : feed));
      divider.setAttribute('aria-valuemin', index === 0 ? '88' : '360');
      divider.setAttribute('aria-valuemax', String(index === 0 ? 280 : viewportWidth() - nav - 360));
    });
    const background = getComputedStyle(document.body).backgroundColor;
    const channels = background.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    const dark = channels && channels.reduce((sum, value) => sum + value, 0) < 384 && background !== 'rgba(0, 0, 0, 0)';
    panel.style.setProperty('--se-native-bg', background === 'rgba(0, 0, 0, 0)' ? '#fff' : background);
    panel.style.setProperty('--se-native-text', dark ? '#e7e9ea' : '#0f1419');
    panel.style.setProperty('--se-native-muted', dark ? '#939da6' : '#65717b');
    navToggle?.style.setProperty('background', 'var(--se-x-bg,' + (background === 'rgba(0, 0, 0, 0)' ? '#fff' : background) + ')');
    navToggle?.style.setProperty('color', `var(--se-x-text,${dark ? '#e7e9ea' : '#536471'})`);
  }
  function adjust(kind: number, delta: number) {
    const { nav, feed } = columnGeometry(viewportWidth(), collapsed ? { ...widths, nav: 88 } : widths);
    if (kind === 0) { collapsed = false; widths.nav = Math.max(88, Math.min(280, nav + delta)); }
    else widths.share = Math.max(.25, Math.min(.75, Math.max(360, Math.min(viewportWidth() - nav - 360, feed + delta)) / (viewportWidth() - nav)));
    renderWidths();
  }
  function move(event: PointerEvent) {
    if (!drag) return;
    widths = { ...drag.widths };
    adjust(drag.kind, event.clientX - drag.x);
  }
  function end(event?: PointerEvent) {
    if (!drag) return;
    if (event?.type === 'pointercancel') { widths = drag.widths; renderWidths(); }
    else save();
    drag = undefined;
    root.removeAttribute('data-site-enhancer-resizing');
  }
  function blur() { end(); }
  function unmount() {
    imageViewer.close();
    navToggle?.remove();
    navToggle = undefined;
    if (frame || selected) options.releaseDetail?.();
    selected = undefined;
    clearFrames();
    drag = undefined;
    bodyObserver?.disconnect();
    headerObserver?.disconnect();
    sizeObserver?.disconnect();
    measuredHeader?.removeAttribute('data-site-enhancer-column-header');
    measuredHeader = undefined;
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = undefined;
    panel?.remove();
    panel = undefined;
    frame = undefined;
    dividers.forEach(divider => divider.remove());
    dividers = [];
    localize = [];
    lastStatus = undefined;
    for (const name of ['data-site-enhancer-columns', 'data-site-enhancer-compact-nav', 'data-site-enhancer-resizing']) root.removeAttribute(name);
    for (const name of ['--se-nav', '--se-feed', '--se-detail', '--se-column-header-height']) root.style.removeProperty(name);
  }
  function refresh() {
    if (disposed) return;
    if (!active()) return unmount();
    mount();
    if (panel) { root.setAttribute('data-site-enhancer-columns', ''); renderWidths(); }
  }
  function click(event: MouseEvent) {
    if (!active() || !panel || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target && (event.target as Element).nodeType === 1 ? event.target as Element : undefined;
    if (!target?.closest('[data-testid="primaryColumn"]') || !target.closest('article[data-testid="tweet"]')) return;
    if (imageViewer.handleClick(event)) return;
    if (target.closest('button,[role="button"],input,textarea,select,video,[contenteditable="true"]')) return;
    if (target.ownerDocument.defaultView?.getSelection()?.toString()) return;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const article = target.closest('article')!;
    const card = target.closest('[role="link"]:not(a)');
    // Never fall back to the outer post for an anchorless card. If X changes
    // its component shape, leave the native card interaction intact.
    const href = link?.href ?? (card ? resolveQuoteUrl(card, location.origin)
      : postPermalink(article));
    const url = href && detailUrl(href, location.origin);
    if (!url || link?.target === '_blank' || link?.hasAttribute('download')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    returnFocus = (link ?? article) as HTMLElement;
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = article;
    selectedArticle.setAttribute('data-site-enhancer-selected', '');
    history.select(url);
  }
  function storage(event: StorageEvent) {
    if (event.key === COLUMNS_COLLAPSED_KEY) { collapsed = event.newValue === 'true'; renderWidths(); return; }
    if (event.key !== COLUMNS_WIDTH_KEY) return;
    try { widths = parseColumnWidths(JSON.parse(event.newValue ?? 'null')); renderWidths(); } catch { /* Ignore invalid cross-tab data. */ }
  }
  document.addEventListener('click', click, true);
  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('resize', refresh);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', blur);
  window.addEventListener('storage', storage);
  window.addEventListener('message', detailReady);
  return {
    setEnabled(value: boolean) { enabled = value; refresh(); },
    onNavigate() { if (panel && !history.restore()) closeDetail(false); syncHeader(); refresh(); },
    remove() {
      disposed = true;
      langObserver.disconnect();
      unmount();
      sheet.remove();
      history.remove();
      document.removeEventListener('click', click, true);
      document.removeEventListener('DOMContentLoaded', refresh);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('storage', storage);
      window.removeEventListener('message', detailReady);
      window.removeEventListener('blur', blur);
    },
  };
}
