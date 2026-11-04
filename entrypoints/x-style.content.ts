import { DETAIL_FRAME_CSS, DETAIL_FRAME_NAME, installXColumns } from '../utils/x-columns';
import { installXStyle } from '../utils/x-style';
import { installXTheme } from '../utils/x-theme';
import { xStyleSetting, xThemeSetting } from '../utils/x-settings';

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  allFrames: true,
  runAt: 'document_start',
  main(ctx) {
    // Apply the page-local cached choices immediately, then sync with the extension settings.
    const isDetail = window.top !== window && window.name === DETAIL_FRAME_NAME;
    // Other frames are not extension-owned detail views.
    if (window.top !== window && !isDetail) return;
    const xStyle = installXStyle();
    if (isDetail) {
      document.documentElement.setAttribute('data-site-enhancer-x', 'clean');
      const frameStyle = document.createElement('style');
      frameStyle.id = 'site-enhancer-detail-frame-style';
      frameStyle.textContent = DETAIL_FRAME_CSS;
      (document.head ?? document.documentElement).append(frameStyle);
      ctx.onInvalidated(() => frameStyle.remove());
    }
    const columns = isDetail ? undefined : installXColumns({
      async prepareDetail(url) {
        const response = await browser.runtime.sendMessage({ type: 'x-detail-prepare', url, token: crypto.randomUUID(), language: document.documentElement.lang || 'en' });
        if (!response?.ok || typeof response.url !== 'string') throw new Error('Detail frame unavailable');
        return response.url;
      },
      releaseDetail() {
        if (ctx.isValid) void browser.runtime.sendMessage({ type: 'x-detail-release' }).catch(() => {});
      },
    });
    const setStyle = (value: import('../utils/x-style').XStyle) => {
      xStyle.setStyle(value);
      if (isDetail) document.documentElement.setAttribute('data-site-enhancer-x', 'clean');
      columns?.setEnabled(value === 'columns');
    };
    if (columns) columns.setEnabled(document.documentElement.getAttribute('data-site-enhancer-x') === 'columns');
    const xTheme = installXTheme();
    void xStyleSetting.get().then(value => { if (ctx.isValid) setStyle(value); });
    void xThemeSetting.get().then(value => { if (ctx.isValid) xTheme.setTheme(value); });
    const stopStyleWatch = xStyleSetting.watch(setStyle);
    const stopThemeWatch = xThemeSetting.watch(xTheme.setTheme);
    ctx.onInvalidated(() => {
      // Chrome has already removed listeners when the extension context is destroyed.
      if (!browser.runtime.id) return;
      stopStyleWatch();
      stopThemeWatch();
    });
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => {
      xStyle.setPage(newUrl.pathname);
      columns?.onNavigate();
    });
    ctx.onInvalidated(() => columns?.remove());
    ctx.onInvalidated(xStyle.remove);
    ctx.onInvalidated(xTheme.remove);
  },
});
