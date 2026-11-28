import { PLAYER } from './x-dom.ts';
import { VIDEO_PLAY_REQUEST } from './x-video-gate.ts';

/** Page-local like the other layout preferences, so every X tab and detail frame shares it. */
export const VIDEO_VOLUME_KEY = 'site-enhancer:x-video-volume';
export const VIDEO_RATE_KEY = 'site-enhancer:x-video-rate';
export type VideoVolume = { volume: number; muted: boolean };

const DIALOG = '[role="dialog"],[aria-modal="true"]';
const SCRUBBER = '[data-testid="scrubber"]';
const GIF = '[data-testid="tweetGif"]';
const DOCUMENT_POSITION_FOLLOWING = 4;
/** X reacts to a volume control a little after the press, or while it is dragged. */
const USER_VOLUME_MS = 1000;
/** Stop correcting a video that something else keeps resetting, instead of fighting it. */
const MAX_CORRECTIONS = 10;

export function parseVideoVolume(value: string | null): VideoVolume | undefined {
  try {
    const { volume, muted } = JSON.parse(value ?? 'null') as VideoVolume;
    return Number.isFinite(volume) && volume > 0 && volume <= 1 && typeof muted === 'boolean' ? { volume, muted } : undefined;
  } catch { return; }
}
function playerOf(node: Element | null) {
  return node?.closest<HTMLElement>(PLAYER) ?? node?.closest<HTMLElement>('[data-testid="videoComponent"]') ?? undefined;
}
/** X renders GIFs as looping muted <video> elements without scrubbers or sound controls. */
export function isGifVideo(video: HTMLVideoElement) {
  if (video.closest(GIF)) return true;
  if (!video.loop) return false;
  const player = playerOf(video);
  if (!player) return false;
  return !Array.from(player.querySelectorAll(`${SCRUBBER}, [role="slider"], svg[data-icon^="icon-sound-"]`)).some(control => !control.closest('.se-video-chrome'));
}
function isInViewport(video: HTMLVideoElement) {
  const view = video.ownerDocument.defaultView;
  if (!view) return false;
  const rect = video.getBoundingClientRect();
  if (!rect.width && !rect.height) return true;
  const width = view.innerWidth || video.ownerDocument.documentElement.clientWidth;
  const height = view.innerHeight || video.ownerDocument.documentElement.clientHeight;
  if (!width || !height) return true;
  return rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
}
/** Whether a press is on a player's volume control: X pairs the mute button with the only slider
 * outside the scrubber. Labels are localized, so the structure identifies it. */
function onVolumeControl(target: Element, player: HTMLElement) {
  if (target.closest('.se-video-chrome')) return false;
  if (target.closest('button')?.querySelector('svg[data-icon^="icon-sound-"]')) return true;
  for (const slider of player.querySelectorAll('[role="slider"]')) {
    if (slider.closest(SCRUBBER + ',.se-video-chrome')) continue;
    let wrap = slider.parentElement;
    while (wrap && wrap !== player && !wrap.querySelector(':scope>button')) wrap = wrap.parentElement;
    if (wrap && wrap !== player && !wrap.querySelector(SCRUBBER) && wrap.contains(target)) return true;
  }
  return false;
}

/** One video plays at a time across the timeline and detail documents, and every player uses the
 * volume the user last set. X calls play() again whenever an external pause interrupts a video it
 * wants to play, so a video that may not play is refused at play() (see x-video-gate.ts) and only
 * paused as a fallback. */
