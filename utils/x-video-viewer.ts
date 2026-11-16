import { resolveLocale } from './i18n.ts';

const PRIMARY_TEST_ID = 'primaryColumn';
const PLAYER_TEST_ID = 'videoPlayer';
const PLAYER = `[data-testid="${PLAYER_TEST_ID}"]`;
const POST_PLAYER = `[data-testid="${PRIMARY_TEST_ID}"] article ${PLAYER}`;
const MEDIA = `${PLAYER},video`;
const EXPANDED = 'data-site-enhancer-video-expanded';
const FRAME = 'data-site-enhancer-video-frame';
const BUTTON = 'data-site-enhancer-video-expand';
const CSS = `
[data-testid="primaryColumn"] ${PLAYER} video{object-fit:contain!important}
[${BUTTON}]{position:absolute;right:10px;top:10px;z-index:10;display:flex;align-items:center;gap:6px;min-height:32px;padding:6px 10px;border:1px solid #ffffff35;border-radius:8px;background:#101318df;color:#fff;font:12px/1.4 system-ui;cursor:pointer;box-shadow:0 2px 8px #0003}
[${BUTTON}]:hover{background:#303640}
[${BUTTON}]:focus-visible{outline:2px solid #fff;outline-offset:3px}
[${BUTTON}] svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;pointer-events:none}
${PLAYER}[${EXPANDED}]{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:58px 24px 24px!important;box-sizing:border-box!important;border:0!important;border-radius:0!important;background:#101318!important;color:#fff!important;overflow:hidden!important}
${PLAYER}[${EXPANDED}]::backdrop{background:#101318}
${PLAYER}[${EXPANDED}]>div{height:100%!important;max-height:100%!important}
/* X uses a padding spacer inside its absolutely positioned player. */
${PLAYER}[${EXPANDED}]>div>div[style*="padding-bottom"]{display:none!important}
${PLAYER}[${EXPANDED}] video{object-fit:contain!important}
${PLAYER}[${EXPANDED}] [${BUTTON}]{top:12px;right:24px;min-height:34px}
@media(max-width:600px){${PLAYER}[${EXPANDED}]{padding:58px 8px 8px!important}${PLAYER}[${EXPANDED}] [${BUTTON}]{right:12px}}
`;

/** Keep X's actual player (including its MediaSource, controls and event handlers)
 * in place. A popover promotes it to the top layer without cloning or moving it. */
