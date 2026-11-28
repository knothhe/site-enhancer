import { PRIMARY as PRIMARY_COLUMN, PRIMARY_POST, POST, POST_LINK, TIMESTAMP, PLAYER, WEB, COLUMN_MAIN, focusedPost, isNativeRoute } from './x-dom.ts';
import { copyToClipboard } from './clipboard.ts';
import { DETAIL_READY_MESSAGE } from './x-detail-ready.ts';
import { restoreVideoPosition } from './x-video-position.ts';
import { installXMedia } from './x-media.ts';
import { DETAIL_PENDING_ATTR } from './x-video-gate.ts';
import { installDetailHistory } from './x-detail-history.ts';
import { resolveQuoteUrl } from './x-quote.ts';
import { resolveLocale, type Locale } from './i18n.ts';
import { isXOverlayRoute, X_OVERLAY_SELECTOR } from './x-style.ts';
/** Three-column layout. The timeline remains owned by X; details use a same-origin frame. */
export const COLUMNS_MIN_WIDTH = 1080;
export const COLUMNS_WIDTH_KEY = 'site-enhancer:x-columns-widths';
export const COLUMNS_COLLAPSED_KEY = 'site-enhancer:x-nav-collapsed';
export const DETAIL_FRAME_NAME = 'site-enhancer-x-detail';
export type ColumnWidths = { nav: number; share: number; feedGutter: number; detailGutter: number };
export const DEFAULT_COLUMNS: ColumnWidths = { nav: 200, share: .5, feedGutter: 0, detailGutter: 0 };

const gutterLevels = [
  { label: 'none', value: 0 }, { label: 'small', value: .04 },
  { label: 'medium', value: .08 }, { label: 'large', value: .12 },
] as const;

export function gutterPixels(level: number, paneWidth: number) {
  return Math.min(Math.round(level * paneWidth), Math.max(0, Math.floor((paneWidth - 360) / 2)));
}

export function parseColumnWidths(value: unknown): ColumnWidths {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_COLUMNS };
  const { nav, share, feedGutter, detailGutter } = value as ColumnWidths;
  const gutter = (input: unknown) => gutterLevels.find(level => level.value === input)?.value ?? 0;
  return Number.isFinite(nav) && nav >= 88 && nav <= 280 && Number.isFinite(share) && share >= .25 && share <= .75
    ? { nav, share, feedGutter: gutter(feedGutter), detailGutter: gutter(detailGutter) } : { ...DEFAULT_COLUMNS };
}
const widthPresets = [
  { label: 'detailFocus', share: .4, parts: [2, 3] },
  { label: 'balanced', share: .5, parts: [1, 1] },
  { label: 'timelineFocus', share: .6, parts: [3, 2] },
] as const;

function feedWidth(available: number, share: number) {
  return Math.max(360, Math.min(available - 360, Math.round(available * share)));
}

export function activeWidthPreset(share: number) {
  return widthPresets.find(preset => Math.abs(share - preset.share) < .005);
}

export function adjustedFeedShare(available: number, feed: number, snap: boolean) {
  if (snap) {
    const preset = widthPresets.find(preset => Math.abs(feedWidth(available, preset.share) - feed) <= 12);
    if (preset) return preset.share;
  }
  const clamped = Math.max(360, Math.min(available - 360, feed));
  return Math.max(.25, Math.min(.75, clamped / available));
}

