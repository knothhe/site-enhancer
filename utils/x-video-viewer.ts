import { WEB, PLAYER } from './x-dom.ts';
import { resolveLocale } from './i18n.ts';
import { installXVideoPlayback, isGifVideo } from './x-video-playback.ts';

const PRIMARY_TEST_ID = 'primaryColumn';
const PLAYER_TEST_ID = 'videoPlayer';
const POST_PLAYER = `[data-testid="primaryColumn"] article ${PLAYER}, ${WEB} main article ${PLAYER}`;
const MEDIA = `${PLAYER},video`;
const EXPANDED = 'data-site-enhancer-video-expanded';
const FRAME = 'data-site-enhancer-video-frame';
const BUTTON = 'data-site-enhancer-video-expand';
const SPEED_BUTTON = 'data-site-enhancer-video-speed';
const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;
const CSS = `
${PLAYER} video{object-fit:contain!important}
[${BUTTON}],[${SPEED_BUTTON}]{position:absolute;top:10px;z-index:10;display:flex;align-items:center;gap:6px;min-height:32px;padding:6px 10px;border:1px solid #ffffff35;border-radius:8px;background:#101318df;color:#fff;font:12px/1.4 system-ui;cursor:pointer;box-shadow:0 2px 8px #0003}
[${BUTTON}]{right:10px}
[${SPEED_BUTTON}]{left:10px;font-variant-numeric:tabular-nums;font-weight:600;padding:4px 8px;min-height:28px;opacity:.82;transition:opacity .15s,background .15s}
[${SPEED_BUTTON}]:hover,[${SPEED_BUTTON}]:focus-visible{opacity:1;background:#303640}
[${BUTTON}][data-compact]{padding:6px}
[${BUTTON}][data-compact] span{display:none}
[${BUTTON}]:hover{background:#303640}
[${BUTTON}]:focus-visible,[${SPEED_BUTTON}]:focus-visible{outline:2px solid #fff;outline-offset:3px}
[${BUTTON}] svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;pointer-events:none}
${PLAYER}[${EXPANDED}]{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:58px 24px 24px!important;box-sizing:border-box!important;border:0!important;border-radius:0!important;background:#101318!important;color:#fff!important;overflow:hidden!important}
${PLAYER}[${EXPANDED}]::backdrop{background:#101318}
${PLAYER}[${EXPANDED}]>div{height:100%!important;max-height:100%!important}
/* X uses a padding spacer inside its absolutely positioned player. */
${PLAYER}[${EXPANDED}]>div>div[style*="padding-bottom"]{display:none!important}
${PLAYER}[${EXPANDED}] video{object-fit:contain!important}
${PLAYER}[${EXPANDED}] [${BUTTON}]{top:12px;right:24px;min-height:34px;padding:6px 10px}
${PLAYER}[${EXPANDED}] [${SPEED_BUTTON}]{top:14px;left:24px;min-height:30px;opacity:1}
${PLAYER}[${EXPANDED}] [${BUTTON}][data-compact] span{display:inline}
@media(max-width:600px){${PLAYER}[${EXPANDED}]{padding:58px 8px 8px!important}${PLAYER}[${EXPANDED}] [${BUTTON}]{right:12px}${PLAYER}[${EXPANDED}] [${SPEED_BUTTON}]{left:12px}}
`;

/** Keep X's actual player (including its MediaSource, controls and event handlers)
 * in place. A popover promotes it to the top layer without cloning or moving it. */
