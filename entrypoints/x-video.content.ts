import { installVideoPlayGate } from '../utils/x-video-gate';

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  main() {
    if (window.top !== window && window.name !== 'site-enhancer-x-detail') return;
    // MAIN scripts have no extension context; the gate replaces any previous one on reinjection.
    installVideoPlayGate(window as Parameters<typeof installVideoPlayGate>[0]);
  },
});
