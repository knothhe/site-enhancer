import { installXCopyMenu } from '../utils/x-menu';
import { xCopyFormatSetting, xScreenshotRoundedSetting, type XCopyFormat } from '../utils/x-settings';

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  allFrames: true,
  main(ctx) {
    if (window.top !== window && window.name !== 'site-enhancer-x-detail') return;
    let copyFormat: XCopyFormat = 'default';
    void xCopyFormatSetting.get().then(value => { if (ctx.isValid) copyFormat = value; });
    let rounded = false;
    void xScreenshotRoundedSetting.get().then(value => { if (ctx.isValid) rounded = value; });
    const stopRounded = xScreenshotRoundedSetting.watch(value => { rounded = value; });
    const stopWatch = xCopyFormatSetting.watch(value => { copyFormat = value; });
    ctx.onInvalidated(() => {
      if (!browser.runtime.id) return;
      stopWatch();
      stopRounded();
    });
    ctx.onInvalidated(installXCopyMenu({
      getCopyFormat: () => copyFormat,
      getRounded: () => rounded,
      setRounded: value => { rounded = value; void xScreenshotRoundedSetting.set(value); },
    }));
  },
});
