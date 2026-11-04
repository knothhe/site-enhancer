import { installDetailHistory } from './x-detail-history.ts';
/** Three-column layout. The timeline remains owned by X; details use a same-origin frame. */
export const COLUMNS_MIN_WIDTH = 1080;
export const COLUMNS_WIDTH_KEY = 'site-enhancer:x-columns-widths';
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
${SCOPE} header[role="banner"]>div,${SCOPE} header[role="banner"]>div>div{width:var(--se-nav)!important}
${SCOPE} main[role="main"]{width:var(--se-feed)!important;max-width:var(--se-feed)!important;flex:0 0 var(--se-feed)!important;margin-right:var(--se-detail)!important}
${SCOPE} main[role="main"]>div,${SCOPE} div:has(>[data-testid="primaryColumn"]),${SCOPE} [data-testid="primaryColumn"]{width:100%!important;max-width:100%!important;min-width:0!important}
${SCOPE} [data-testid="primaryColumn"] .r-1ye8kvj:has(>section){max-width:none!important}
${SCOPE} [data-testid="sidebarColumn"]{display:none!important}
${SCOPE} [data-site-enhancer-selected]{box-shadow:inset 2px 0 color-mix(in srgb,var(--se-x-accent,#1d9bf0) 55%,transparent);background-color:color-mix(in srgb,var(--se-x-accent,#1d9bf0) 4%,transparent)!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] nav a>div>div:last-child:not(:first-child){display:none!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_NewTweet_Button"]{max-width:64px!important}
${SCOPE}[data-site-enhancer-compact-nav] header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"]>div:not(:first-child){display:none!important}
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

export function installXColumns(options: {
  prepareDetail?: (url: string) => Promise<string>;
  releaseDetail?: () => void;
} = {}) {
  const root = document.documentElement;
  const sheet = document.createElement('style');
  sheet.id = 'site-enhancer-columns-style';
  sheet.textContent = COLUMNS_CSS;
  (document.head ?? root).append(sheet);
  let enabled = false;
  let disposed = false;
  let panel: HTMLElement | undefined;
  let frame: HTMLIFrameElement | undefined;
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
    if (url) { if (selected !== url || !frame) openDetail(url); }
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
    catch { showStatus('栏宽已调整，但无法保存', '本次页面仍会使用当前宽度。', 'error'); }
  }
  function showStatus(title: string, description: string, state: 'empty' | 'loading' | 'error' = 'empty') {
    status.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = description;
    status.dataset.state = state;
    const decoration = document.createElement('span');
    decoration.className = 'se-status-icon';
    decoration.append(icon(state));
    status.append(decoration, heading, body, retry);
    status.hidden = false;
  }
  function closeDetail(restoreFocus = true) {
    if (frame || selected) options.releaseDetail?.();
    clearInterval(timer);
    frame?.remove();
    frame = undefined;
    selected = undefined;
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = undefined;
    openLink.hidden = true;
    retry.hidden = true;
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
    showStatus('选择一条推文', '点击时间线中的推文，在这里查看详情和回复。');
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function openDetail(url: string) {
    selectedArticle?.removeAttribute('data-site-enhancer-selected');
    selectedArticle = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find(article =>
      detailUrl(article.querySelector<HTMLAnchorElement>('a[href*="/status/"]:has(time)')?.href ?? '', location.origin) === url);
    selectedArticle?.setAttribute('data-site-enhancer-selected', '');
    clearInterval(timer);
    frame?.remove();
    selected = url;
    openLink.href = url;
    openLink.hidden = false;
    retry.hidden = true;
    showStatus('正在加载详情…', '时间线会保留在原处。', 'loading');
    const current = document.createElement('iframe');
    current.name = DETAIL_FRAME_NAME;
    current.title = '推文详情和回复';
    // Keep native popups, media and forms, but prevent a child route from replacing the timeline.
    current.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
    if (options.prepareDetail) {
      void options.prepareDetail(url).then(prepared => {
        if (frame === current && panel && !disposed) current.src = prepared;
      }).catch(() => {
        if (frame !== current || !panel || disposed) return;
        clearInterval(timer);
        current.remove();
        frame = undefined;
        showStatus('详情暂时无法加载', '请重新加载扩展和页面后重试，或在新标签页查看。', 'error');
        retry.hidden = false;
      });
    } else current.src = url;
    current.style.visibility = 'hidden';
    frame = current;
    panel!.append(current);
    const started = Date.now();
    timer = setInterval(() => {
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
            current.style.visibility = '';
            status.hidden = true;
            retry.hidden = true;
            clearInterval(timer);
            return;
          }
        }
      } catch { /* Cross-origin redirects or a blocked frame fall back to a normal link. */ }
      if (Date.now() - started > 20000) {
        clearInterval(timer);
        current.remove();
        frame = undefined;
        showStatus('详情暂时无法加载', '可以重试，或在新标签页查看。', 'error');
        retry.hidden = false;
      }
    }, 250);
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
  function iconControl(element: HTMLElement, label: string, name: keyof typeof paths) {
    element.className = 'se-column-icon';
    element.setAttribute('aria-label', label);
    element.title = label;
    element.replaceChildren(icon(name));
  }
  function button(label: string, action: () => void, name?: keyof typeof paths) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    if (name) iconControl(element, label, name);
    element.addEventListener('click', action);
    return element;
  }
  function reset() { widths = { ...DEFAULT_COLUMNS }; renderWidths(); save(); }
  function mount() {
    if (panel || !document.body) return;
    panel = document.createElement('aside');
    panel.id = 'site-enhancer-columns';
    panel.setAttribute('aria-label', '推文详情');
    const toolbar = document.createElement('div');
    toolbar.className = 'se-column-toolbar';
    const title = document.createElement('strong');
    title.textContent = '推文详情';
    openLink = document.createElement('a');
    iconControl(openLink, '新标签页', 'external');
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    retry = button('重试', () => { if (selected) openDetail(selected); });
    const search = document.createElement('a');
    search.href = '/explore';
    iconControl(search, '搜索', 'search');
    backButton = button('后退', () => history.back(), 'back');
    forwardButton = button('前进', () => history.forward(), 'forward');
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
    toolbar.append(title, backButton, forwardButton, search, button('恢复栏宽', reset, 'reset'), openLink, button('关闭', () => { history.select(undefined); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }, 'close'));
    status = document.createElement('div');
    status.className = 'se-column-status';
    status.setAttribute('role', 'status');
    panel.append(toolbar, status);
    document.body.append(panel);
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
      divider.setAttribute('aria-label', kind === 0 ? '调整导航栏宽度' : '调整时间线和详情宽度');
      divider.title = '拖动调整宽度；方向键微调；双击恢复默认';
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
    const { nav, feed, detail } = columnGeometry(viewportWidth(), widths);
    root.style.setProperty('--se-nav', `${nav}px`);
    root.style.setProperty('--se-feed', `${feed}px`);
    root.style.setProperty('--se-detail', `${detail}px`);
    root.toggleAttribute('data-site-enhancer-compact-nav', nav < 180);
    dividers.forEach((divider, index) => {
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
  }
  function adjust(kind: number, delta: number) {
    const { nav, feed } = columnGeometry(viewportWidth(), widths);
    if (kind === 0) widths.nav = Math.max(88, Math.min(280, nav + delta));
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
    if (frame || selected) options.releaseDetail?.();
    selected = undefined;
    clearInterval(timer);
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
    if (target.closest('button,[role="button"],input,textarea,select,video,[contenteditable="true"]')) return;
    if (target.ownerDocument.defaultView?.getSelection()?.toString()) return;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const article = target.closest('article')!;
    const href = link?.href ?? article.querySelector<HTMLAnchorElement>('a[href*="/status/"]:has(time)')?.href;
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
  return {
    setEnabled(value: boolean) { enabled = value; refresh(); },
    onNavigate() { if (panel && !history.restore()) closeDetail(false); syncHeader(); refresh(); },
    remove() {
      disposed = true;
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
      window.removeEventListener('blur', blur);
    },
  };
}
