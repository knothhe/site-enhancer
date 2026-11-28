import { WEB, PLAYER } from './x-dom.ts';
import { resolveLocale } from './i18n.ts';
import { installXVideoPlayback, isGifVideo } from './x-video-playback.ts';

const PRIMARY_TEST_ID = 'primaryColumn';
const PLAYER_TEST_ID = 'videoPlayer';
const POST_PLAYER = `[data-testid="primaryColumn"] article ${PLAYER}, ${WEB} main article ${PLAYER}`;
const MEDIA = `${PLAYER},video`;
const EXPANDED = 'data-site-enhancer-video-expanded';
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
${PLAYER}[${EXPANDED}]>div:has(video){height:100%!important;max-height:100%!important}
/* X uses a padding spacer inside its absolutely positioned player. */
${PLAYER}[${EXPANDED}]>div>div[style*="padding-bottom"]{display:none!important}
${PLAYER}[${EXPANDED}] video{object-fit:contain!important}
${PLAYER}[${EXPANDED}] [${BUTTON}]{top:12px;right:24px;min-height:34px;padding:6px 10px}
${PLAYER}[${EXPANDED}] [${SPEED_BUTTON}]{top:14px;left:24px;min-height:30px;opacity:1}
${PLAYER}[${EXPANDED}] [${BUTTON}][data-compact] span{display:inline}
@media(max-width:600px){${PLAYER}[${EXPANDED}]{padding:58px 8px 8px!important}${PLAYER}[${EXPANDED}] [${BUTTON}]{right:12px}${PLAYER}[${EXPANDED}] [${SPEED_BUTTON}]{left:12px}}
`;

/** Keep X's actual player (including its MediaSource, controls and event handlers)
 * in place. Fullscreen lets caption extensions mount on the actual player. */
export function installXVideoViewer(options: {
  nativeVideoUrl?: (video: HTMLVideoElement) => string | undefined;
  isPrimaryPost?: (video: HTMLVideoElement) => boolean;
} = {}) {
  const documents = new Map<Document, { dispose: () => void; frame?: HTMLIFrameElement }>();
  let feedPaused = false;
  let interruptedFeedVideo: HTMLVideoElement | undefined;
  let expanded: { player: HTMLElement; close: () => void } | undefined;
  const labels = () => resolveLocale(document.documentElement.lang || navigator.language) === 'zh'
    ? { native: '在 X 帖子中观看', expand: '全屏观看', close: '退出全屏 · Esc', speed: '播放倍速' }
    : { native: 'Watch on X post', expand: 'Full screen', close: 'Exit full screen · Esc', speed: 'Playback speed' };

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

  function open(player: HTMLElement, button: HTMLButtonElement) {
    close();
    const doc = player.ownerDocument;
    const focus = doc.activeElement as HTMLElement | null;
    function restore() {
      if (expanded?.close !== restore) return;
      expanded = undefined;
      doc.removeEventListener('fullscreenchange', onChange);
      player.removeAttribute(EXPANDED);
      setLabel(button, labels().expand);
      button.setAttribute('aria-expanded', 'false');
      if (doc.fullscreenElement === player) void doc.exitFullscreen().catch(() => {});
      if (blocked(doc)) playback.pause(doc);
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    }
    function onChange() {
      if (doc.fullscreenElement !== player) restore();
    }
    expanded = { player, close: restore };
    doc.addEventListener('fullscreenchange', onChange);
    void player.requestFullscreen().then(() => {
      if (expanded?.close !== restore) {
        if (doc.fullscreenElement === player && expanded?.player !== player) void doc.exitFullscreen().catch(() => {});
        return;
      }
      player.setAttribute(EXPANDED, '');
      setLabel(button, labels().close);
      button.setAttribute('aria-expanded', 'true');
      documents.forEach((_entry, other) => playback.pause(other));
      const video = player.querySelector('video');
      if (video?.paused) void video.play()?.catch(() => {});
      button.focus({ preventScroll: true });
    }, restore);
  }

  function setLabel(button: HTMLButtonElement, label: string) {
    button.querySelector('span')!.textContent = label;
    button.title = label;
    button.setAttribute('aria-label', label);
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
      if (!frame && typeof player.requestFullscreen !== 'function') return;
      const button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute(BUTTON, '');
      if (!frame) button.setAttribute('aria-expanded', 'false');
      const width = player.getBoundingClientRect().width;
      button.toggleAttribute('data-compact', width > 0 && width < 260);
      const icon = frame ? 'M14 3h7v7m0-7L10 14M10 5H4v15h15v-6' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5';
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg><span></span>`;
      setLabel(button, frame ? labels().native : labels().expand);
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
      if (frame) {
        if (frame.hidden) return;
        const url = options.nativeVideoUrl?.(players.get(player)!.video);
        if (url) window.location.assign(url);
        return;
      }
      if (expanded?.player === player) close(); else open(player, button);
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
