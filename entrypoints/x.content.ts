import { installXCopyMenu } from '../utils/x-menu';

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  allFrames: true,
  main(ctx) {
    if (window.top !== window && window.name !== 'site-enhancer-x-detail') return;
    ctx.onInvalidated(installXCopyMenu());
  },
});
