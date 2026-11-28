import { isGifVideo } from './x-video-playback.ts';
import type { SpeedControl } from './x-video-speed.ts';

const expanded = '[data-site-enhancer-video-expanded]';
const captions = '[data-readomi-subtitles],[data-testid="videoCaptions"],[data-testid="captions"],.vjs-text-track-display';
const control = 'button,[role=slider],.se-video-bar,.se-image-shortcuts,.se-speed';

export const VIDEO_BAR_CSS = `
.se-video-chrome{transition:opacity 200ms}
${expanded}[data-se-idle],${expanded}[data-se-idle] *{cursor:none!important}
${expanded}[data-se-idle] .se-video-chrome{opacity:0}
${expanded}[data-se-idle] .se-video-chrome *{pointer-events:none}
${expanded} [data-se-native-controls]{display:none!important}
/* X's overlay (mini UI badge, time label or full controls) is the videoComponent child beside
 * the video. Hide it unconditionally: X briefly re-renders it without buttons on play/pause.
 * Readomi mounts its captions and toolbar on the player itself, outside this subtree. */
${expanded} [data-testid="videoComponent"]>div:not(:has(video)){display:none!important}
${expanded} video::-webkit-media-controls{display:none!important}
${expanded}{--se-control-size:96px;--se-video-bar-height:var(--se-control-size)}
${expanded}[data-se-idle]{--se-video-bar-height:0px}
${expanded} :is(${captions}){translate:0 calc(-1 * var(--se-video-bar-height));transition:translate 200ms}
@media(prefers-reduced-motion:reduce){${expanded} :is(${captions}){transition:none}}
${expanded} video::-webkit-media-text-track-container{translate:0 calc(-1 * var(--se-video-bar-height))}
.se-video-bar{position:absolute;inset:auto 0 0;box-sizing:border-box;height:var(--se-control-size);padding:20px 16px 12px;pointer-events:auto;background:linear-gradient(to top,#000d,transparent);font-variant-numeric:tabular-nums}
.se-video-row,.se-volume{display:flex;gap:8px;align-items:center}
.se-video-chrome .se-image-shortcuts{bottom:var(--se-video-bar-height)}
.se-video-row{white-space:nowrap}
@media(max-width:420px){
  .se-video-row{gap:4px;flex-wrap:wrap}
  ${expanded}:has(.se-volume:is(:hover,:focus-within)){--se-control-size:140px}
}
.se-video-bar [role=slider]{position:relative;display:flex;align-items:center;height:24px;touch-action:none;cursor:pointer;--se-position:0%}
.se-slider-track{position:relative;width:100%;height:4px;border-radius:4px;background:#fff3}
.se-slider-track i{position:absolute;inset-block:0;background:#fff6}
.se-slider-track::before,.se-slider-track::after{content:'';position:absolute;z-index:1;background:var(--se-x-accent,#1d9bf0)}
.se-slider-track::before{inset:0 auto 0 0;width:var(--se-position);border-radius:inherit}
.se-slider-track::after{top:50%;left:var(--se-position);transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;opacity:0}
.se-video-bar [role=slider]:is(:hover,:focus-visible,[data-dragging]) .se-slider-track{height:6px}
.se-video-bar [role=slider]:is(:hover,:focus-visible,[data-dragging]) .se-slider-track::after{opacity:1}
.se-seek-tip{display:none;position:absolute;bottom:100%;transform:translateX(-50%);border-radius:5px;background:#15191f;padding:2px 5px}
.se-video-bar [role=slider]:is(:hover,[data-dragging]) .se-seek-tip{display:block}
.se-volume{gap:0}
.se-volume [role=slider]{width:0;opacity:0}
.se-volume:is(:hover,:focus-within) [role=slider]{width:72px;margin-inline:8px;opacity:1}
@media(prefers-reduced-motion:reduce){.se-video-chrome{transition:none}}
`;

function time(seconds: number) {
  const s = Math.floor(Number.isFinite(seconds) ? Math.max(0,seconds) : 0);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2,'0');
}

const paths = {
  play:'M7 4l13 8-13 8z', pause:'M8 5v14M16 5v14',
  muted:'M3 9h4l5-4v14l-5-4H3zM16 9l6 6m0-6-6 6',
  low:'M3 9h4l5-4v14l-5-4H3zM16 9a5 5 0 0 1 0 6',
  high:'M3 9h4l5-4v14l-5-4H3zM16 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12',
  pip:'M3 4h18v16H3zM12 12h7v6h-7z',
};

