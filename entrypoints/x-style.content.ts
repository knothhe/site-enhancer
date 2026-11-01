import { installXStyle } from '../utils/x-style';
import { installXTheme } from '../utils/x-theme';
import { xStyleSetting, xThemeSetting } from '../utils/x-settings';

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  runAt: 'document_start',
  main(ctx) {
    // Apply the page-local cached choices immediately, then sync with the extension settings.
    const xStyle = installXStyle();
    const xTheme = installXTheme();
    void xStyleSetting.get().then(value => { if (ctx.isValid) xStyle.setStyle(value); });
    void xThemeSetting.get().then(value => { if (ctx.isValid) xTheme.setTheme(value); });
    ctx.onInvalidated(xStyleSetting.watch(xStyle.setStyle));
    ctx.onInvalidated(xThemeSetting.watch(xTheme.setTheme));
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => xStyle.setPage(newUrl.pathname));
    ctx.onInvalidated(xStyle.remove);
    ctx.onInvalidated(xTheme.remove);
  },
});