/** How long a missing timeline column is treated as a route change rather than an unsupported page. */
export const STRUCTURE_GRACE_MS = 1500;
export function columnGeometry(width: number, preference: Pick<ColumnWidths, 'nav' | 'share'>) {
  const nav = Math.min(preference.nav, Math.max(88, width - 800));
  const available = width - nav;
  const feed = feedWidth(available, preference.share);
  return { nav, feed, detail: available - feed };
}
/** The post's own timestamp link, skipping timestamps inside quoted-post cards. */
export function postPermalink(article: Element): string | undefined {
  const wrapper = article.parentElement;
  if (wrapper?.matches(POST_LINK)) {
    const href = wrapper.getAttribute('data-href');
    if (href) return detailUrl(href, article.ownerDocument.location.origin);
  }
  return Array.from(article.querySelectorAll<HTMLAnchorElement>(TIMESTAMP)).find(link => {
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

/** Resolve at click time because X recycles articles and their players. */
export function nativeVideoUrl(video: HTMLVideoElement, detailPost?: string) {
  const origin = video.ownerDocument.location.origin;
  const article = video.closest('article');
  const link = video.closest<HTMLAnchorElement>('a[href]');
  if (link?.origin === origin && /^\/(?:[\w]+|i\/web)\/status\/\d+\/video\/\d+\/?$/.test(link.pathname)) {
    return origin + link.pathname;
  }
  const card = video.closest('[role="link"]:not(a)');
  const quote = card && article?.contains(card) && resolveQuoteUrl(card, origin);
  const post = quote || (article && detailUrl(postPermalink(article) ?? '', origin)) || detailPost;
  if (!post || !article) return post;
  // X numbers photos and videos together in a multi-attachment post.
  // Exclude quoted media when computing the outer post's index and vice versa.
  const media = Array.from((quote && card ? card : article).querySelectorAll('video,[data-testid="tweetPhoto"] img,a[href*="/photo/"] img'))
    .filter(item => item.closest('article') === article && item.closest('[role="link"]:not(a)') === card);
  const index = media.indexOf(video);
  return media.length > 1 && index >= 0 ? `${post.replace(/\/$/, '')}/video/${index + 1}` : post;
}

export const DETAIL_FRAME_CSS = `
${WEB} body > div:has(> .flex > div.grid > main){max-width:none!important;padding:0!important;--x-main-column-width:100%!important}
${WEB} div:has(+ div.grid > main),${WEB} main + aside,${WEB} main :is([data-page-header],[data-top-chrome]),${WEB} [data-slot="xds-dock"]{display:none!important}
${WEB} div.grid:has(> main){display:block!important;max-width:none!important}
html,body{min-width:0!important}
header[role="banner"],[data-testid="sidebarColumn"],[data-testid="DMDrawer"],[data-testid="chat-drawer-root"]{display:none!important}
main[role="main"],main[role="main"]>div,div:has(>[data-testid="primaryColumn"]),[data-testid="primaryColumn"]{width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;flex-grow:1!important}
[data-testid="primaryColumn"] .r-1ye8kvj:has(>section){max-width:none!important}
[data-testid="primaryColumn"]{border-left:0!important;border-right:0!important}
[data-testid="primaryColumn"]>div>div:has([data-testid="app-bar-back"]):not(:has(section)){display:none!important}
[data-testid="cellInnerDiv"]:has(article[data-testid="tweet"])>div{border-bottom-color:var(--se-x-border,rgba(127,127,127,.16))!important}
[data-testid="primaryColumn"],${WEB} div.grid > main:not(:has([data-testid="primaryColumn"])){box-sizing:border-box!important;padding-inline:clamp(0px,round(nearest,calc(var(--se-detail-gutter,0) * 100%),1px),round(down,calc((100% - 360px) / 2),1px))!important}
html{scrollbar-width:thin;scrollbar-color:#8885 transparent}
`;
const SCOPE = ':root[data-site-enhancer-columns]';

const HEADER_CONTROL = '[data-page-header], [data-top-chrome], [role="tablist"], [data-testid="app-bar-back"]';
const HEADER_TARGET = `${PRIMARY_COLUMN}, ${HEADER_CONTROL}`;
const TIMELINE_CELL = '[data-testid="cellInnerDiv"], article[data-testid="tweet"]';
const W = WEB + '[data-site-enhancer-columns]';
const row = W + ' body > div > .flex:has(> div.grid > main)';
export const COLUMNS_CSS = `
${W} body > div:has(> .flex > div.grid > main){max-width:none!important;padding:0!important;overflow:visible!important;--x-main-column-width:var(--se-feed)!important;--x-timeline-max-width:var(--se-feed)}
${row}{justify-content:flex-start!important}
${row} > div:first-child,${row} > div:first-child > div{width:var(--se-nav)!important;flex:none!important;--x-sidebar-expanded:1!important}
${W}[data-site-enhancer-compact-nav] body > div > .flex:has(> div.grid > main) > div:first-child > div{--x-sidebar-expanded:0!important;box-sizing:border-box;padding-inline:8px!important}
${row} > div.grid{display:grid!important;grid-template-columns:var(--se-feed) var(--se-detail)!important;max-width:none!important;min-width:0!important}
${row} > div.grid > main{position:relative;isolation:isolate;margin:0!important}
${row} > div.grid > aside{display:none!important}
${W}:has(#site-enhancer-columns [data-state="empty"]) main + aside{display:flex!important;position:sticky;top:var(--se-column-header-height,54px);align-self:start;max-height:calc(100vh - var(--se-column-header-height,54px));overflow:auto;margin-top:var(--se-column-header-height,54px)}
${W}:has(main + aside) #site-enhancer-columns:has([data-state="empty"]){bottom:auto}
${W}:has(main + aside) #site-enhancer-columns [data-state="empty"]{display:none}
${W} body > [data-base-ui-portal]{position:relative;z-index:6}
${SCOPE}{--se-column-line:var(--se-x-border,rgba(127,127,127,.16));scrollbar-width:thin;scrollbar-color:#8885 transparent}
${SCOPE} [data-site-enhancer-column-header]{border-bottom-color:var(--se-column-line)!important}
${SCOPE} [data-testid="primaryColumn"],${row} > div.grid > main:not(:has([data-testid="primaryColumn"])){box-sizing:border-box!important;padding-inline:var(--se-feed-gutter,0px)!important}
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
${SCOPE}:has(#site-enhancer-columns [data-state="empty"]) [data-testid="sidebarColumn"]{display:flex!important;position:fixed!important;inset:var(--se-column-header-height,54px) 0 0 auto!important;width:var(--se-detail)!important;max-width:none!important;margin:0!important;overflow:auto;padding-inline:16px;box-sizing:border-box}
${SCOPE} [data-testid="sidebarColumn"]>div{width:100%!important;max-width:600px!important;margin-inline:auto!important}
${SCOPE} [data-testid="sidebarColumn"]>div div:is(:has(form[role="search"]),:has([data-testid="trend"])){width:100%!important;max-width:none!important;box-sizing:border-box}
${SCOPE} [data-testid="sidebarColumn"]>div>div{position:static!important}
${SCOPE} [data-testid="sidebarColumn"] div:has(>form[role="search"]),${SCOPE} [data-testid="sidebarColumn"] div:has(form[role="search"]):not(:has([data-testid="trend"])){position:static!important;background:var(--se-x-bg,inherit)!important}
${SCOPE} [data-testid="sidebarColumn"] div:has([data-testid="trend"])>div:has(form[role="search"]):not(:has([data-testid="trend"])){position:sticky!important;top:0!important;z-index:2;padding-bottom:8px!important;background:var(--se-x-bg,var(--se-native-bg,#fff))!important}
${SCOPE} [data-testid="sidebarColumn"] div:has(> div form[role="search"]):has(> div ~ div [data-testid="trend"]) > :not(:has(form[role="search"])):not(:has([data-testid="trend"])){display:none!important}
${SCOPE}:has([data-testid="sidebarColumn"]) #site-enhancer-columns:has([data-state="empty"]){bottom:auto}
${SCOPE}:has([data-testid="sidebarColumn"]) #site-enhancer-columns [data-state="empty"]{display:none}
/* X renders dialogs, menus, hover cards and toasts in #layers inside its z-index:0 app root; lift that root above the fixed panel while one is open. */
${SCOPE} #react-root>div:has(>div>#layers :is(${X_OVERLAY_SELECTOR})){z-index:6!important}
/* The bottom-right drawers sit under the detail panel and would only flash over it while the app root is lifted. */
${SCOPE} #layers :is([data-testid="GrokDrawer"],[data-testid="chat-drawer-root"],[data-testid="DMDrawer"]){display:none!important}
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
/* Sidebar toggle sits inside the nav rail: right-aligned above the account switcher when expanded, centered on the icon column when compact. */
#site-enhancer-nav-toggle{position:fixed;left:calc(var(--se-nav) - 52px);bottom:84px;z-index:5;display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:var(--se-toggle-bg,var(--se-x-bg,#fff));color:var(--se-toggle-fg,var(--se-x-muted,#536471));cursor:pointer;transition:background-color .15s,color .15s}
#site-enhancer-nav-toggle[hidden]{display:none}
:root[data-site-enhancer-compact-nav] #site-enhancer-nav-toggle{left:calc(var(--se-nav) / 2 - 20px)}
#site-enhancer-nav-toggle:hover{background:color-mix(in srgb,currentColor 10%,var(--se-toggle-bg,var(--se-x-bg,#fff)));color:var(--se-x-text,var(--se-toggle-hover,#0f1419))}
#site-enhancer-nav-toggle svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
#site-enhancer-nav-toggle:focus-visible{outline:2px solid var(--se-x-accent,#1d9bf0);outline-offset:2px}
.se-column-divider[hidden]{display:none}
#site-enhancer-columns{position:fixed;right:0;top:0;bottom:0;width:var(--se-detail);z-index:3;display:flex;flex-direction:column;background:var(--se-x-bg,var(--se-native-bg,#fff));color:var(--se-x-text,var(--se-native-text,#0f1419));font:14px/1.5 system-ui;box-sizing:border-box}
#site-enhancer-columns *{box-sizing:border-box}
#site-enhancer-columns .se-column-toolbar{display:flex;align-items:center;gap:4px;flex:0 0 var(--se-column-header-height,54px);padding:0 16px;border-bottom:1px solid var(--se-column-line)}
#site-enhancer-columns .se-column-toolbar .se-column-title{font-size:15px;font-weight:650;letter-spacing:.01em;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#site-enhancer-columns button,#site-enhancer-columns a{font:inherit;color:inherit;background:transparent;border:0;text-decoration:none;cursor:pointer;border-radius:9px}
#site-enhancer-columns .se-column-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex-shrink:0;padding:7px;color:var(--se-x-muted,var(--se-native-muted,#65717b));transition:background .15s,color .15s}
#site-enhancer-columns button:disabled{cursor:default}
#site-enhancer-columns button:disabled:not(.se-column-title){opacity:.28}
#site-enhancer-columns button:not(:disabled):hover,#site-enhancer-columns a:hover,#site-enhancer-columns .se-column-icon[aria-expanded="true"]{background:color-mix(in srgb,currentColor 7%,transparent);color:var(--se-x-text,var(--se-native-text,#0f1419))}
#site-enhancer-columns svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
#site-enhancer-columns .se-width-menu{position:absolute;z-index:2;top:calc(var(--se-column-header-height,54px) - 4px);width:264px;padding:6px;border:1px solid var(--se-column-line);border-radius:14px;background:var(--se-x-bg,var(--se-native-bg,#fff));box-shadow:0 8px 28px #0002,0 1px 3px #0001;--se-menu-muted:var(--se-x-muted,var(--se-native-muted,#65717b))}
#site-enhancer-columns[data-dark] .se-width-menu{box-shadow:0 0 0 1px #ffffff14,0 8px 28px #000a}
#site-enhancer-columns .se-width-header{font-size:12px;font-weight:600;color:var(--se-menu-muted);padding:6px 10px 4px}
#site-enhancer-columns .se-width-menu button{display:flex;align-items:center;gap:10px;padding:8px 10px;width:100%;text-align:start}
#site-enhancer-columns .se-width-menu button:not(:disabled):hover{background:color-mix(in srgb,currentColor 6%,transparent)}
#site-enhancer-columns .se-width-diagram{width:40px;height:20px;display:flex;align-items:stretch;justify-content:center;gap:2px;flex:none}
#site-enhancer-columns .se-width-diagram i{border:1.4px solid currentColor;border-radius:3px;opacity:.55}
#site-enhancer-columns [aria-checked="true"] .se-width-diagram i{opacity:1;border-color:var(--se-x-accent,#1d9bf0)}
#site-enhancer-columns [aria-checked="true"] .se-width-diagram i:first-child{background:color-mix(in srgb,var(--se-x-accent,#1d9bf0) 22%,transparent)}
#site-enhancer-columns .se-width-label{font-weight:500;flex:1}
#site-enhancer-columns .se-width-ratio{font-size:13px;font-variant-numeric:tabular-nums;color:var(--se-menu-muted)}
#site-enhancer-columns .se-width-check{width:16px;display:flex;color:var(--se-x-accent,#1d9bf0)}
#site-enhancer-columns .se-width-check svg{width:16px;height:16px;stroke-width:2}
#site-enhancer-columns [aria-checked="false"] .se-width-check svg{display:none}
#site-enhancer-columns .se-width-line{height:1px;background:var(--se-column-line);margin:6px 4px}
#site-enhancer-columns .se-gutter-row{display:flex;align-items:center;gap:10px;padding:5px 10px}
#site-enhancer-columns .se-segments{display:flex;padding:2px;border-radius:8px;background:color-mix(in srgb,currentColor 7%,transparent)}
#site-enhancer-columns .se-segments button{justify-content:center;width:auto;min-width:30px;height:24px;padding:0 4px;border-radius:6px;font-size:12.5px;font-weight:500;color:var(--se-menu-muted)}
#site-enhancer-columns .se-width-menu .se-segments button[aria-checked="true"]{background:var(--se-x-bg,#fff);color:inherit;font-weight:600;box-shadow:0 1px 2px #0003}
#site-enhancer-columns[data-dark] .se-width-menu .se-segments button[aria-checked="true"]{background:color-mix(in srgb,currentColor 18%,transparent);box-shadow:none}
#site-enhancer-columns .se-width-reset{color:var(--se-menu-muted)}
#site-enhancer-columns :focus-visible,.se-column-divider:focus-visible{outline:2px solid var(--se-x-accent,#1d9bf0);outline-offset:2px}
#site-enhancer-columns iframe{width:100%;flex:1;min-height:0;border:0;background:inherit}
#site-enhancer-columns iframe[style*="visibility: hidden"]{position:absolute;top:var(--se-column-header-height,54px);height:calc(100% - var(--se-column-header-height,54px))}
#site-enhancer-columns [hidden]{display:none!important}
/* Retain the cached browsing viewport: display:none resets inner layout and scroll in Chromium. */
#site-enhancer-columns iframe[hidden]{display:block!important;position:absolute;top:var(--se-column-header-height,54px);height:calc(100% - var(--se-column-header-height,54px));visibility:hidden!important;pointer-events:none}
#site-enhancer-columns iframe[hidden][data-switch-preview]{position:static;height:auto;visibility:visible!important}
#site-enhancer-columns .se-column-status{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 28px 96px;text-align:center;color:inherit}
#site-enhancer-columns .se-column-status strong{font-size:18px;font-weight:600;letter-spacing:-.02em}
#site-enhancer-columns .se-column-status p{color:var(--se-x-muted,var(--se-native-muted,#65717b));line-height:1.8;max-width:260px;margin:12px 0 0}
#site-enhancer-columns .se-status-icon{display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:18px;background:color-mix(in srgb,currentColor 4%,transparent);color:var(--se-x-muted,var(--se-native-muted,#65717b));margin-bottom:20px}
#site-enhancer-columns .se-status-icon svg{width:25px;height:25px;stroke-width:1.35}
#site-enhancer-columns .se-column-status button{margin-top:20px;padding:8px 20px;background:color-mix(in srgb,currentColor 6%,transparent);font-weight:600}
#site-enhancer-columns [data-state="loading"] .se-status-icon svg{animation:se-column-spin 1.4s linear infinite}
#site-enhancer-columns[data-switching] .se-column-toolbar::after{content:"";position:absolute;top:var(--se-column-header-height,54px);left:0;width:30%;height:2px;background:var(--se-x-accent,#1d9bf0);animation:se-progress 1s ease-in-out infinite alternate;z-index:1}
@keyframes se-progress{to{transform:translateX(230%)}}
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
  focusHint: '定位时间线中的推文 · ] 进入详情，[ 返回',
  collapseNav: '收起侧边栏', expandNav: '展开侧边栏',
  saveFailed: '栏宽已调整，但无法保存', saveFailedHint: '本次页面仍会使用当前宽度。',
  empty: '选择一条推文', emptyHint: '点击时间线中的推文，在这里查看详情和回复。',
  loading: '正在加载详情…', loadingHint: '时间线会保留在原处。',
  frameTitle: '推文详情和回复', panel: '推文详情', title: '推文详情',
  failed: '详情暂时无法加载', failedHint: '请重新加载扩展和页面后重试，或在新标签页查看。', retryHint: '可以重试，或在新标签页查看。',
  newTab: '新标签页', copyLink: '复制链接', copiedLink: '已复制链接', retry: '重试', search: '搜索', back: '后退', forward: '前进', reset: '恢复默认布局', close: '关闭',
  layout: '布局', ratio: '栏宽 · 时间线 : 详情', margins: '两侧留白', feedGutter: '时间线', detailGutter: '详情', none: '无', small: '小', medium: '中', large: '大', detailFocus: '详情优先', balanced: '均分', timelineFocus: '列表优先',
  resizeNav: '调整导航栏宽度', resizeDetail: '调整时间线和详情宽度', resizeHint: '拖动调整宽度，靠近预设比例时吸附；方向键微调；双击恢复默认',
};

export const COLUMNS_LABELS: Record<Locale, typeof zh> = {
  zh,
  en: {
    focusHint: 'Locate post in timeline · ] focuses details, [ returns',
    collapseNav: 'Collapse sidebar', expandNav: 'Expand sidebar',
    saveFailed: 'Column widths changed but couldn’t be saved', saveFailedHint: 'This page keeps the current widths.',
    empty: 'Select a post', emptyHint: 'Click a post in the timeline to see it and its replies here.',
    loading: 'Loading post…', loadingHint: 'The timeline stays where it is.',
    frameTitle: 'Post and replies', panel: 'Post details', title: 'Post',
    failed: 'Couldn’t load the post', failedHint: 'Reload the extension and the page, then try again, or open it in a new tab.', retryHint: 'Try again, or open it in a new tab.',
    newTab: 'New tab', copyLink: 'Copy link', copiedLink: 'Link copied', retry: 'Retry', search: 'Search', back: 'Back', forward: 'Forward', reset: 'Reset layout', close: 'Close',
    layout: 'Layout', ratio: 'Widths · Timeline : Post', margins: 'Side margins', feedGutter: 'Timeline', detailGutter: 'Post', none: 'None', small: 'S', medium: 'M', large: 'L', detailFocus: 'Detail focus', balanced: 'Balanced', timelineFocus: 'Timeline focus',
    resizeNav: 'Resize navigation', resizeDetail: 'Resize timeline and post', resizeHint: 'Drag to resize (snaps to presets); arrow keys to nudge; double-click to reset',
  },
};

export function installXColumns(options: {
  prepareDetail?: (url: string) => Promise<string>;
  releaseDetail?: () => void;
} = {}) {
  const root = document.documentElement;
  const stopVideoRestore = restoreVideoPosition(nativeVideoUrl);
  const media = installXMedia({
    nativeVideoUrl: video => nativeVideoUrl(video, selected),
    isPrimaryPost(video) {
      const doc = video.ownerDocument;
      if (doc === document) return false;
      const article = video.closest('article');
      if (!article) return false;
      const card = video.closest('[role="link"]');
      if (card && article.contains(card) && card !== article) return false;
      if (selected) {
        const permalink = detailUrl(postPermalink(article) ?? '', location.origin);
        if (permalink) return permalink === selected;
      }
      const primary = doc.querySelector(PRIMARY_COLUMN);
      return primary?.querySelector(POST) === article;
    },
  });
  let nativeCompact = false;
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
  let mediaEnhanced = false;
  let disposed = false;
  let panel: HTMLElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  // Keep only the current and most recent ready document connected, preserving scroll and reply drafts.
  const readyFrames = new Map<string, { frame: HTMLIFrameElement; doc: Document; scrollX: number; scrollY: number }>();
  const frameDocuments = new Map<HTMLIFrameElement, Document>();
  let checkFrame: (() => void) | undefined;
  let loadingFrame: HTMLIFrameElement | undefined;
  let title: HTMLButtonElement;
  let previous: HTMLIFrameElement | undefined;
  let status: HTMLElement;
  let openLink: HTMLAnchorElement;
  let copyLinkButton: HTMLButtonElement;
  let copyLinkTimer: ReturnType<typeof setTimeout> | undefined;
  let widthControl: ReturnType<typeof createWidthControl> | undefined;
  let retry: HTMLButtonElement;
  let dividers: HTMLElement[] = [];
  let selected: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let widths = { ...DEFAULT_COLUMNS };
  let renderedWidth: number | undefined;
  let drag: { kind: number; x: number; widths: ColumnWidths } | undefined;
  let returnFocus: HTMLElement | undefined;
  let selectedOffset: number | undefined;
  let locatePending = false;
  function emphasize(article: Element) {
    article.animate?.([{ outline: '2px solid var(--se-x-accent,#1d9bf0)' }, { outline: '2px solid transparent' }], 650);
  }
  let selectedArticle: Element | undefined;
  let bodyObserver: MutationObserver | undefined;
  let headerObserver: MutationObserver | undefined;
  let headerFrame: number | undefined;
  let sizeObserver: ResizeObserver | undefined;
  let measuredHeader: Element | undefined;
  let unmeasuredHeaderElements: Element[] = [];
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
    if (state !== 'loading') hidePrevious();
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
    const doc = frameDocuments.get(target);
    if (doc) {
      doc.removeEventListener('click', click, true);
      doc.removeEventListener('keydown', openFocused, true);
      doc.removeEventListener('keydown', closeOnEscape);
      media.detach(doc);
    }
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
    media.close();
    stopFrameWatch();
    if (!frame) return;
    const entry = selected && readyFrames.get(selected);
    if (entry && entry.frame === frame && reusable(selected!, entry)) {
      entry.scrollX = entry.doc.defaultView?.scrollX || entry.doc.documentElement.scrollLeft;
      entry.scrollY = entry.doc.defaultView?.scrollY || entry.doc.documentElement.scrollTop;
      frame.hidden = true;
      media.pause(entry.doc);
      for (const audio of entry.doc.querySelectorAll<HTMLAudioElement>('audio')) {
        if (!audio.paused) audio.pause();
      }
    } else discardFrame(frame);
  }
  function detailReady(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.type !== DETAIL_READY_MESSAGE) return;
    checkFrame?.();
  }
  function closeDetail(restoreFocus = true) {
    cancelHover();
    if (selected || frame) options.releaseDetail?.();
    clearFrames();
    frame = undefined;
    selected = undefined;
    media.setFeedPaused(false);
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = undefined;
    selectedOffset = undefined;
    locatePending = false;
    openLink.hidden = true;
    copyLinkButton.hidden = true;
    retry.hidden = true;
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
    updateTitle();
    showStatus('empty', 'emptyHint');
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  let hoverFrame: { url: string; frame: HTMLIFrameElement } | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  function makeFrame() {
    const current = document.createElement('iframe');
    current.name = DETAIL_FRAME_NAME;
    current.title = t.frameTitle;
    current.allow = 'fullscreen; picture-in-picture';
    current.allowFullscreen = true;
    // Keep native popups, media and forms, but prevent a child route from replacing the timeline.
    current.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
    return current;
  }
  let hoverArticle: Element | undefined;
  let lastScroll = -Infinity;
  function scrolling() {
    lastScroll = Date.now();
    cancelHover();
  }
  function cancelHover() {
    hoverArticle = undefined;
    clearTimeout(hoverTimer);
    if (!hoverFrame) return;
    hoverFrame.frame.remove();
    hoverFrame = undefined;
    options.releaseDetail?.();
  }
  function hover(event: PointerEvent) {
    const article = (event.target as Element)?.closest?.(POST);
    if (!article?.closest(PRIMARY_COLUMN) || article.contains(event.relatedTarget as Node | null)) return;
    if (event.type === 'pointermove' && article === hoverArticle) return;
    cancelHover();
    if (event.type === 'pointerout' || event.pointerType === 'touch' || !selected || !panel || loadingFrame || Date.now() - lastScroll < 200) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const hasVideo = Boolean(article.querySelector(`${PLAYER}, video`));
    // Avoid hidden media-stream buffering competing with an actively playing video.
    if (hasVideo && media.isPlaying()) return;
    hoverArticle = article;
    hoverTimer = setTimeout(() => {
      const url = detailUrl(postPermalink(article) ?? '', location.origin);
      if (!url || !selected || !panel || loadingFrame || !article.isConnected || readyFrames.has(url) || document.querySelector(X_OVERLAY_SELECTOR)) return;
      if (hasVideo && media.isPlaying()) return;
      const current = makeFrame();
      current.hidden = true;
      hoverFrame = { url, frame: current };
      panel.append(current);
      const request = options.prepareDetail?.(url) ?? Promise.resolve(url);
      void request.then(src => { if (current.isConnected) current.src = src; }).catch(() => {
        if (hoverFrame?.frame === current) cancelHover();
        else if (frame === current) failLoad(current, 'failedHint');
      });
    }, hasVideo ? 450 : 200);
  }
  function follow(event: FocusEvent) {
    clearTimeout(followTimer);
    const target = event.target as HTMLElement;
    const article = focusedPost(target) as HTMLElement | undefined;
    if (!selected || !article || !article.closest(PRIMARY_COLUMN) || article.isContentEditable) return;
    followTimer = setTimeout(() => {
      const url = detailUrl(postPermalink(article) ?? '', location.origin);
      if (selected && url && url !== selected && target === document.activeElement && !document.querySelector(X_OVERLAY_SELECTOR)) {
        returnFocus = target;
        history.select(url);
      }
    }, 150);
  }
  function updateTitle() {
    const handle = selected && new URL(selected).pathname.match(/^\/([\w]+)\/status\//)?.[1];
    title.textContent = handle ? '@' + handle : selectedArticle?.querySelector('[data-testid="User-Name"]')?.textContent || t.title;
    title.title = selected ? t.focusHint : '';
    title.disabled = !selected;
  }
  function hidePrevious() {
    if (previous) { previous.hidden = true; previous.inert = false; previous.removeAttribute('data-switch-preview'); }
    previous = undefined;
    panel?.removeAttribute('data-switching');
  }
  function failLoad(current: HTMLIFrameElement, hint: Label) {
    stopFrameWatch();
    discardFrame(current);
    frame = undefined;
    showStatus('failed', hint, 'error');
    retry.hidden = false;
  }
  function openDetail(url: string) {
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = Array.from(document.querySelectorAll(POST)).find(article =>
      detailUrl(postPermalink(article) ?? '', location.origin) === url);
    selectedArticle?.setAttribute('data-site-enhancer-selected', '');
    selectedOffset = selectedArticle ? window.scrollY + selectedArticle.getBoundingClientRect().top : undefined;
    locatePending = false;
    const visible = selected ? readyFrames.get(selected)?.frame : undefined;
    parkFrame();
    if (visible?.isConnected) previous = visible;
    frame = undefined;
    selected = url;
    updateTitle();
    media.setFeedPaused(true);
    openLink.href = url;
    openLink.hidden = false;
    copyLinkButton.hidden = false;
    retry.hidden = true;
    const cached = readyFrames.get(url);
    if (cached && reusable(url, cached)) {
      cancelHover();
      readyFrames.delete(url); readyFrames.set(url, cached);
      hidePrevious();
      frame = cached.frame; frame.hidden = false; frame.title = t.frameTitle;
      status.hidden = true;
      cached.doc.defaultView?.scrollTo(cached.scrollX, cached.scrollY);
      return;
    }
    if (cached) discardFrame(cached.frame);
    // Bound the cache to two connected frames, including the incoming load.
    while (readyFrames.size > 1) discardFrame(readyFrames.values().next().value!.frame);
    showStatus('loading', 'loadingHint', 'loading');
    if (previous?.isConnected) {
      previous.inert = true;
      previous.setAttribute('data-switch-preview', '');
      status.hidden = true;
      panel!.setAttribute('data-switching', '');
    }
    const prepared = hoverFrame?.url === url ? hoverFrame : undefined;
    if (prepared) hoverFrame = undefined;
    cancelHover();
    const current = prepared?.frame ?? makeFrame();
    // Hold autoplay in the frame until it is attached to playback rules and actually visible.
    current.setAttribute(DETAIL_PENDING_ATTR, '');
    if (prepared) current.hidden = false;
    else if (options.prepareDetail) {
      void options.prepareDetail(url).then(prepared => {
        if (frame === current && panel && !disposed) current.src = prepared;
      }).catch(() => {
        if (frame !== current || !panel || disposed) return;
        failLoad(current, 'failedHint');
      });
    } else current.src = url;
    current.style.visibility = 'hidden';
    frame = current;
    if (!current.isConnected) panel!.append(current);
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
          doc.documentElement.style.setProperty('--se-detail-gutter', String(widths.detailGutter));
          const primary = doc.querySelector(PRIMARY_COLUMN);
          if (primary && (primary.querySelector(POST) ||
            (Date.now() - started > 1500 && !primary.querySelector('[role="progressbar"]') && (primary.textContent?.length ?? 0) > 50))) {
            doc.addEventListener('click', click, true);
            doc.addEventListener('keydown', openFocused, true);
            doc.addEventListener('keydown', closeOnEscape);
            if (!selectedArticle && title.textContent === t.title) {
              title.textContent = primary.querySelector('[data-testid="User-Name"]')?.textContent || t.title;
            }
            frameDocuments.set(current, doc);
            media.attach(doc, current);
            readyFrames.set(url, { frame: current, doc, scrollX: 0, scrollY: 0 });
            while (readyFrames.size > 2) discardFrame(readyFrames.values().next().value!.frame);
            hidePrevious();
            current.style.visibility = '';
            current.removeAttribute(DETAIL_PENDING_ATTR);
            status.hidden = true;
            retry.hidden = true;
            stopFrameWatch();
            return;
          }
        }
      } catch { /* Cross-origin redirects or a blocked frame fall back to a normal link. */ }
      if (Date.now() - started > 20000) {
        failLoad(current, 'retryHint');
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
    widths: 'M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4M12 4v16M7.5 10.5 6 12l1.5 1.5M16.5 10.5 18 12l-1.5 1.5',
    reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
    external: 'M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    copy: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6L6 18',
    empty: 'M5 4h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 3V5a1 1 0 0 1 1-1M8 8h8M8 12h5',
    loading: 'M20 12a8 8 0 1 1-8-8',
    error: 'M12 8v5M12 16v.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18',
    collapseNav: 'M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4M9 4v16M16 9.5 13.5 12l2.5 2.5',
    expandNav: 'M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4M9 4v16M13.5 9.5 16 12l-2.5 2.5',
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
  function createWidthControl() {
    const menu = document.createElement('div');
    menu.className = 'se-width-menu';
    menu.setAttribute('role', 'dialog');
    localized(() => menu.setAttribute('aria-label', t.layout));
    const trigger = button('layout', () => menu.isConnected ? close() : open(), 'widths');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    function labelElement(label: Label, className: string) {
      const text = document.createElement('span');
      text.className = className;
      localized(() => { text.textContent = t[label]; });
      return text;
    }
    function group(label: Label) {
      const element = document.createElement('div');
      element.setAttribute('role', 'radiogroup');
      localized(() => element.setAttribute('aria-label', t[label]));
      return element;
    }
    function heading(label: Label) {
      const element = document.createElement('div');
      element.className = 'se-width-header';
      localized(() => { element.textContent = t[label]; });
      menu.append(element);
    }
    function row(parent: HTMLElement, label: Label, action: () => void) {
      const item = document.createElement('button');
      item.type = 'button';
      const diagram = document.createElement('span');
      diagram.className = 'se-width-diagram';
      item.append(diagram, labelElement(label, 'se-width-label'));
      item.addEventListener('click', action);
      parent.append(item);
      return { item, diagram };
    }
    function setWidth(key: 'share' | 'feedGutter' | 'detailGutter', value: number) {
      widths[key] = value;
      renderWidths();
      save();
    }
    heading('ratio');
    const presets = group('ratio');
    menu.append(presets);
    const items = widthPresets.map(preset => {
      const { item, diagram } = row(presets, preset.label, () => setWidth('share', preset.share));
      item.setAttribute('role', 'radio');
      for (const part of preset.parts) {
        const column = document.createElement('i');
        column.style.flex = String(part);
        diagram.append(column);
      }
      const ratio = document.createElement('span');
      ratio.className = 'se-width-ratio';
      ratio.textContent = preset.parts.join(' : ');
      const check = document.createElement('span');
      check.className = 'se-width-check';
      check.append(icon('check'));
      item.append(ratio, check);
      return item;
    });
    const line = document.createElement('div');
    line.className = 'se-width-line';
    line.setAttribute('role', 'separator');
    menu.append(line);
    heading('margins');
    const gutterGroups = (['feedGutter', 'detailGutter'] as const).map(key => {
      const container = document.createElement('div');
      container.className = 'se-gutter-row';
      const segments = group(key);
      segments.className = 'se-segments';
      const radios = gutterLevels.map(({ label, value }) => {
        const radio = button(label, () => setWidth(key, value));
        radio.setAttribute('role', 'radio');
        localized(() => { radio.title = `${t[label]} · ${value * 100}%`; });
        segments.append(radio);
        return radio;
      });
      container.append(labelElement(key, 'se-width-label'), segments);
      menu.append(container);
      return { key, radios };
    });
    menu.append(line.cloneNode());
    const restore = row(menu, 'reset', reset);
    restore.item.className = 'se-width-reset';
    restore.diagram.append(icon('reset'));

    function syncGroup(radios: HTMLButtonElement[], checked: number) {
      radios.forEach((radio, index) => {
        radio.setAttribute('aria-checked', String(index === checked));
        radio.tabIndex = index === Math.max(0, checked) ? 0 : -1;
      });
    }
    function sync() {
      const active = activeWidthPreset(widths.share);
      syncGroup(items, active ? widthPresets.indexOf(active) : -1);
      for (const { key, radios } of gutterGroups) {
        syncGroup(radios, gutterLevels.findIndex(level => level.value === widths[key]));
      }
      if (menu.isConnected) menu.style.left = `${Math.max(8, trigger.offsetLeft + trigger.offsetWidth - menu.offsetWidth)}px`;
    }
    function open() {
      trigger.after(menu);
      trigger.setAttribute('aria-expanded', 'true');
      sync();
      items.find(radio => radio.tabIndex === 0)!.focus();
    }
    function close(returnToTrigger = false) {
      menu.remove();
      trigger.setAttribute('aria-expanded', 'false');
      if (returnToTrigger) trigger.focus();
    }
    trigger.addEventListener('keydown', event => {
      if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      open();
    });
    menu.addEventListener('keydown', event => {
      const focused = document.activeElement as HTMLButtonElement;
      if (event.key === 'Tab') {
        const stops = [...menu.querySelectorAll<HTMLButtonElement>('[role="radio"][tabindex="0"]'), restore.item];
        const index = stops.findIndex(stop => stop === focused || stop.parentElement === focused.parentElement);
        stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      } else if (event.key === 'Escape') {
        close(true);
      } else if (event.key === 'Enter' || event.key === ' ') {
        focused.click();
      } else {
        const group = focused.closest('[role="radiogroup"]');
        if (!group || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
        const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
        const index = radios.indexOf(focused);
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        const next = radios[(index + (forward ? 1 : -1) + radios.length) % radios.length];
        next.focus();
        next.click();
      }
      event.preventDefault();
      event.stopPropagation();
    });
    return { trigger, sync, dismissOutside(target: Node | null) {
      if (menu.isConnected && !menu.contains(target) && !trigger.contains(target)) close();
    } };
  }
  function reset() { collapsed = false; saveCollapsed(); widths = { ...DEFAULT_COLUMNS }; renderWidths(); save(); }
  function saveCollapsed() {
    try { localStorage.setItem(COLUMNS_COLLAPSED_KEY, String(collapsed)); }
    catch { /* Keep the current page preference when storage is unavailable. */ }
  }
  function renderToggle() {
    if (!navToggle) return;
    navToggle.hidden = nativeCompact;
    navToggle.title = collapsed ? t.expandNav : t.collapseNav;
    navToggle.setAttribute('aria-label', navToggle.title);
    navToggle.setAttribute('aria-expanded', String(!collapsed));
    const direction = collapsed ? 'expandNav' : 'collapseNav';
    if (navToggle.dataset.direction !== direction) {
      navToggle.dataset.direction = direction;
      navToggle.replaceChildren(icon(direction));
    }
  }
  function mount() {
    if (panel || !document.body) return;
    media.attach(document);
    panel = document.createElement('aside');
    panel.id = 'site-enhancer-columns';
    const current = panel;
    localized(() => current.setAttribute('aria-label', t.panel));
    const toolbar = document.createElement('div');
    toolbar.className = 'se-column-toolbar';
    title = document.createElement('button');
    title.className = 'se-column-title';
    title.type = 'button';
    title.addEventListener('click', () => {
      if (selectedArticle?.isConnected) {
        selectedArticle.scrollIntoView({ block: 'center' });
        emphasize(selectedArticle);
      } else if (selectedOffset !== undefined) {
        locatePending = true;
        window.scrollTo({ top: Math.max(0, selectedOffset - window.innerHeight / 2) });
      }
    });
    localized(updateTitle);
    openLink = document.createElement('a');
    iconControl(openLink, 'newTab', 'external');
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    copyLinkButton = button('copyLink', () => {
      if (!selected) return;
      void copyToClipboard(selected).then(ok => {
        if (!ok || disposed || !copyLinkButton.isConnected) return;
        clearTimeout(copyLinkTimer);
        copyLinkButton.replaceChildren(icon('check'));
        copyLinkButton.title = t.copiedLink;
        copyLinkButton.setAttribute('aria-label', t.copiedLink);
        copyLinkTimer = setTimeout(() => {
          if (disposed || !copyLinkButton.isConnected) return;
          copyLinkButton.replaceChildren(icon('copy'));
          copyLinkButton.title = t.copyLink;
          copyLinkButton.setAttribute('aria-label', t.copyLink);
        }, 1600);
      });
    }, 'copy');
    retry = button('retry', () => { if (selected) openDetail(selected); });
    backButton = button('back', () => history.back(), 'back');
    forwardButton = button('forward', () => history.forward(), 'forward');
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
    widthControl = createWidthControl();
    toolbar.append(title, backButton, forwardButton, copyLinkButton, openLink, widthControl.trigger, button('close', () => { history.select(undefined); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }, 'close'));
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
    bodyObserver = new MutationObserver(renderTheme);
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    bodyObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-site-enhancer-x-theme', 'data-site-enhancer-x-tone'] });
    renderTheme();
    syncNativeNav();
    let observedWidth: number | undefined;
    sizeObserver = new window.ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === root && entry.contentRect.width !== observedWidth) {
          observedWidth = entry.contentRect.width;
          refresh();
        } else if (entry.target === measuredHeader) {
          setHeaderHeight(entry.borderBoxSize?.[0]?.blockSize ?? measuredHeader.getBoundingClientRect().height);
        }
      }
    });
    sizeObserver.observe(root);
    headerObserver = new MutationObserver(records => {
      if (records.some(record => (record.target as Element).closest?.('header[role="banner"]') ||
        Array.from([...record.addedNodes, ...record.removedNodes]).some(node => node instanceof Element &&
          (node.matches('header[role="banner"]') || node.querySelector('header[role="banner"]'))))) syncNativeNav();
      remarkSelection(records);
      if (measuredHeader?.isConnected || headerFrame !== undefined) return;
      const removedHeader = (measuredHeader ?? unmeasuredHeaderElements[0])?.isConnected === false;
      if (!removedHeader && !records.some(changesHeader)) return;
      headerFrame = window.requestAnimationFrame(() => { headerFrame = undefined; syncHeader(); });
    });
    headerObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-testid'] });
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
  /** X virtualizes timeline cells; mark the selected post again when its article is re-rendered. */
  function remarkSelection(records: MutationRecord[]) {
    if (!selected || selectedArticle?.isConnected) return;
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const articles = element.matches(POST) ? [element] : element.querySelectorAll(POST);
      for (const article of articles) {
        if (!article.closest(PRIMARY_COLUMN) || detailUrl(postPermalink(article) ?? '', location.origin) !== selected) continue;
        selectedArticle = article;
        selectedOffset = window.scrollY + article.getBoundingClientRect().top;
        if (locatePending) {
          locatePending = false;
          emphasize(article);
        }
        updateTitle();
        article.setAttribute('data-site-enhancer-selected', '');
        return;
      }
    }
  }
  function changesHeader(record: MutationRecord) {
    const target = record.target as Element;
    if (target.closest(TIMELINE_CELL)) return false;
    if (unmeasuredHeaderElements.includes(target)) return true;
    if (record.type === 'attributes') return target.matches(HEADER_TARGET);
    if (target.closest(HEADER_CONTROL)) return true;
    return Array.from(record.addedNodes).some(node => {
      if (node.nodeType !== 1) return false;
      const element = node as Element;
      return !element.matches(TIMELINE_CELL) && (element.matches(HEADER_TARGET) ||
        (!!element.firstElementChild && !!element.querySelector(HEADER_TARGET)));
    });
  }
  function setHeaderHeight(height = 54) {
    const value = `${height >= 32 && height <= 120 ? height : 54}px`;
    if (root.style.getPropertyValue('--se-column-header-height') !== value) {
      root.style.setProperty('--se-column-header-height', value);
    }
  }
  function syncHeader() {
    if (!panel) return;
    if (measuredHeader?.isConnected) return setHeaderHeight(measuredHeader.getBoundingClientRect().height);
    if (measuredHeader) sizeObserver?.unobserve(measuredHeader);
    measuredHeader?.removeAttribute('data-site-enhancer-column-header');
    measuredHeader = undefined;
    const primary = document.querySelector(PRIMARY_COLUMN);
    let candidate = primary?.querySelector(HEADER_CONTROL);
    let height: number | undefined;
    const unmeasured: Element[] = [];
    while (candidate && candidate !== primary) {
      const rect = candidate.getBoundingClientRect();
      if (rect.height >= 32 && rect.height <= 120 && Math.abs(rect.top) < 2 && (candidate.matches('[data-page-header],[data-top-chrome]') || parseFloat(getComputedStyle(candidate).borderBottomWidth) > 0)) {
        measuredHeader = candidate;
        height = rect.height;
        measuredHeader.setAttribute('data-site-enhancer-column-header', '');
        sizeObserver?.observe(measuredHeader, { box: 'border-box' });
        break;
      }
      unmeasured.push(candidate);
      candidate = candidate.parentElement;
    }
    unmeasuredHeaderElements = measuredHeader ? [] : unmeasured;
    setHeaderHeight(height);
  }
  function syncNativeNav() {
    // X removes the home label at its viewport breakpoint. Compact CSS only hides it,
    // so checking DOM text is independent of the width we assign to the banner.
    const home = document.querySelector('header[role="banner"] nav a[href="/home"]');
    const icon = home?.querySelector('svg');
    // Ignore notification counts and accessible text inside the icon wrapper.
    const hasLabel = home && Array.from(home.querySelectorAll('span')).some(span =>
      span.textContent?.trim() && !icon?.closest('div')?.contains(span));
    const compact = !!icon && !hasLabel;
    if (nativeCompact !== compact) {
      nativeCompact = compact;
      renderWidths();
    }
  }
  function renderWidths(width?: number) {
    if (!panel) return;
    width ??= viewportWidth();
    renderedWidth = width;
    const { nav, feed, detail } = columnGeometry(width, collapsed || nativeCompact ? { ...widths, nav: 88 } : widths);
    root.style.setProperty('--se-nav', `${nav}px`);
    root.style.setProperty('--se-feed', `${feed}px`);
    root.style.setProperty('--se-feed-gutter', `${gutterPixels(widths.feedGutter, feed)}px`);
    for (const doc of frameDocuments.values()) doc.documentElement.style.setProperty('--se-detail-gutter', String(widths.detailGutter));
    root.style.setProperty('--se-detail', `${detail}px`);
    root.toggleAttribute('data-site-enhancer-compact-nav', nav < 180);
    renderToggle();
    widthControl?.sync();
    dividers.forEach((divider, index) => {
      divider.hidden = index === 0 && (collapsed || nativeCompact);
      divider.style.left = `${index === 0 ? nav : nav + feed}px`;
      divider.setAttribute('aria-valuenow', String(index === 0 ? nav : feed));
      divider.setAttribute('aria-valuemin', String(index === 0 ? 88 : feedWidth(width - nav, .25)));
      divider.setAttribute('aria-valuemax', String(index === 0 ? 280 : feedWidth(width - nav, .75)));
    });
  }
  function renderTheme() {
    if (!panel) return;
    const background = getComputedStyle(document.body).backgroundColor;
    const channels = background.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    const dark = channels && channels.reduce((sum, value) => sum + value, 0) < 384 && background !== 'rgba(0, 0, 0, 0)';
    root.style.setProperty('--se-native-bg', background === 'rgba(0, 0, 0, 0)' ? '#fff' : background);
    panel.toggleAttribute('data-dark', !!dark);
    panel.style.setProperty('--se-native-text', dark ? '#e7e9ea' : '#0f1419');
    panel.style.setProperty('--se-native-muted', dark ? '#939da6' : '#65717b');
    navToggle?.style.setProperty('--se-toggle-bg', `var(--se-x-bg,${background === 'rgba(0, 0, 0, 0)' ? '#fff' : background})`);
    navToggle?.style.setProperty('--se-toggle-fg', `var(--se-x-muted,${dark ? '#939da6' : '#536471'})`);
    navToggle?.style.setProperty('--se-toggle-hover', dark ? '#e7e9ea' : '#0f1419');
  }
  function adjust(kind: number, delta: number, snap = false) {
    const width = viewportWidth();
    const { nav, feed } = columnGeometry(width, collapsed || nativeCompact ? { ...widths, nav: 88 } : widths);
    if (kind === 0) { collapsed = false; widths.nav = Math.max(88, Math.min(280, nav + delta)); }
    else widths.share = adjustedFeedShare(width - nav, feed + delta, snap);
    renderWidths(width);
  }
  function move(event: PointerEvent) {
    if (!drag) return;
    widths = { ...drag.widths };
    adjust(drag.kind, event.clientX - drag.x, true);
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
    clearTimeout(structureTimer);
    structureTimer = undefined;
    hidePrevious();
    cancelHover();
    clearTimeout(followTimer);
    clearTimeout(copyLinkTimer);
    copyLinkTimer = undefined;
    if (!mediaEnhanced) media.remove();
    else {
      media.close();
      media.setFeedPaused(false);
    }
    navToggle?.remove();
    navToggle = undefined;
    if (selected || frame) options.releaseDetail?.();
    selected = undefined;
    clearFrames();
    drag = undefined;
    bodyObserver?.disconnect();
    headerObserver?.disconnect();
    if (headerFrame !== undefined) window.cancelAnimationFrame(headerFrame);
    headerFrame = undefined;
    sizeObserver?.disconnect();
    measuredHeader?.removeAttribute('data-site-enhancer-column-header');
    measuredHeader = undefined;
    unmeasuredHeaderElements = [];
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = undefined;
    selectedOffset = undefined;
    locatePending = false;
    panel?.remove();
    panel = undefined;
    widthControl = undefined;
    renderedWidth = undefined;
    nativeCompact = false;
    frame = undefined;
    dividers.forEach(divider => divider.remove());
    dividers = [];
    localize = [];
    lastStatus = undefined;
    for (const name of ['data-site-enhancer-columns', 'data-site-enhancer-compact-nav', 'data-site-enhancer-resizing']) root.removeAttribute(name);
    for (const name of ['--se-native-bg', '--se-nav', '--se-feed', '--se-feed-gutter', '--se-detail', '--se-column-header-height']) root.style.removeProperty(name);
  }
  function refresh() {
    if (disposed) return;
    if (observedBody !== document.body) observeStructure();
    const width = enabled ? viewportWidth() : 0;
    if (width < COLUMNS_MIN_WIDTH || isNativeRoute(location.pathname)) {
      if (panel) unmount();
      return;
    }
    structure = document.querySelector(COLUMN_MAIN);
    if (!structure) {
      // X removes the column for several hundred milliseconds between routes; keep the layout meanwhile.
      if (panel) structureTimer ??= setTimeout(unmount, STRUCTURE_GRACE_MS);
      return;
    }
    clearTimeout(structureTimer);
    structureTimer = undefined;
    if (!panel && root.matches(WEB) && document.readyState === 'loading') return;
    if (!sheet.isConnected) (document.head ?? root).append(sheet);
    if (panel && !panel.isConnected) unmount();
    mount();
    if (!panel) return;
    root.toggleAttribute('data-site-enhancer-columns', true);
    if (width !== renderedWidth || !root.style.getPropertyValue('--se-feed')) renderWidths(width);
    if (!measuredHeader?.isConnected) syncHeader();
  }
  /** X closes a video's context menu only when a click reaches its own document. Clicks in
   * another document (timeline vs. detail frame) and clicks this layout intercepts never do. */
  let dismissing = false;
  function dismissMenus(doc: Document) {
    const view = doc.defaultView;
    if (dismissing || !view || !doc.body || !doc.querySelector('#layers [role="menu"], html[data-app-version] [role="menu"]')) return;
    dismissing = true;
    try { doc.body.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, view, button: 0 })); }
    finally { dismissing = false; }
  }
  function click(event: MouseEvent) {
    if (dismissing) return openFromClick(event);
    widthControl?.dismissOutside(event.target as Node | null);
    const source = (event.target as Node | null)?.ownerDocument ?? document;
    for (const doc of [document, ...frameDocuments.values()]) if (doc !== source) dismissMenus(doc);
    const native = !event.defaultPrevented;
    openFromClick(event);
    if (native && event.defaultPrevented) dismissMenus(source);
  }
  function openFromClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target && (event.target as Element).nodeType === 1 ? event.target as Element : undefined;
    if (!target?.closest(PRIMARY_COLUMN) || !target.closest(POST)) return;
    if ((panel && active()) || mediaEnhanced) {
      if (media.handleClick(event)) return;
    }
    if (!panel || !active()) return;
    if (target.closest(PLAYER) || target.closest('button,[role="button"],input,textarea,select,video,[data-testid="videoComponent"],[contenteditable="true"]')) return;
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
    returnFocus = (link ?? article.parentElement?.closest(POST_LINK) ?? article) as HTMLElement;
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = article;
    selectedArticle.setAttribute('data-site-enhancer-selected', '');
    history.select(url);
  }
  /** Enter on a focused post (X's j/k focus) opens it in the detail pane instead of replacing the timeline. */
  function openFocused(event: KeyboardEvent) {
    // X reserves L for Like. Unmodified brackets are free in its web shortcut list.
    if (selected && panel && !event.isComposing && !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      (event.key === '[' || event.key === ']')) {
      const target = event.target as HTMLElement;
      if (!target.closest || target.isContentEditable || target.closest('input,textarea,select,[contenteditable="true"]') ||
        document.querySelector(X_OVERLAY_SELECTOR) || target.ownerDocument.querySelector(X_OVERLAY_SELECTOR)) return;
      let destination: HTMLElement | undefined;
      if (event.key === ']' && target.ownerDocument === document && target.closest(PRIMARY_COLUMN) && frame) {
        const articles = frameDocuments.get(frame)?.querySelectorAll<HTMLElement>(PRIMARY_POST);
        if (articles) destination = Array.from(articles).find(article => detailUrl(postPermalink(article) ?? '', location.origin) === selected) ?? articles[0];
      } else if (event.key === '[' && target.ownerDocument === frame?.contentDocument) {
        destination = selectedArticle as HTMLElement ?? returnFocus;
      }
      destination = destination?.parentElement?.closest<HTMLElement>(POST_LINK) ?? destination;
      if (destination?.isConnected) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!destination.hasAttribute('tabindex')) destination.tabIndex = -1;
        destination.focus({ preventScroll: true });
      }
      return;
    }
    if (!panel || event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.repeat ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !active()) return;
    const article = event.target && (event.target as Element).nodeType === 1 ? focusedPost(event.target as Element) : undefined;
    if (!article || !article.closest(PRIMARY_COLUMN)) return;
    const url = detailUrl(postPermalink(article) ?? '', location.origin);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    returnFocus = event.target as HTMLElement;
    if (article.ownerDocument === document) {
      selectedArticle?.removeAttribute('data-site-enhancer-selected');
      selectedArticle = article;
      selectedArticle.setAttribute('data-site-enhancer-selected', '');
    }
    history.select(url);
  }
  /** Escape closes details unless a viewer, dialog, menu or editor is using it. */
  function closeOnEscape(event: KeyboardEvent) {
    if (document.fullscreenElement || !panel || !selected || event.key !== 'Escape' || event.defaultPrevented || event.isComposing ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !active()) return;
    const target = event.target && (event.target as Element).nodeType === 1 ? event.target as Element : undefined;
    if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"],dialog')) return;
    const source = target?.ownerDocument ?? document;
    if (document.querySelector(X_OVERLAY_SELECTOR) || (source !== document && source.querySelector(X_OVERLAY_SELECTOR))) return;
    event.preventDefault();
    history.select(undefined);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function storage(event: StorageEvent) {
    if (event.key === COLUMNS_COLLAPSED_KEY) { collapsed = event.newValue === 'true'; renderWidths(); return; }
    if (event.key !== COLUMNS_WIDTH_KEY) return;
    try { widths = parseColumnWidths(JSON.parse(event.newValue ?? 'null')); renderWidths(); } catch { /* Ignore invalid cross-tab data. */ }
  }
  let structure: Element | null = null;
  let structureFrame: number | undefined;
  let structureTimer: ReturnType<typeof setTimeout> | undefined;
  const structureObserver = new MutationObserver(() => {
    if (!enabled || structureFrame !== undefined) return;
    if (panel?.isConnected && structure?.matches(COLUMN_MAIN) && structure.isConnected &&
      sheet.isConnected && root.hasAttribute('data-site-enhancer-columns') && root.style.getPropertyValue('--se-feed')) return;
    // Coalesce streamed fragments and transient SPA removals before the next paint.
    structureFrame = window.requestAnimationFrame(() => { structureFrame = undefined; refresh(); });
  });
  let observedBody: HTMLElement | null = null;
  const observeStructure = () => {
    observedBody = document.body;
    structureObserver.disconnect();
    structureObserver.observe(root, { childList: true, attributes: true,
      attributeFilter: ['data-app-env', 'data-app-version', 'data-site-enhancer-columns', 'style'] });
    if (document.body) structureObserver.observe(document.body, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['data-testid', 'class'] });
  };
  observeStructure();
  document.addEventListener('focusin', follow);
  document.addEventListener('pointermove', hover);
  window.addEventListener('scroll', scrolling, { capture: true, passive: true });
  window.addEventListener('wheel', scrolling, { capture: true, passive: true });
  document.addEventListener('pointerout', hover);
  document.addEventListener('click', click, true);
  window.addEventListener('keydown', openFocused, true);
  document.addEventListener('keydown', closeOnEscape);
  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('resize', refresh);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', blur);
  window.addEventListener('storage', storage);
  window.addEventListener('message', detailReady);
  return {
    setEnabled(value: boolean) { enabled = value; media.setPlayback(value || mediaEnhanced); refresh(); },
    setMediaEnhanced(value: boolean) {
      mediaEnhanced = value;
      media.setPlayback(enabled || mediaEnhanced);
      if (mediaEnhanced && document.body) media.attach(document);
      else if (!enabled && !mediaEnhanced) media.remove();
    },
    onNavigate() {
      // Dialog routes such as quote and compose keep the timeline underneath, so keep its detail too.
      if (panel && !history.restore() && !isXOverlayRoute(location.pathname)) closeDetail(false);
      syncHeader();
      refresh();
    },
    remove() {
      disposed = true;
      stopVideoRestore?.();
      mediaEnhanced = false;
      structureObserver.disconnect();
      if (structureFrame !== undefined) window.cancelAnimationFrame(structureFrame);
      media.setPlayback(false);
      langObserver.disconnect();
      unmount();
      media.remove();
      sheet.remove();
      history.remove();
      document.removeEventListener('focusin', follow);
      document.removeEventListener('pointermove', hover);
      window.removeEventListener('scroll', scrolling, true);
      window.removeEventListener('wheel', scrolling, true);
      document.removeEventListener('pointerout', hover);
      document.removeEventListener('click', click, true);
      window.removeEventListener('keydown', openFocused, true);
      document.removeEventListener('keydown', closeOnEscape);
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