export function mountVideoBar(player: HTMLElement, chrome: HTMLElement, video: HTMLVideoElement, zh: boolean,
  options: { toggleMute(video: HTMLVideoElement): void; setVolume(video: HTMLVideoElement, level: number): void }, close: () => void) {
  const doc = player.ownerDocument, view = doc.defaultView!;
  const events = new view.AbortController();
  const { signal } = events;
  const gif = isGifVideo(video);
  const bar = doc.createElement('div'); bar.className = 'se-video-bar';
  const row = doc.createElement('div'); row.className = 'se-video-row';
  function button(action: () => void) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path/></svg>';
    el.onclick = action;
    return el;
  }
  function label(el: HTMLButtonElement, name: string, icon: keyof typeof paths) {
    el.title = name; el.setAttribute('aria-label',name);
    el.querySelector('path')!.setAttribute('d', paths[icon]);
  }
  const toggle = () => { if (video.paused || video.ended) void video.play()?.catch(() => {}); else video.pause(); };
  const play = button(toggle);
  play.setAttribute('aria-keyshortcuts','Space K');
  const mute = button(() => { options.toggleMute(video); sync(); });
  mute.setAttribute('aria-keyshortcuts','M');
  const pip = button(() => {
    if (doc.pictureInPictureElement === video) void doc.exitPictureInPicture().catch(() => {});
    else void video.requestPictureInPicture().catch(() => {});
  });
  label(pip,zh ? '画中画' : 'Picture in picture','pip');
  const clock = doc.createElement('span'); clock.className = 'se-video-clock';
  const duration = () => Number.isFinite(video.duration) ? Math.max(0,video.duration) : 0;
  const level = () => video.muted ? 0 : video.volume;
  function slider(name: string, max: () => number, value: () => number, step: number,
    set: (value: number) => void, describe: (value: number) => string, tooltip = false) {
    const el = doc.createElement('div'); el.tabIndex = 0; el.setAttribute('role','slider');
    el.setAttribute('aria-label',name); el.setAttribute('aria-valuemin','0');
    const track = doc.createElement('div'); track.className = 'se-slider-track'; el.append(track);
    const tip = doc.createElement('span'); tip.className = 'se-seek-tip';
    if (tooltip) el.append(tip);
    let pointer: number | undefined;
    function update() {
      const current = value(), limit = max();
      el.setAttribute('aria-valuemax',String(limit));
      el.setAttribute('aria-valuenow',String(current)); el.setAttribute('aria-valuetext',describe(current));
      el.style.setProperty('--se-position',(limit ? Math.min(100,current / limit * 100) : 0) + '%');
    }
    function move(e: PointerEvent) {
      if (pointer !== undefined && pointer !== e.pointerId) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !max()) return;
      const fraction = Math.max(0,Math.min(1,(e.clientX - rect.left) / rect.width));
      if (tooltip) { tip.style.left = 'clamp(22px,' + fraction * 100 + '%,calc(100% - 22px))'; tip.textContent = time(fraction * max()); }
      if (pointer !== undefined) { set(fraction * max()); sync(); }
    }
    el.onpointerdown = e => {
      if (e.button || pointer !== undefined) return;
      pointer = e.pointerId; el.setPointerCapture?.(pointer); el.dataset.dragging = '';
      el.focus({preventScroll:true}); e.preventDefault(); move(e);
    };
    el.onpointermove = move;
    function end(e: PointerEvent) {
      if (pointer !== e.pointerId) return;
      pointer = undefined; delete el.dataset.dragging;
    }
    el.onpointerup = e => { if (pointer === e.pointerId) move(e); end(e); };
    el.onpointercancel = el.onlostpointercapture = end;
    el.onkeydown = e => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); close(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const delta = { ArrowRight:step, ArrowLeft:-step, ArrowUp:step, ArrowDown:-step }[e.key];
      let next: number;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = max();
      else if (delta !== undefined) next = Math.min(max(), Math.max(0, value() + delta));
      else return;
      e.preventDefault();
      e.stopPropagation();
      if (max()) set(next);
      sync();
    };
    return {el,track,update};
  }
  const seek = slider(zh ? '播放进度' : 'Seek',duration,() => video.currentTime,5,
    value => { video.currentTime = value; },value => time(value) + ' / ' + time(duration()),true);
  const volume = slider(zh ? '音量' : 'Volume',() => 100,() => Math.round(level()*100),5,
    value => options.setVolume(video,value / 100),value => value + '%');
  const restorePiP = !gif && doc.pictureInPictureEnabled && video.hasAttribute('disablepictureinpicture');
  if (restorePiP) video.removeAttribute('disablepictureinpicture');
  row.append(play);
  if (!gif) {
    const group = doc.createElement('div'); group.className = 'se-volume'; group.append(mute,volume.el);
    row.append(group,clock);
    if (doc.pictureInPictureEnabled) row.append(pip);
  }
  bar.append(seek.el,row); chrome.append(bar);
  function sync() {
    const paused = video.paused || video.ended;
    const playLabel = zh ? '播放' : 'Play', pauseLabel = zh ? '暂停' : 'Pause';
    label(play, paused ? playLabel : pauseLabel, paused ? 'play' : 'pause');
    seek.update();
    if (!gif) {
      const muteLabel = zh ? '静音' : 'Mute', unmuteLabel = zh ? '取消静音' : 'Unmute';
      const sound = level();
      label(mute, sound ? muteLabel : unmuteLabel, sound === 0 ? 'muted' : sound < .5 ? 'low' : 'high');
      volume.update(); clock.textContent = time(video.currentTime) + ' / ' + time(duration());
    }
  }
  function buffered() {
    const ranges = doc.createDocumentFragment(), limit = duration();
    for (let i = 0; limit && i < video.buffered.length; i++) {
      const part = doc.createElement('i');
      part.style.left = video.buffered.start(i) / limit * 100 + '%';
      part.style.width = (video.buffered.end(i) - video.buffered.start(i)) / limit * 100 + '%';
      ranges.append(part);
    }
    seek.track.replaceChildren(ranges);
  }
  let idle = 0, hovered = false;
  function wake() {
    player.removeAttribute('data-se-idle'); view.clearTimeout(idle);
    idle = view.setTimeout(() => {
      if (!video.paused && !video.ended && !hovered && (doc.activeElement === chrome || !chrome.contains(doc.activeElement)) &&
          !chrome.querySelector('[data-site-enhancer-video-popover]:not([hidden]),.se-image-shortcuts:not([hidden])')) player.dataset.seIdle = '';
    },2500);
  }
  function activity(e: Event) {
    const target = e.target as Element;
    hovered = chrome.contains(target) && !!target.closest?.(control);
    wake();
  }
  for (const type of ['pointermove','pointerover']) player.addEventListener(type,activity,{signal});
  player.addEventListener('pointerleave',() => { hovered = false; wake(); },{signal});
  for (const type of ['focusin','focusout']) chrome.addEventListener(type,wake,{signal});
  for (const type of ['play','pause','ended']) video.addEventListener(type,() => { sync(); wake(); },{signal});
  for (const type of ['volumechange','timeupdate','loadedmetadata','durationchange','emptied']) video.addEventListener(type,sync,{signal});
  for (const type of ['progress','loadedmetadata','durationchange','emptied']) video.addEventListener(type,buffered,{signal});
  player.addEventListener('click',e => {
    const target = e.target as Element;
    if (chrome.contains(target) || target.closest('a,button,[role=slider],' + captions)) return;
    e.stopImmediatePropagation(); e.preventDefault(); toggle(); sync(); wake();
  },{capture:true,signal});

  // Find the smallest branch combining the native scrubber and its buttons.
  // X can remount this branch independently of the media element.
  const marker = 'data-se-native-controls';
  const nativeControls = new Set<Element>();
  function hideNative() {
    const nativeBar = '[data-testid="videoControls"],[data-testid="videoControlBar"],' +
      '[data-slot="xds-context-menu-trigger"] > .bottom-0:has(button[data-slot="xds-button"])';
    const anchors = player.querySelectorAll(nativeBar + ',[data-testid="scrubber"],[role=slider],input[type=range]');
    const next = new Set<Element>();
    for (const anchor of anchors) {
      if (chrome.contains(anchor) || anchor.closest(captions)) continue;
      let branch = anchor;
      if (!anchor.matches(nativeBar)) {
        for (let parent = anchor.parentElement; parent && parent !== player; parent = parent.parentElement) {
          if (parent.querySelector('video,' + captions) || parent.contains(chrome)) break;
          if (parent.querySelector('button,[role=button]')) {
            branch = parent;
            break;
          }
        }
      }
      next.add(branch);
    }
    for (const el of nativeControls) if (!next.has(el)) { el.removeAttribute(marker); nativeControls.delete(el); }
    for (const el of next) { el.setAttribute(marker,''); nativeControls.add(el); }
  }
  const observer = new view.MutationObserver(records => {
    const nativeChanged = records.some(record => {
      if (chrome.contains(record.target)) return false;
      return record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1);
    });
    if (nativeChanged) hideNative();
  });
  observer.observe(player,{childList:true,subtree:true,attributes:true,attributeFilter:['role','data-testid']});
  hideNative(); sync(); buffered(); wake();
  return { video, gif, wake,
    mountSpeed(speed?: SpeedControl) {
      if (!speed || gif || speed.root.parentElement === row) return;
      speed.close();
      row.insertBefore(speed.root, pip.parentNode === row ? pip : null);
    },
    remove() {
      if (restorePiP) video.setAttribute('disablepictureinpicture','');
      events.abort(); observer.disconnect(); view.clearTimeout(idle); player.removeAttribute('data-se-idle');
      nativeControls.forEach(el => el.removeAttribute(marker)); bar.remove();
    },
  };
}
