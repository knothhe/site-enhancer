/** Dispatched on a video (cancelable) just before X calls play(). The isolated
 * content script cancels it to refuse a video that may not play before it starts. */
export const VIDEO_PLAY_REQUEST = 'site-enhancer-video-play-request';
/** Marks a detail iframe that is loading or switching in the background before it is shown and attached. */
export const DETAIL_PENDING_ATTR = 'data-site-enhancer-detail-pending';

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

/** A detail frame that is preloading on hover or still switching in the background is not visible
 * or attached to the parent's playback rules yet. Hold its autoplay (and suppress eager media preloading)
 * until the frame is actually shown, then resume only the first video in document order. */
export function holdPreloadedAutoplay(win: Window & typeof globalThis) {
  const doc = win.document;
  const frame = win.frameElement as HTMLElement | null;
  const isPending = () => !!frame && (frame.hidden || frame.hasAttribute(DETAIL_PENDING_ATTR));
  if (!isPending()) return () => {};
  const held = new Map<HTMLVideoElement, string | null>();
  function request(event: Event) {
    const video = event.target as HTMLVideoElement;
    if (video.tagName !== 'VIDEO' || !isPending()) return;
    if (!held.has(video)) {
      held.set(video, video.getAttribute('preload'));
      if (video.preload !== 'none') video.preload = 'none';
    }
    event.preventDefault();
  }
  const observer = new win.MutationObserver(() => {
    if (isPending()) return;
    remove();
    const candidates: HTMLVideoElement[] = [];
    for (const [video, preload] of held) {
      if (preload === null) video.removeAttribute('preload');
      else video.setAttribute('preload', preload);
      if (video.isConnected && video.paused) candidates.push(video);
    }
    held.clear();
    if (!candidates.length) return;
    candidates.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    // Through the gated play() so the parent's playback rules already attached to a shown frame still apply.
    void candidates[0].play()?.catch(() => {});
  });
  function remove() {
    observer.disconnect();
    doc.removeEventListener(VIDEO_PLAY_REQUEST, request, true);
  }
  observer.observe(frame!, { attributes: true, attributeFilter: ['hidden', DETAIL_PENDING_ATTR] });
  doc.addEventListener(VIDEO_PLAY_REQUEST, request, true);
  return remove;
}
