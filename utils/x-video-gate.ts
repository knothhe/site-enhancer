/** Dispatched on a video (cancelable) just before X calls play(). The isolated
 * content script cancels it to refuse a video that may not play before it starts. */
export const VIDEO_PLAY_REQUEST = 'site-enhancer-video-play-request';

type GatedWindow = Window & typeof globalThis & { __seVideoGateCleanup?: () => void };

/** Pausing a blocked autoplay from the play event is a fight X wins: its autoplay
 * controller calls play() again right away, so muted feed videos loop play/pause,
 * flickering their spinner and racing their clock. Refusing the call itself never starts
 * playback. The error is AbortError, as for a play() interrupted by pause(): X answers
 * NotAllowedError by muting that player and trying again. */
export function installVideoPlayGate(win: GatedWindow) {
  win.__seVideoGateCleanup?.();
  const proto = win.HTMLMediaElement.prototype;
  const original = proto.play;
  const gated = function (this: HTMLMediaElement) {
    if (this instanceof win.HTMLVideoElement && this.isConnected &&
      !this.dispatchEvent(new win.Event(VIDEO_PLAY_REQUEST, { bubbles: true, cancelable: true }))) {
      return Promise.reject(new win.DOMException('Another video has priority over this one.', 'AbortError'));
    }
    return original.call(this);
  };
  proto.play = gated;
  win.__seVideoGateCleanup = () => {
    if (proto.play === gated) proto.play = original;
    delete win.__seVideoGateCleanup;
  };
}

/** A detail frame the timeline preloads on hover is not known to the parent's playback rules yet.
 * Hold its autoplay until the frame is first shown; a discarded preload never plays. */
export function holdPreloadedAutoplay(win: Window & typeof globalThis) {
  const doc = win.document;
  const frame = win.frameElement as HTMLElement | null;
  if (!frame?.hidden) return () => {};
  let held: HTMLVideoElement | undefined;
  function request(event: Event) {
    const video = event.target as HTMLVideoElement;
    if (video.tagName !== 'VIDEO' || !frame!.hidden) return;
    held = video;
    event.preventDefault();
  }
  const observer = new win.MutationObserver(() => {
    if (frame.hidden) return;
    remove();
    // Through the gate's request, so the rules already attached to a shown frame still apply.
    if (held?.isConnected && held.paused && held.dispatchEvent(new win.Event(VIDEO_PLAY_REQUEST, { bubbles: true, cancelable: true }))) {
      void held.play()?.catch(() => {});
    }
  });
  function remove() {
    observer.disconnect();
    doc.removeEventListener(VIDEO_PLAY_REQUEST, request, true);
  }
  observer.observe(frame, { attributes: true, attributeFilter: ['hidden'] });
  doc.addEventListener(VIDEO_PLAY_REQUEST, request, true);
  return remove;
}
