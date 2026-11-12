import type { Locale } from './i18n';

export const X_STYLES = ['original', 'clean', 'columns', 'reading'] as const;
export type XStyle = typeof X_STYLES[number];

export const X_STYLE_OPTIONS: Record<Locale, Record<XStyle, { label: string; description: string }>> = {
  zh: {
    original: { label: '原版', description: '保持 X 默认布局' },
    clean: { label: '简洁', description: '隐藏广告、Grok、Premium 和推荐模块，保留搜索' },
    columns: { label: '三栏', description: '简洁布局，右侧查看推文和回复；拖动分隔线调整栏宽，窄窗口使用原生详情' },
    reading: { label: '阅读', description: '移除侧栏和数据，时间线加宽，正文使用衬线大字' },
  },
  en: {
    original: { label: 'Original', description: 'Keep the default X layout' },
    clean: { label: 'Clean', description: 'Hide ads, Grok, Premium and recommendations; keep search' },
    columns: { label: 'Columns', description: 'Clean layout with posts and replies on the right; drag the dividers to resize, narrow windows use the native detail view' },
    reading: { label: 'Reading', description: 'Remove the sidebar and metrics, widen the timeline and use large serif text' },
  },
};

export const X_STYLE_ATTR = 'data-site-enhancer-x';
export const X_PAGE_ATTR = 'data-site-enhancer-x-page';
/** Page-local mirror so the saved style applies synchronously at document_start. */
export const X_STYLE_CACHE_KEY = 'site-enhancer:x-style';
const STYLE_ID = 'site-enhancer-x-style';

export function isXStyle(value: unknown): value is XStyle {
  return typeof value === 'string' && (X_STYLES as readonly string[]).includes(value);
}

export function isXHost(hostname: string | undefined): boolean {
  return !!hostname && /(^|\.)(?:x|twitter)\.com$/i.test(hostname);
}

// Any non-original style; the attribute is removed for the original page.
const clean = `:root[${X_STYLE_ATTR}]`;
const focus = `:root[${X_STYLE_ATTR}="reading"]`;

const home = `[${X_PAGE_ATTR}="home"]`;
const cell = '[data-testid="cellInnerDiv"]';
const sidebar = '[data-testid="sidebarColumn"]';

// Selectors rely on hrefs and data-testid values, which do not change with the UI language.
const navUpsells = [
  'a[href="/i/grok"]', 'a[href^="/i/premium"]', 'a[href^="/i/verified"]', 'a[href^="/i/jobs"]',
  'a[href="/jobs"]', 'a[href$="/communities"]', 'a[href^="/i/monetization"]', 'a[href^="/i/business"]',
  'a[href$="/articles"]', 'a[href="/i/spaces/start"]', 'a[href^="/i/jf/creators"]', 'a[href^="/i/calls"]',
].join(',');

export const X_STYLE_CSS = `
${clean} header[role="banner"] :is(${navUpsells}),
${clean} [data-testid="GrokDrawer"],
${clean} [data-testid="tweet"] button[aria-label*="Grok" i],
${clean} [data-testid="super-upsell-UpsellCardRenderProperties"],
${clean} ${sidebar} :is(section, aside, nav, [data-testid="placementTracking"]),
${clean} ${sidebar} div:has(> :is(section, aside, nav)):not(:has(form[role="search"])),
${clean} ${sidebar} div:has(> div > div > div > div > form[role="search"]) > :not(:has(form[role="search"])),
${clean} [data-testid="primaryColumn"] [data-testid="analytics-preview"],
${clean} [data-testid="primaryColumn"] :is(a[href^="/i/premium"], a[href="/i/account_analytics"]),
${clean} ${cell}:has(article[data-testid="tweet"]):not(:has(time)),
${clean}${home} ${cell}:has([data-testid="UserCell"]),
${clean}${home} ${cell}:has(h2):has(+ ${cell} [data-testid="UserCell"]),
${clean}${home} ${cell}:has(a[href^="/i/connect_people"]),
${focus} ${sidebar},
${focus} header[role="banner"] :is(a[href$="/lists"], a[href^="/i/history"]),
${focus} [data-testid="tweet"] a[href$="/analytics"],
${focus} :is([data-testid="DMDrawer"], [data-testid="chat-drawer-root"]) {
  display: none !important;
}
${focus} div:has(> ${sidebar}) {
  width: min(720px, 100%) !important;
  justify-content: center !important;
}
${focus} div:has(> ${sidebar}) > [data-testid="primaryColumn"] {
  width: 100% !important;
  max-width: 100% !important;
}
/* X caps posts at 600px with an atomic class; without it posts simply stay centered. */
${focus} [data-testid="primaryColumn"] .r-1ye8kvj:has(> section) {
  max-width: none !important;
}

/* Typography only; colors belong to x-theme.ts. */
${clean} [data-testid="tweetText"] {
  line-height: 1.55 !important;
}
${clean} [data-testid="tweet"] :is([data-testid="tweetPhoto"], [data-testid="card.wrapper"]),
${clean} [data-testid="tweet"] div:has(> [data-testid="tweetPhoto"]) {
  border-radius: 14px;
}
${focus} [data-testid="tweetText"] {
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif !important;
  font-size: 17px !important;
  line-height: 1.7 !important;
  letter-spacing: .01em;
}
${focus} [data-testid="tweetText"] * {
  font-family: inherit !important;
}
${focus} [data-testid="tweet"] {
  padding-top: 16px !important;
  padding-bottom: 6px !important;
}
`;

export function readCachedXStyle(): XStyle {
  try {
    const value = localStorage.getItem(X_STYLE_CACHE_KEY);
    return isXStyle(value) ? value : 'original';
  } catch {
    return 'original';
  }
}

/** Installs the stylesheet and returns setters for the active style and current page. */
export function installXStyle(initial: XStyle = readCachedXStyle()) {
  const root = document.documentElement;
  // Replace any element left by a previous extension instance; see remove().
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = X_STYLE_CSS;
  // At document_start <head> may not exist yet.
  (document.head ?? root).appendChild(style);

  function setStyle(value: XStyle) {
    if (value === 'original') root.removeAttribute(X_STYLE_ATTR);
    else root.setAttribute(X_STYLE_ATTR, value);
    try {
      localStorage.setItem(X_STYLE_CACHE_KEY, value);
    } catch { /* Storage may be blocked; the extension setting remains the source of truth. */ }
  }

  function setPage(pathname: string) {
    if (pathname === '/home') root.setAttribute(X_PAGE_ATTR, 'home');
    else root.removeAttribute(X_PAGE_ATTR);
  }

  setStyle(initial);
  setPage(location.pathname);
  return {
    setStyle,
    setPage,
    remove() {
      // A newer instance that replaced this stylesheet now owns the page state.
      if (!style.isConnected) return;
      style.remove();
      root.removeAttribute(X_STYLE_ATTR);
      root.removeAttribute(X_PAGE_ATTR);
    },
  };
}