export function installXVideoViewer() {
  const documents = new Map<Document, { dispose: () => void; frame?: HTMLIFrameElement }>();
  let feedPaused = false;
  let expanded: { player: HTMLElement; close: () => void } | undefined;
  // The player the user last pressed or keyed. X calls play() again whenever a video the
  // user started is paused by someone else, so blocking that play loops play/pause every
  // millisecond: audio stutters and crackles. Only autoplay is blocked.
  let chosen: HTMLElement | undefined;
  const labels = () => resolveLocale(document.documentElement.lang || navigator.language) === 'zh'
    ? { expand: '放大观看', close: '收起视频 · Esc', title: '视频查看' }
    : { expand: 'Expand video', close: 'Close video · Esc', title: 'Video viewer' };

  function blocked(doc: Document) {
    return doc === document ? feedPaused : !!documents.get(doc)?.frame?.hidden;
  }
  function exempt(video: HTMLVideoElement, doc: Document) {
    if (expanded) return expanded.player.contains(video);
    return !!chosen?.contains(video) && (doc === document || !blocked(doc));
  }
  function pauseVideos(doc: Document) {
    if (chosen?.ownerDocument === doc && chosen !== expanded?.player) chosen = undefined;
    for (const video of doc.querySelectorAll<HTMLVideoElement>('video')) {
      if (!video.paused && !expanded?.player.contains(video)) video.pause();
    }
  }
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
      button.setAttribute('aria-expanded', 'false');
      if (blocked(doc)) pauseVideos(doc);
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
    documents.forEach((_entry, other) => pauseVideos(other));
    isolate(player);
    if (frame) isolate(frame);
    doc.addEventListener('keydown', keydown, true);
    player.addEventListener('toggle', toggle);
    button.querySelector('span')!.textContent = labels().close;
    button.setAttribute('aria-expanded', 'true');
    button.focus({ preventScroll: true });
  }

  function attach(doc: Document, frame?: HTMLIFrameElement) {
    if (documents.has(doc)) return;
    const style = doc.createElement('style');
    style.id = 'site-enhancer-video-style';
    style.textContent = CSS;
    (doc.head ?? doc.documentElement).append(style);
    const players = new Map<HTMLElement, { button: HTMLButtonElement; video: HTMLVideoElement }>();
    function syncPlayer(player: HTMLElement) {
      const existing = players.get(player);
      const video = player.isConnected && player.ownerDocument === doc && player.matches(POST_PLAYER)
        ? player.querySelector<HTMLVideoElement>('video')
        : null;
      if (!video) {
        if (expanded?.player === player) close();
        players.delete(player);
        existing?.button.remove();
        return;
      }
      if (existing) {
        existing.video = video;
        if (!player.contains(existing.button)) player.append(existing.button);
        return;
      }
      if (typeof player.showPopover !== 'function') return;
      const button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute(BUTTON, '');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-haspopup', 'dialog');
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg><span></span>';
      button.querySelector('span')!.textContent = labels().expand;
      players.set(player, { button, video });
      player.append(button);
    }
    function syncChanges(records: MutationRecord[]) {
      if (expanded?.player.ownerDocument === doc && !expanded.player.isConnected) close();
      const changed = new Set<HTMLElement>();
      const pauseAdded = blocked(doc);
      let elementsRemoved = false;
      function collectMedia(element: HTMLElement) {
        if (element.matches(PLAYER)) changed.add(element);
        if (element.tagName !== 'VIDEO') return;
        const player = element.closest<HTMLElement>(PLAYER);
        if (player) changed.add(player);
        const video = element as HTMLVideoElement;
        // A video may have started before its play event could reach this document.
        if (pauseAdded && doc.contains(video) && !video.paused && !exempt(video, doc)) video.pause();
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
          if (element.hasAttribute(BUTTON)) continue;
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
      const button = target?.closest?.<HTMLButtonElement>(`[${BUTTON}]`);
      if (!button || event.button !== 0) return;
      const player = button.closest<HTMLElement>(PLAYER);
      if (!player || players.get(player)?.button !== button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (expanded?.player === player) close(); else open(player, button, frame);
    }
    function gesture(event: Event) {
      const player = (event.target as Element | null)?.closest?.<HTMLElement>(PLAYER);
      if (player) chosen = player;
    }
    function play(event: Event) {
      const video = event.target as HTMLVideoElement;
      if (video.tagName !== 'VIDEO') return;
      if (exempt(video, doc)) {
        // Keep a single audible video across the timeline and detail documents.
        if (!expanded) documents.forEach((_entry, other) => { if (other !== doc) pauseVideos(other); });
      } else if (blocked(doc) || expanded) video.pause();
    }
    const observer = new MutationObserver(syncChanges);
    documents.set(doc, { frame, dispose() {
      if (expanded?.player.ownerDocument === doc) close();
      if (chosen?.ownerDocument === doc) chosen = undefined;
      observer.disconnect();
      doc.removeEventListener('click', click, true);
      doc.removeEventListener('play', play, true);
      doc.removeEventListener('pointerdown', gesture, true);
      doc.removeEventListener('keydown', gesture, true);
      players.forEach(({ button }) => button.remove());
      style.remove();
    } });
    observer.observe(doc.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid'], attributeOldValue: true,
    });
    doc.addEventListener('click', click, true);
    doc.addEventListener('play', play, true);
    doc.addEventListener('pointerdown', gesture, true);
    doc.addEventListener('keydown', gesture, true);
    doc.querySelectorAll<HTMLElement>(POST_PLAYER).forEach(syncPlayer);
    if (blocked(doc)) pauseVideos(doc);
  }
  return {
    attach,
    detach(doc: Document) { documents.get(doc)?.dispose(); documents.delete(doc); },
    close,
    setFeedPaused(value: boolean) {
      feedPaused = value;
      if (value) {
        if (expanded?.player.ownerDocument === document) close();
        pauseVideos(document);
      }
    },
    remove() {
      close();
      documents.forEach(entry => entry.dispose()); documents.clear();
      feedPaused = false;
      chosen = undefined;
    },
  };
}
