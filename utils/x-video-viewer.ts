import { resolveLocale } from './i18n.ts';

const PLAYER = '[data-testid="videoPlayer"]';
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
  const labels = () => resolveLocale(document.documentElement.lang || navigator.language) === 'zh'
    ? { expand: '放大观看', close: '收起视频 · Esc', title: '视频查看' }
    : { expand: 'Expand video', close: 'Close video · Esc', title: 'Video viewer' };

  function blocked(doc: Document) {
    return doc === document ? feedPaused : !!documents.get(doc)?.frame?.hidden;
  }
  function pauseVideos(doc: Document) {
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
    const buttons = new Map<HTMLElement, HTMLButtonElement>();
    function scan() {
      if (expanded?.player.ownerDocument === doc && !expanded.player.isConnected) close();
      for (const [player, button] of buttons) {
        if (!player.isConnected || !player.querySelector('video')) {
          if (expanded?.player === player) close();
          button.remove(); buttons.delete(player);
        }
      }
      for (const player of doc.querySelectorAll<HTMLElement>(`[data-testid="primaryColumn"] article ${PLAYER}`)) {
        if (!player.querySelector('video') || typeof player.showPopover !== 'function') continue;
        const existing = buttons.get(player);
        if (existing) { if (!player.contains(existing)) player.append(existing); continue; }
        const button = doc.createElement('button');
        button.type = 'button';
        button.setAttribute(BUTTON, '');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-haspopup', 'dialog');
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg><span></span>';
        button.querySelector('span')!.textContent = labels().expand;
        buttons.set(player, button);
        player.append(button);
      }
      if (blocked(doc)) pauseVideos(doc);
    }
    function click(event: MouseEvent) {
      const target = event.target as Element | null;
      const button = target?.closest?.<HTMLButtonElement>(`[${BUTTON}]`);
      if (!button || event.button !== 0) return;
      const player = button.closest<HTMLElement>(PLAYER);
      if (!player || buttons.get(player) !== button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (expanded?.player === player) close(); else open(player, button, frame);
    }
    function play(event: Event) {
      const video = event.target as HTMLVideoElement;
      if (video.tagName === 'VIDEO' && (blocked(doc) || expanded) && !expanded?.player.contains(video)) video.pause();
    }
    const observer = new MutationObserver(scan);
    documents.set(doc, { frame, dispose() {
      if (expanded?.player.ownerDocument === doc) close();
      observer.disconnect();
      doc.removeEventListener('click', click, true);
      doc.removeEventListener('play', play, true);
      buttons.forEach(button => button.remove());
      style.remove();
    } });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    doc.addEventListener('click', click, true);
    doc.addEventListener('play', play, true);
    scan();
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
    },
  };
}
