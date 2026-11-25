import { PLAYER } from './x-dom.ts';
import { VIDEO_PLAY_REQUEST } from './x-video-gate.ts';

/** Page-local like the other layout preferences, so every X tab and detail frame shares it. */
export const VIDEO_VOLUME_KEY = 'site-enhancer:x-video-volume';
export type VideoVolume = { volume: number; muted: boolean };

const DIALOG = '[role="dialog"],[aria-modal="true"]';
const SCRUBBER = '[data-testid="scrubber"]';
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
/** Whether a press is on a player's volume control: X pairs the mute button with the only slider
 * outside the scrubber. Labels are localized, so the structure identifies it. */
function onVolumeControl(target: Element, player: HTMLElement) {
  if (target.closest('button')?.querySelector('svg[data-icon^="icon-sound-"]')) return true;
  for (const slider of player.querySelectorAll('[role="slider"]')) {
    if (slider.closest(SCRUBBER)) continue;
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
}) {
  const documents = new Map<Document, () => void>();
  let holder: HTMLVideoElement | undefined;
  // The player the user last pressed or keyed; its video outranks autoplay.
  let chosen: HTMLElement | undefined;
  // Videos stopped to make room. X may still ask for them while the other one plays.
  let displaced = new WeakSet<HTMLVideoElement>();
  let volume: VideoVolume | undefined;
  let press: { player: HTMLElement; held: boolean; time: number; volumeControl: boolean; level?: number } | undefined;
  let corrections = new WeakMap<HTMLVideoElement, { count: number; time: number }>();

  const playing = (video: HTMLVideoElement | undefined) => !!video && !video.paused && !video.ended;
  /** Autoplay < started in place < opened in X's media dialog < started in that dialog. */
  function rank(video: HTMLVideoElement) {
    return (chosen?.contains(video) ? 1 : 0) + (video.closest(DIALOG) ? 2 : 0);
  }
  function allowed(video: HTMLVideoElement) {
    const doc = video.ownerDocument;
    const expanded = options.expanded();
    if (expanded) return expanded.contains(video);
    if (options.hidden(doc)) return false;
    const own = rank(video);
    if (!own && options.blocked(doc)) return false;
    if (!holder || holder === video || !playing(holder)) return true;
    const other = rank(holder);
    return own > other || (own === other && !displaced.has(video));
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
    if (!volume || !documents.has(video.ownerDocument)) return;
    const level = Math.abs(video.volume - volume.volume) > .001;
    const mute = video.muted !== volume.muted && (volume.muted || canUnmute(video));
    if (!level && !mute) return;
    const now = Date.now();
    const recent = corrections.get(video);
    const count = recent && now - recent.time < USER_VOLUME_MS ? recent.count : 0;
    if (count >= MAX_CORRECTIONS) return;
    corrections.set(video, { count: count + 1, time: count ? recent!.time : now });
    if (level) video.volume = volume.volume;
    if (mute) video.muted = volume.muted;
  }
  function applyAll(except?: HTMLVideoElement) {
    documents.forEach((_dispose, doc) => {
      for (const video of doc.querySelectorAll<HTMLVideoElement>('video')) if (video !== except) applyVolume(video);
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
      later(() => applyVolume(video));
    }
    function ready(event: Event) {
      const video = asVideo(event);
      if (video) later(() => applyVolume(video));
    }
    function volumechange(event: Event) {
      const video = asVideo(event);
      if (!video) return;
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
    const listeners: Array<[string, (event: Event) => void]> = [
      [VIDEO_PLAY_REQUEST, request], ['play', play], ['loadedmetadata', ready], ['volumechange', volumechange],
      ['pointerdown', gesture], ['keydown', gesture], ['pointerup', release], ['pointercancel', release], ['keyup', release],
    ];
    for (const [type, listener] of listeners) doc.addEventListener(type, listener, true);
    if (!documents.size) {
      readVolume();
      window.addEventListener('storage', stored);
    }
    documents.set(doc, () => {
      for (const [type, listener] of listeners) doc.removeEventListener(type, listener, true);
      if (chosen?.ownerDocument === doc) chosen = undefined;
      if (press?.player.ownerDocument === doc) press = undefined;
      if (holder?.ownerDocument === doc) holder = undefined;
    });
    for (const video of doc.querySelectorAll<HTMLVideoElement>('video')) { settle(video); applyVolume(video); }
  }
  function detach(doc: Document) {
    documents.get(doc)?.();
    if (documents.delete(doc) && !documents.size) window.removeEventListener('storage', stored);
  }
  return {
    attach,
    detach,
    settle,
    /** Pause everything in a document except the expanded video, forgetting what the user started there. */
    pause(doc: Document) {
      const expanded = options.expanded();
      if (chosen?.ownerDocument === doc && chosen !== expanded) chosen = undefined;
      for (const video of doc.querySelectorAll<HTMLVideoElement>('video')) {
        if (!video.paused && !expanded?.contains(video)) video.pause();
      }
    },
    remove() {
      for (const doc of [...documents.keys()]) detach(doc);
      holder = chosen = press = volume = undefined;
      displaced = new WeakSet();
      corrections = new WeakMap();
    },
  };
}
