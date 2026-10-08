import { installXCopyMenu } from '../utils/x-menu';

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  main(ctx) {
    ctx.onInvalidated(installXCopyMenu());
  },
});