export function installXVideoPlayback(options: {
  /** Autoplay is off in this document. */
  blocked: (doc: Document) => boolean;
  /** Nothing plays in this document. */
  hidden: (doc: Document) => boolean;
  expanded: () => HTMLElement | undefined;
  /** Optional semantic priority for the focal post in a detail document. */
  isPrimaryPost?: (video: HTMLVideoElement) => boolean;
}) {
  const documents = new Map<Document, () => void>();
  let holder: HTMLVideoElement | undefined;
  // The player the user last pressed or keyed; its video outranks autoplay.
  let chosen: HTMLElement | undefined;
  // Videos stopped to make room. X may still ask for them while the other one plays.
  let displaced = new WeakSet<HTMLVideoElement>();
  let rate = 1;
  let held: HTMLVideoElement | undefined;
  function applyRate(video: HTMLVideoElement) {
    const value = video === held ? 2 : rate;
    if (video.playbackRate !== value && !isGifVideo(video)) video.playbackRate = value;
  }
  function readRate() {
    try {
      const saved = Number(localStorage.getItem(VIDEO_RATE_KEY));
      rate = saved >= .25 && saved <= 4 ? saved : 1;
    } catch { /* Storage is optional. */ }
  }
  function syncRates() {
    documents.forEach((_, doc) => doc.querySelectorAll('video').forEach(applyRate));
  }
  function setRate(video: HTMLVideoElement, value: number) {
    if (isGifVideo(video)) return;
    rate = Math.max(.25, Math.min(4, value));
    try { localStorage.setItem(VIDEO_RATE_KEY, String(rate)); } catch { /* Retain on this page. */ }
    syncRates();
  }
  function holdRate(video: HTMLVideoElement, active: boolean) {
    if (isGifVideo(video) || (!active && held !== video)) return;
    held = active ? video : undefined;
    applyRate(video);
  }
  let volume: VideoVolume | undefined;
  let press: { player: HTMLElement; held: boolean; time: number; volumeControl: boolean; level?: number } | undefined;
  let corrections = new WeakMap<HTMLVideoElement, { count: number; time: number }>();

  const playing = (video: HTMLVideoElement | undefined) => !!video && !video.paused && !video.ended;
  const userPriority = (video: HTMLVideoElement) => chosen?.contains(video) || Boolean(video.closest(DIALOG));
  const activeHolder = (video: HTMLVideoElement | undefined) => {
    if (!playing(video) || !video!.isConnected) return false;
    if (options.expanded()?.contains(video!) || video!.ownerDocument.pictureInPictureElement === video) return true;
    return isInViewport(video!);
  };
  /** Autoplay < focal detail post < started in place < opened in X's media dialog < started in that dialog. */
  function rank(video: HTMLVideoElement) {
    return (options.isPrimaryPost?.(video) ? 1 : 0) + (chosen?.contains(video) ? 2 : 0) + (video.closest(DIALOG) ? 4 : 0);
  }
  function allowed(video: HTMLVideoElement) {
    const doc = video.ownerDocument;
    const expanded = options.expanded();
    if (expanded) return expanded.contains(video);
    if (options.hidden(doc)) return false;
    const user = userPriority(video);
    if (isGifVideo(video)) return user || !options.blocked(doc);
    if (!user && options.blocked(doc)) return false;
    if (!holder || holder === video || !activeHolder(holder)) return true;
    const own = rank(video);
    const other = rank(holder);
    if (own > other) return true;
    if (own < other || displaced.has(video)) return false;
    // In a multi-video post, keep the earlier video playing instead of letting later-loaded siblings steal focus.
    if (!user && holder.ownerDocument === doc) {
      const article = video.closest('article');
      if (article && article === holder.closest('article') &&
        (holder.compareDocumentPosition(video) & DOCUMENT_POSITION_FOLLOWING)) {
        return false;
      }
    }
    return true;
  }
  function stop(video: HTMLVideoElement) {
    displaced.add(video);
    video.pause();
  }
  /** Decide about a video that is already playing. */
  function settle(video: HTMLVideoElement) {
    // Its play event can arrive after another video has already stopped it.
    if (video.paused) return;
    if (!allowed(video)) { stop(video); return; }
    if (isGifVideo(video)) return;
    applyRate(video);
    const before = holder;
    holder = video;
    displaced.delete(video);
    if (before && before !== video && !before.paused) stop(before);
  }

  function canUnmute(video: HTMLVideoElement) {
    // Browsers pause a video that is unmuted before the user has interacted with the page.
    const activation = (view: Window | null | undefined) => !!view && view.navigator.userActivation?.hasBeenActive !== false;
    return activation(video.ownerDocument.defaultView) || (video.ownerDocument !== document && activation(window));
  }
  function applyVolume(video: HTMLVideoElement) {
    if (!volume || !documents.has(video.ownerDocument) || isGifVideo(video)) return;
    const level = Math.abs(video.volume - volume.volume) > .001;
    const mute = video.muted !== volume.muted && (volume.muted || canUnmute(video));
    if (!level && !mute) return;
    const now = Date.now();
    const recent = corrections.get(video);
    const count = recent && now - recent.time < USER_VOLUME_MS ? recent.count : 0;
    if (count >= MAX_CORRECTIONS) return;
    corrections.set(video, { count: count + 1, time: count ? recent!.time : now });
    const wasPlaying = !video.paused && !video.ended;
    if (level) video.volume = volume.volume;
    if (mute) {
      video.muted = volume.muted;
      // If browser autoplay policy pauses a cross-frame video upon unmuting, fall back to muted playback.
      if (!volume.muted && wasPlaying && video.paused) {
        video.muted = true;
        void video.play()?.catch(() => {});
      }
    }
  }
  function applyAll(except?: HTMLVideoElement) {
    documents.forEach((_dispose, doc) => {
      if (options.hidden(doc)) return;
      for (const video of doc.querySelectorAll<HTMLVideoElement>('video')) {
        if (video !== except && (!video.paused || isInViewport(video))) applyVolume(video);
      }
    });
  }
  /** X reads the element again in its own listener, so change it only after that has run. */
  function later(action: () => void) { setTimeout(action, 0); }
  function userChanged(video: HTMLVideoElement) {
    if (!press?.player.contains(video) || (!press.held && Date.now() - press.time >= USER_VOLUME_MS)) return false;
    // Pressing a muted video anywhere also unmutes it on X.
    return press.volumeControl || (!video.muted && volume?.muted !== false);
  }
  function readVolume() {
    try { volume = parseVideoVolume(localStorage.getItem(VIDEO_VOLUME_KEY)); } catch { /* Optional preference. */ }
  }
  function remember(video: HTMLVideoElement) {
    // Dragging to zero mutes, like X's own control; return to the level before the drag.
    volume = { volume: video.volume || press?.level || 1, muted: video.muted || video.volume === 0 };
    try { localStorage.setItem(VIDEO_VOLUME_KEY, JSON.stringify(volume)); } catch { /* Keep it for this page. */ }
    applyAll(video);
  }
  function stored(event: StorageEvent) {
    if (event.key === null || event.key === VIDEO_RATE_KEY) { readRate(); syncRates(); }
    if (event.key !== null && event.key !== VIDEO_VOLUME_KEY) return;
    readVolume();
    applyAll();
  }

  function attach(doc: Document) {
    if (documents.has(doc)) return;
    const asVideo = (event: Event) => {
      const video = event.target as HTMLVideoElement | null;
      return video?.tagName === 'VIDEO' ? video : undefined;
    };
    function request(event: Event) {
      const video = asVideo(event);
      if (video && !allowed(video)) event.preventDefault();
    }
    function play(event: Event) {
      const video = asVideo(event);
      if (!video) return;
      settle(video);
      // The play event may arrive after a pause or a source replacement.
      applyRate(video);
      later(() => applyVolume(video));
    }
    function ready(event: Event) {
      const video = asVideo(event);
      if (video) later(() => applyVolume(video));
    }
    function volumechange(event: Event) {
      const video = asVideo(event);
      if (!video || isGifVideo(video)) return;
      if (userChanged(video)) remember(video);
      else later(() => { if (!userChanged(video)) applyVolume(video); });
    }
    function gesture(event: Event) {
      const target = event.target as Element | null;
      const player = target?.closest ? playerOf(target) : undefined;
      const key = event.type === 'keydown' ? (event as KeyboardEvent).key : undefined;
      if (!player) { if (key === undefined) press = undefined; return; }
      chosen = player;
      for (const video of player.querySelectorAll('video')) { displaced.delete(video); corrections.delete(video); }
      const volumeControl = onVolumeControl(target!, player) || (key !== undefined && /^(m|ArrowUp|ArrowDown)$/i.test(key));
      const level = player.querySelector('video')?.volume || volume?.volume;
      press = { player, held: key === undefined, time: Date.now(), volumeControl, level };
    }
    function release() {
      if (press) { if (press.held) press.time = Date.now(); press.held = false; }
      // The first interaction lifts the browser's unmute restriction.
      if (volume && !volume.muted) later(() => applyAll());
    }
    let scrollPending = false;
    function checkScrolledOut() {
      scrollPending = false;
      if (!holder || holder.ownerDocument !== doc || !playing(holder)) return;
      if (options.expanded()?.contains(holder) || doc.pictureInPictureElement === holder) return;
      if (!isInViewport(holder)) {
        const out = holder;
        if (chosen?.contains(out)) chosen = undefined;
        holder = undefined;
        out.pause();
      }
    }
    function onScroll() {
      if (scrollPending || !holder || holder.ownerDocument !== doc) return;
      scrollPending = true;
      const schedule = doc.defaultView?.requestAnimationFrame ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
      schedule(checkScrolledOut);
    }
    const listeners: Array<[string, (event: Event) => void]> = [
      [VIDEO_PLAY_REQUEST, request], ['play', play], ['loadedmetadata', ready], ['volumechange', volumechange],
      ['pointerdown', gesture], ['keydown', gesture], ['pointerup', release], ['pointercancel', release], ['keyup', release],
    ];
    for (const [type, listener] of listeners) doc.addEventListener(type, listener, true);
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    if (!documents.size) {
      readRate(); readVolume();
      window.addEventListener('storage', stored);
    }
    documents.set(doc, () => {
      for (const [type, listener] of listeners) doc.removeEventListener(type, listener, true);
      doc.removeEventListener('scroll', onScroll, true);
      if (chosen?.ownerDocument === doc) chosen = undefined;
      if (press?.player.ownerDocument === doc) press = undefined;
      if (holder?.ownerDocument === doc) holder = undefined;
    });
    const videos = Array.from(doc.querySelectorAll<HTMLVideoElement>('video'));
    const prioritized = [...videos].sort((a, b) => rank(b) - rank(a));
    for (const video of prioritized) { settle(video); applyVolume(video); applyRate(video); }
  }
  function detach(doc: Document) {
    documents.get(doc)?.();
    if (documents.delete(doc) && !documents.size) window.removeEventListener('storage', stored);
  }
  return {
    attach,
    detach,
    settle, setRate, holdRate, rate: () => rate,
    enter(video: HTMLVideoElement) {
      applyVolume(video); applyRate(video);
      if (video.paused) void video.play()?.catch(() => {});
    },
    setVolume(video: HTMLVideoElement, level: number) {
      if (isGifVideo(video)) return;
      // Keep the last audible level when the slider reaches zero.
      if (level > 0) video.volume = Math.min(1, level);
      video.muted = level <= 0;
      remember(video);
    },
    toggleMute(video: HTMLVideoElement) {
      if (isGifVideo(video)) return;
      const silent = video.muted || video.volume === 0;
      if (silent && video.volume === 0) video.volume = volume?.volume || 1;
      video.muted = !silent;
      remember(video);
    },
    isPlaying: () => activeHolder(holder),
    /** Pause everything in a document except the expanded video, forgetting what the user started there. */
    pause(doc: Document) {
      const expanded = options.expanded();
      if (chosen?.ownerDocument === doc && chosen !== expanded) chosen = undefined;
      if (holder?.ownerDocument === doc && !expanded?.contains(holder)) holder = undefined;
      for (const video of doc.querySelectorAll<HTMLVideoElement>('video')) {
        if (!video.paused && !expanded?.contains(video)) video.pause();
      }
    },
    remove() {
      for (const doc of [...documents.keys()]) detach(doc);
      holder = chosen = press = volume = undefined;
      held = undefined;
      displaced = new WeakSet();
      corrections = new WeakMap();
    },
  };
}