export function installXVideoViewer(options: {
  isPrimaryPost?: (video: HTMLVideoElement) => boolean;
} = {}) {
  const documents = new Map<Document, { dispose: () => void; frame?: HTMLIFrameElement }>();
  let feedPaused = false;
  let interruptedFeedVideo: HTMLVideoElement | undefined;
  let expanded: { player: HTMLElement; close: () => void } | undefined;
  const labels = () => resolveLocale(document.documentElement.lang || navigator.language) === 'zh'
    ? { expand: '放大观看', close: '收起视频 · Esc', title: '视频查看', speed: '播放倍速' }
    : { expand: 'Expand video', close: 'Close video · Esc', title: 'Video viewer', speed: 'Playback speed' };

  function blocked(doc: Document) {
    return doc === document ? feedPaused : !!documents.get(doc)?.frame?.hidden;
  }
  const playback = installXVideoPlayback({
    blocked,
    hidden: doc => doc !== document && blocked(doc),
    expanded: () => expanded?.player,
    isPrimaryPost: options.isPrimaryPost,
  });
  function close() { expanded?.close(); }

  function open(player: HTMLElement, button: HTMLButtonElement, frame?: HTMLIFrameElement) {
    close();
    const doc = player.ownerDocument;
    if (!player.isConnected || frame?.hidden || typeof player.showPopover !== 'function') return;
    const focus = doc.activeElement as HTMLElement | null;
    const saved = new Map(['popover', 'role', 'aria-modal', 'aria-label'].map(name => [name, player.getAttribute(name)]));
    const inert: HTMLElement[] = [];
    function isolate(element: HTMLElement) {
      for (let node: HTMLElement | null = element; node?.parentElement; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          const other = sibling as HTMLElement;
          if (other !== node && !other.inert) { other.inert = true; inert.push(other); }
        }
      }
    }
    function restore() {
      if (expanded?.player !== player) return;
      expanded = undefined;
      if (player.matches(':popover-open')) player.hidePopover();
      player.removeAttribute(EXPANDED);
      for (const [name, value] of saved) {
        if (value === null) player.removeAttribute(name); else player.setAttribute(name, value);
      }
      frame?.removeAttribute(FRAME);
      inert.forEach(element => { element.inert = false; });
      doc.removeEventListener('keydown', keydown, true);
      player.removeEventListener('toggle', toggle);
      button.querySelector('span')!.textContent = labels().expand;
      button.title = labels().expand;
      button.setAttribute('aria-label', labels().expand);
      button.setAttribute('aria-expanded', 'false');
      if (blocked(doc)) playback.pause(doc);
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !doc.fullscreenElement) {
        event.preventDefault(); event.stopImmediatePropagation(); close();
      } else if (event.key === 'Tab') {
        const controls = [...player.querySelectorAll<HTMLElement>('button,a[href],input,[tabindex]')]
          .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length);
        const first = controls[0] ?? button;
        const last = controls.at(-1) ?? button;
        if (event.shiftKey && (doc.activeElement === first || !player.contains(doc.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (doc.activeElement === last || !player.contains(doc.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }
    function toggle() { if (!player.matches(':popover-open')) restore(); }
    expanded = { player, close: restore };
    player.setAttribute('popover', 'manual');
    player.setAttribute('role', 'dialog');
    player.setAttribute('aria-modal', 'true');
    player.setAttribute('aria-label', labels().title);
    player.setAttribute(EXPANDED, '');
    frame?.setAttribute(FRAME, '');
    try { player.showPopover(); } catch { restore(); return; }
    documents.forEach((_entry, other) => playback.pause(other));
    const targetVideo = player.querySelector<HTMLVideoElement>('video');
    if (targetVideo?.paused) void targetVideo.play()?.catch(() => {});
    isolate(player);
    if (frame) isolate(frame);
    doc.addEventListener('keydown', keydown, true);
    player.addEventListener('toggle', toggle);
    button.querySelector('span')!.textContent = labels().close;
    button.title = labels().close;
    button.setAttribute('aria-label', labels().close);
    button.setAttribute('aria-expanded', 'true');
    button.focus({ preventScroll: true });
  }

  function attach(doc: Document, frame?: HTMLIFrameElement) {
    if (documents.has(doc)) return;
    const style = doc.createElement('style');
    style.id = 'site-enhancer-video-style';
    style.textContent = CSS;
    (doc.head ?? doc.documentElement).append(style);
    const players = new Map<HTMLElement, { button: HTMLButtonElement; speed?: HTMLButtonElement; video: HTMLVideoElement }>();
    function syncSpeedLabel(button: HTMLButtonElement, video: HTMLVideoElement) {
      const rate = video.playbackRate || 1;
      button.textContent = `${rate}x`;
      button.title = `${labels().speed}: ${rate}x`;
      button.setAttribute('aria-label', button.title);
    }
    function syncPlayer(player: HTMLElement) {
      const existing = players.get(player);
      const video = player.isConnected && player.ownerDocument === doc && player.matches(POST_PLAYER)
        ? player.querySelector<HTMLVideoElement>('video')
        : null;
      if (!video) {
        if (expanded?.player === player) close();
        players.delete(player);
        existing?.button.remove();
        existing?.speed?.remove();
        return;
      }
      if (existing) {
        existing.video = video;
        const width = player.getBoundingClientRect().width;
        existing.button.toggleAttribute('data-compact', width > 0 && width < 260);
        if (!player.contains(existing.button)) player.append(existing.button);
        if (existing.speed) {
          if (isGifVideo(video)) { existing.speed.remove(); existing.speed = undefined; }
          else {
            syncSpeedLabel(existing.speed, video);
            if (!player.contains(existing.speed)) player.append(existing.speed);
          }
        }
        return;
      }
      if (typeof player.showPopover !== 'function') return;
      const button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute(BUTTON, '');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-haspopup', 'dialog');
      const width = player.getBoundingClientRect().width;
      button.toggleAttribute('data-compact', width > 0 && width < 260);
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg><span></span>';
      button.querySelector('span')!.textContent = labels().expand;
      button.title = labels().expand;
      button.setAttribute('aria-label', labels().expand);
      let speed: HTMLButtonElement | undefined;
      if (!isGifVideo(video)) {
        speed = doc.createElement('button');
        speed.type = 'button';
        speed.setAttribute(SPEED_BUTTON, '');
        syncSpeedLabel(speed, video);
      }
      players.set(player, { button, speed, video });
      player.append(button);
      if (speed) player.append(speed);
    }
    function syncChanges(records: MutationRecord[]) {
      if (expanded?.player.ownerDocument === doc && !expanded.player.isConnected) close();
      const changed = new Set<HTMLElement>();
      let elementsRemoved = false;
      function collectMedia(element: HTMLElement) {
        if (element.matches(PLAYER)) changed.add(element);
        if (element.tagName !== 'VIDEO') return;
        const player = element.closest<HTMLElement>(PLAYER);
        if (player) changed.add(player);
        const video = element as HTMLVideoElement;
        // A video may have started before its play event could reach this document.
        if (doc.contains(video)) playback.settle(video);
      }
      for (const { type, target, oldValue, addedNodes, removedNodes } of records) {
        if (type === 'attributes') {
          const element = target as HTMLElement;
          const testId = element.getAttribute('data-testid');
          if (testId === PLAYER_TEST_ID || players.has(element)) changed.add(element);
          if (testId === PRIMARY_TEST_ID || oldValue === PRIMARY_TEST_ID) {
            element.querySelectorAll<HTMLElement>(PLAYER).forEach(player => changed.add(player));
          }
          continue;
        }
        if (!elementsRemoved && removedNodes.length) {
          elementsRemoved = Array.from(removedNodes).some(node => node.nodeType === 1);
        }
        for (const node of addedNodes) {
          if (node.nodeType !== 1) continue;
          const element = node as HTMLElement;
          if (element.hasAttribute(BUTTON) || element.hasAttribute(SPEED_BUTTON)) continue;
          if (element.matches(MEDIA)) collectMedia(element);
          if (element.firstElementChild) element.querySelectorAll<HTMLElement>(MEDIA).forEach(collectMedia);
        }
      }
      if (elementsRemoved) {
        // Detached subtrees can be emptied before the observer sees the removal.
        for (const [player, { button, video }] of players) {
          if (!doc.contains(player) || !player.contains(button) || !player.contains(video)) changed.add(player);
        }
      }
      changed.forEach(syncPlayer);
    }
    function click(event: MouseEvent) {
      const target = event.target as Element | null;
      const speedBtn = target?.closest?.<HTMLButtonElement>(`[${SPEED_BUTTON}]`);
      if (speedBtn && event.button === 0) {
        const player = speedBtn.closest<HTMLElement>(PLAYER);
        const entry = player && players.get(player);
        if (entry && entry.speed === speedBtn) {
          event.preventDefault(); event.stopImmediatePropagation();
          const currentIdx = SPEEDS.indexOf(entry.video.playbackRate as typeof SPEEDS[number]);
          const next = SPEEDS[(currentIdx + 1) % SPEEDS.length];
          entry.video.playbackRate = next;
          syncSpeedLabel(speedBtn, entry.video);
        }
        return;
      }
      const button = target?.closest?.<HTMLButtonElement>(`[${BUTTON}]`);
      if (!button || event.button !== 0) return;
      const player = button.closest<HTMLElement>(PLAYER);
      if (!player || players.get(player)?.button !== button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (expanded?.player === player) close(); else open(player, button, frame);
    }
    const observer = new MutationObserver(syncChanges);
    documents.set(doc, { frame, dispose() {
      if (expanded?.player.ownerDocument === doc) close();
      observer.disconnect();
      doc.removeEventListener('click', click, true);
      players.forEach(({ button, speed }) => { button.remove(); speed?.remove(); });
      style.remove();
    } });
    observer.observe(doc.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid'], attributeOldValue: true,
    });
    doc.addEventListener('click', click, true);
    doc.querySelectorAll<HTMLElement>(POST_PLAYER).forEach(syncPlayer);
    if (blocked(doc)) playback.pause(doc);
    playback.attach(doc);
  }
  return {
    attach,
    /** Single playback and the shared volume also apply while the window is too narrow for three columns. */
    setPlayback(value: boolean) {
      if (value) playback.attach(document); else playback.remove();
    },
    detach(doc: Document) {
      documents.get(doc)?.dispose(); documents.delete(doc);
      if (doc !== document) playback.detach(doc);
    },
    close,
    pause(doc: Document) {
      playback.pause(doc);
    },
    isPlaying: () => playback.isPlaying(),
    setFeedPaused(value: boolean) {
      feedPaused = value;
      if (value) {
        if (expanded?.player.ownerDocument === document) close();
        const active = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
          .find(video => !video.paused && !video.ended);
        if (active) interruptedFeedVideo = active;
        playback.pause(document);
      } else {
        const resume = interruptedFeedVideo;
        interruptedFeedVideo = undefined;
        if (resume?.isConnected && resume.paused && !playback.isPlaying()) {
          const rect = resume.getBoundingClientRect();
          const visible = (!rect.width && !rect.height) ||
            (rect.bottom > 0 && rect.top < (window.innerHeight || document.documentElement.clientHeight));
          if (visible) void resume.play()?.catch(() => {});
        }
      }
    },
    remove() {
      close();
      interruptedFeedVideo = undefined;
      for (const [doc, entry] of documents) {
        entry.dispose();
        if (doc !== document) playback.detach(doc);
      }
      documents.clear();
      feedPaused = false;
    },
  };
}
