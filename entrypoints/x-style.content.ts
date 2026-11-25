import { preserveWebStyles } from '../utils/x-dom';
import { DETAIL_READY_MESSAGE, observeDetailReady } from '../utils/x-detail-ready';
import { DETAIL_FRAME_CSS, DETAIL_FRAME_NAME, installXColumns } from '../utils/x-columns';
import { installXStyle, isXOverlayRoute } from '../utils/x-style';
import { installXTheme } from '../utils/x-theme';
import { holdPreloadedAutoplay } from '../utils/x-video-gate';
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
    const xStyle = installXStyle(undefined, isDetail);
    if (isDetail) {
      const frameStyle = document.createElement('style');
      frameStyle.id = 'site-enhancer-detail-frame-style';
      frameStyle.textContent = DETAIL_FRAME_CSS;
      (document.head ?? document.documentElement).append(frameStyle);
      ctx.onInvalidated(preserveWebStyles([frameStyle]));
      ctx.onInvalidated(() => frameStyle.remove());
      ctx.onInvalidated(holdPreloadedAutoplay(window));
      ctx.onInvalidated(observeDetailReady(document, () => {
        window.parent.postMessage({ type: DETAIL_READY_MESSAGE }, location.origin);
      }));
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
      // Keep the underlying page's styles while X shows a dialog route over it.
      if (!isXOverlayRoute(newUrl.pathname)) xStyle.setPage(newUrl.pathname);
      columns?.onNavigate();
    });
    ctx.onInvalidated(() => columns?.remove());
    ctx.onInvalidated(xStyle.remove);
    ctx.onInvalidated(xTheme.remove);
  },
});
