/** Dispatched on a video (cancelable) just before X calls play(). The isolated
 * content script cancels it to refuse a blocked autoplay before it starts. */
export const VIDEO_PLAY_REQUEST = 'site-enhancer-video-play-request';

type GatedWindow = Window & typeof globalThis & { __seVideoGateCleanup?: () => void };

/** Pausing a blocked autoplay from the play event is a fight X wins: its autoplay
 * controller calls play() again right away, so muted feed videos loop play/pause,
 * flickering their spinner and racing their clock. Refusing the call itself with
 * NotAllowedError, as a browser autoplay policy would, never starts playback. */
export function installVideoPlayGate(win: GatedWindow) {
  win.__seVideoGateCleanup?.();
  const proto = win.HTMLMediaElement.prototype;
  const original = proto.play;
  const gated = function (this: HTMLMediaElement) {
    if (this instanceof win.HTMLVideoElement && this.isConnected &&
      !this.dispatchEvent(new win.Event(VIDEO_PLAY_REQUEST, { bubbles: true, cancelable: true }))) {
      return Promise.reject(new win.DOMException('Autoplay is paused while post details are open.', 'NotAllowedError'));
    }
    return original.call(this);
  };
  proto.play = gated;
  win.__seVideoGateCleanup = () => {
    if (proto.play === gated) proto.play = original;
    delete win.__seVideoGateCleanup;
  };
}
