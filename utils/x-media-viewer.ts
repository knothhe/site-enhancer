import { mountVideoBar, VIDEO_BAR_CSS } from './x-video-bar.ts';
import { isGifVideo } from './x-video-playback.ts';
import { POST, PHOTO, PHOTO_IMAGE, PLAYER } from './x-dom.ts';
import { createImageMotion } from './x-image-motion.ts';
import { resolveLocale } from './i18n.ts';
import { imageToPng } from './image-clipboard.ts';
import type { SpeedControl } from './x-video-speed.ts';

type Photo = { src: string; alt: string; preview?: string };
type MediaItem = { image: Photo; element: HTMLImageElement } | { player: HTMLElement; element: HTMLVideoElement };
const mediaTile = (img: Element) => img.closest('a[href*="/photo/"],div:has(> a[href*="/photo/"])');
function postMedia(source: Element): MediaItem[] {
  const owner = (el: Element) => el.closest('[role="link"]:not(a),' + POST) ?? el.closest('article');
  const group = owner(source);
  if (!group) return [];
  const items: MediaItem[] = [];
  for (const node of group.querySelectorAll(PHOTO_IMAGE + ',video')) {
    if (owner(node) !== group) continue;
    const player = node.closest<HTMLElement>(PLAYER);
    if (node.tagName === 'VIDEO') {
      if (player) items.push({ player, element: node as HTMLVideoElement });
      continue;
    }
    if (player || (!node.closest('[data-testid="tweetPhoto"]') && !mediaTile(node))) continue;
    const img = node as HTMLImageElement;
    const src = img.currentSrc || img.src;
    if (!src || !URL.canParse(src, img.baseURI)) continue;
    const url = new URL(src, img.baseURI);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || !url.pathname.startsWith('/media/')) continue;
    url.searchParams.set('name', 'orig');
    items.push({ element: img, image: { src: url.href, alt: img.alt, preview: img.complete && img.naturalWidth ? src : undefined } });
  }
  return items;
}
// A display-only still lets the outgoing surface fade above the incoming top layer.
function transitionStill(source?: HTMLVideoElement | HTMLImageElement) {
  if (!source || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const w = 'videoWidth' in source ? source.videoWidth : source.naturalWidth;
  const h = 'videoHeight' in source ? source.videoHeight : source.naturalHeight;
  const box = source.getBoundingClientRect();
  if (!w || !h || !box.width || !box.height) return;
  const frame = document.createElement('canvas');
  frame.width = Math.round(box.width); frame.height = Math.round(box.height);
  const ctx = frame.getContext('2d');
  if (!ctx) return;
  const scale = Math.min(frame.width/w,frame.height/h);
  ctx.drawImage(source,(frame.width-w*scale)/2,(frame.height-h*scale)/2,w*scale,h*scale);
  frame.style.cssText = `position:fixed;pointer-events:none;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:10`;
  return frame;
}
const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  previous: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7',
  out: 'M5 12h14', in: 'M5 12h14M12 5v14',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  actual: 'M7 8v8M5 9l2-1M17 8v8M15 9l2-1M11 10h.01M11 14h.01',
  retry: 'M4 4v5h5M4 9a8 8 0 1 1-1 7',
  help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8m0-5v5h-5',
};
/** One top-level viewer shared by timeline and same-origin detail documents. */
export function createMediaViewer(options: {
  speed(player: HTMLElement): SpeedControl | undefined;
  activate(player?: HTMLElement): void;
  setVolume(video: HTMLVideoElement, level: number): void;
  toggleMute(video: HTMLVideoElement): void;
  nativeVideoUrl?: (video: HTMLVideoElement) => string | undefined;
}) {
  let dialog: HTMLDialogElement | undefined;
  let restoreFocus: HTMLElement | undefined;
  let refreshControls: ((target: HTMLElement) => void) | undefined;
  let disposeOpenView: (() => void) | undefined;
  function close() {
    disposeOpenView?.();
    disposeOpenView = undefined;
    refreshControls = undefined;
    dialog?.remove();
    dialog = undefined;
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    restoreFocus = undefined;
  }
  function open(items: MediaItem[], index: number, trigger: HTMLElement) {
    close();
    restoreFocus = trigger;
    const scroll = [window.scrollX, window.scrollY] as const;
    function imageAt(i: number) {
      const item = items[i];
      return item && 'image' in item ? item.image : undefined;
    }
    const mixed = items.some(item => 'image' in item) && items.some(item => 'player' in item);
    // The Fullscreen API rejects HTMLDialogElement. Fullscreen its container and
    // show the dialog non-modally inside it when coming from a fullscreen player.
    const host = document.createElement('div');
    const videoChrome = document.createElement('div');
    videoChrome.tabIndex = -1;
    videoChrome.className = 'se-media-controls se-video-chrome';
    videoChrome.addEventListener('click', event => event.stopPropagation());
    let player: HTMLElement | undefined;
    let videoBar: ReturnType<typeof mountVideoBar> | undefined;
    let speed: SpeedControl | undefined;
    let fullscreen = false;
    let switching = 0, sequence = 0;
    let lifted: HTMLElement | undefined;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const owned = new Set<Element>([host]);
    const zh = resolveLocale(document.documentElement.lang || navigator.language) === 'zh';
    const current = document.createElement('dialog');
    dialog = current;
    current.id = 'site-enhancer-media-viewer';
    current.className = 'se-media-controls';
    current.setAttribute('aria-label', zh ? '媒体查看' : 'Media viewer');
    const style = document.createElement('style');
    style.textContent = VIDEO_BAR_CSS + `
#site-enhancer-media-viewer{position:fixed;inset:0;margin:0;width:100vw;height:100dvh;max-width:none;max-height:none;border:0;padding:16px;background:#101318;color:#fff;box-sizing:border-box;font:14px/1.5 system-ui;overflow:hidden}
#site-enhancer-media-viewer[open]{display:flex;flex-direction:column}
#site-enhancer-media-viewer::backdrop{background:#000b}
.se-media-controls header{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:nowrap}
.se-media-controls button{font:inherit;background:#ffffff15;color:#fff;border:0;border-radius:8px;padding:9px;cursor:pointer;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.se-media-controls button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.se-media-controls button:not(:disabled):hover{background:#ffffff29}
.se-media-controls button:disabled{opacity:.35;cursor:default}
.se-media-controls button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.se-media-controls .se-image-count{display:flex;align-items:center;gap:4px;white-space:nowrap;margin-right:auto;font-variant-numeric:tabular-nums}
.se-image-count svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8}
.se-image-tools{display:flex;align-items:center;gap:8px;overflow-x:auto;scrollbar-width:none}
.se-media-controls .se-image-stage{position:relative;width:100%;height:100%;box-sizing:border-box;overflow:scroll;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-color:#59616c #101318;scrollbar-width:auto;touch-action:none;user-select:none}
.se-media-controls .se-image-stage::-webkit-scrollbar{width:12px;height:12px;background:#101318}
.se-media-controls .se-image-stage::-webkit-scrollbar-thumb{background:#59616c;border:3px solid #101318;border-radius:8px}
.se-media-controls .se-image-stage::-webkit-scrollbar-track,.se-media-controls .se-image-stage::-webkit-scrollbar-corner{background:#101318}
.se-media-controls .se-image-notice{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);max-width:calc(100% - 144px);display:flex;align-items:center;gap:8px;background:#1c222bf2;padding:8px 12px;border-radius:10px;z-index:2}
.se-media-controls .se-image-viewport{position:relative;flex:1;min-height:0;margin-top:16px}
.se-media-controls .se-image-motion{position:absolute;overflow:hidden;pointer-events:none;z-index:1}
.se-media-controls .se-image-slide{position:absolute;inset:0;will-change:transform}
.se-media-controls .se-image-side{z-index:2;position:absolute;top:50%;transform:translateY(-50%);width:48px;height:56px;background:#101318d9;box-shadow:0 2px 12px #0004}
.se-media-controls .se-image-side[data-direction="previous"]{left:12px}
.se-media-controls .se-image-side[data-direction="next"]{right:28px}
.se-media-controls .se-image-shortcuts{position:absolute;bottom:44px;left:16px;right:16px;z-index:3;max-height:25vh;overflow:auto;background:#1c222b;border-radius:8px;padding:12px;margin-top:8px;line-height:1.8;font-size:13px;color:#d4d9df}
.se-media-controls .se-image-canvas{display:flex;align-items:center;justify-content:center;min-width:100%;min-height:100%}
.se-media-controls img{display:block;flex:none;max-width:none;max-height:none;object-fit:contain;user-select:none;-webkit-user-drag:none;pointer-events:none}
.se-media-controls .se-image-stage[data-pannable]{cursor:grab}
.se-media-controls .se-image-stage[data-dragging]{cursor:grabbing}
.se-media-controls .se-image-help{font-size:12px;color:#aeb6bf;margin:10px 0 0;flex-shrink:0}
.se-media-controls .se-image-feedback{margin:0}
.se-media-controls .se-image-feedback:empty{display:none}
.se-media-controls .se-image-scale{width:56px;flex-shrink:0;text-align:center;font-variant-numeric:tabular-nums}
.se-media-controls .se-image-retry{align-self:center;margin:8px}
.se-media-controls [hidden]{display:none!important}
.se-video-chrome{position:absolute;inset:0;pointer-events:none;outline:0;z-index:12;color:white;font:14px/1.5 system-ui}
.se-video-chrome header{position:absolute;inset:16px 16px auto;pointer-events:auto}
.se-video-chrome :is(button,.se-image-shortcuts,.se-speed){pointer-events:auto}
.se-media-controls .se-speed-steps button{width:32px;height:32px}
.se-media-controls .se-speed [data-site-enhancer-video-speed]{border-radius:18px}
.se-media-controls .se-speed :is([data-changed],[aria-checked=true]){background:var(--se-x-accent,#1d9bf0)}
`;
    const toolbar = document.createElement('header');
    const count = document.createElement('span');
    count.className = 'se-image-count';
    count.setAttribute('aria-live', 'polite');
    const viewport = document.createElement('div');
    viewport.className = 'se-image-viewport';
    const stage = document.createElement('div');
    stage.className = 'se-image-stage';
    stage.tabIndex = 0;
    stage.setAttribute('aria-label', zh ? '图片，可滚动和拖动' : 'Image, scroll or drag to explore');
    const canvas = document.createElement('div');
    canvas.className = 'se-image-canvas';
    const motion = createImageMotion(viewport, stage, canvas);
    let img = document.createElement('img');
    img.draggable = false;
    let preview: HTMLImageElement | undefined;
    let reveal: Animation | undefined;
    function clearPreview() {
      reveal?.cancel(); reveal = undefined;
      preview?.remove(); preview = undefined;
    }
    let generation = 0;
    let displayedIndex = -1;
    let cancelPending: (() => void) | undefined;
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    const decoded = new Map<number, HTMLImageElement>();
    type ImageRequest = {
      image: HTMLImageElement;
      ready?: () => void;
      failed?: () => void;
      cancel: () => void;
    };
    const requests = new Map<number, ImageRequest>();
    let disposed = false;
    let copyController: AbortController | undefined;
    // One download/decode per image, shared by background warming and foreground navigation.
    function requestImage(target: number, priority: 'high' | 'low'): ImageRequest {
      const existing = requests.get(target);
      if (existing) {
        if (priority === 'high') existing.image.fetchPriority = 'high';
        return existing;
      }
      const candidate = document.createElement('img');
      candidate.draggable = false; candidate.hidden = true;
      candidate.decoding = 'async'; candidate.fetchPriority = priority;
      candidate.alt = imageAt(target)!.alt;
      let canceled = false;
      let decoding = false;
      function detach() {
        candidate.removeEventListener('load', onLoad);
        candidate.removeEventListener('error', fail);
      }
      function fail() {
        if (disposed || canceled) return;
        detach(); requests.delete(target);
        entry.failed?.();
      }
      async function onLoad() {
        if (disposed || canceled || decoding || !candidate.naturalWidth || !candidate.naturalHeight) return;
        decoding = true;
        try {
          await candidate.decode();
          if (disposed || canceled) return;
          detach(); requests.delete(target);
          decoded.set(target, candidate);
          entry.ready?.();
        } catch { fail(); }
      }
      const entry: ImageRequest = { image: candidate, cancel() {
        canceled = true; detach();
        candidate.removeAttribute('src');
        entry.ready = undefined; entry.failed = undefined;
      } };
      requests.set(target, entry);
      candidate.addEventListener('load', onLoad);
      candidate.addEventListener('error', fail);
      candidate.src = imageAt(target)!.src;
      return entry;
    }
    function warmNeighbors(center: number) {
      for (const target of [center + 1, center - 1]) {
        if (target >= 0 && imageAt(target) && !decoded.has(target) && !requests.has(target)) requestImage(target, 'low');
      }
    }
    const help = document.createElement('p');
    help.className = 'se-image-help';
    help.textContent = zh ? '← → / 触摸板横滑切图 · + / − 缩放 · C 复制 · E 下载 · T 旋转 · ? 快捷键 · Esc 关闭' : '← → / Swipe to browse · + / − Zoom · C Copy · E Download · T Rotate · ? Shortcuts · Esc Close';
    const shortcuts = document.createElement('div');
    shortcuts.className = 'se-image-shortcuts';
    shortcuts.id = 'se-image-shortcuts';
    shortcuts.hidden = true;
    shortcuts.textContent = zh
      ? '← / → 或 PageUp / PageDown 切图；Home / End 首张 / 末张；+ / − 缩放；0 / F 适应窗口；1 原始大小；C 复制图片；E 下载原图；T 旋转 90°；W A S D 或 Shift + 方向键平移；↑ / ↓ 垂直滚动；R 重试；? 显示 / 隐藏快捷键；Tab 切换控件；Enter / 空格激活按钮；Esc 关闭。双击缩放，Ctrl / ⌘ + 滚轮缩放，普通滚轮滚动。触摸板横向滑动切图；图片超出窗口时，滑动用于平移图片。'
      : '← / → or PageUp / PageDown: browse; Home / End: first / last; + / −: zoom; 0 / F: fit; 1: actual size; C: copy image; E: download original; T: rotate 90°; W A S D or Shift + arrows: pan; ↑ / ↓: scroll vertically; R: retry; ?: toggle shortcuts; Tab: move focus; Enter / Space: activate buttons; Esc: close. Double-click to zoom; Ctrl / ⌘ + scroll to zoom; scroll normally to pan. Swipe horizontally to browse; when the image exceeds the viewport, swipe to pan instead.';
    shortcuts.textContent += zh ? ' 视频：空格 / K 播放或暂停，J / L 快退或快进 5 秒（单项也可用 ← / →），M 静音，< / > 调速，按住 Shift+> 临时 2×。无法平移时 ↑ / ↓ 切换媒体。' : ' Video: Space / K play or pause, J / L seek 5 seconds (also ← / → for a single item), M mute, < / > speed, hold Shift+> for 2×. ↑ / ↓ browse when the image fits.';
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'se-image-scale';
    let scale = 1;
    let rotation = 0;
    let fitted = true;
    let loaded = false;
    let dismissStart: { x: number; y: number } | undefined;
    let suppressDismiss = false;
    let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
    function endDrag() {
      const pointer = drag?.id;
      drag = undefined;
      if (pointer !== undefined && stage.hasPointerCapture?.(pointer)) stage.releasePointerCapture(pointer);
      stage.removeAttribute('data-dragging');
    }
    const fitScale = () => Math.min(1, stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
    function render() {
      if (!loaded) return;
      // Read geometry together, before style writes can invalidate layout.
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return;
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      const fitValue = Math.min(1, width / naturalWidth, height / naturalHeight);
      if (fitted) scale = fitValue;
      img.style.width = `${naturalWidth * scale}px`;
      img.style.height = `${naturalHeight * scale}px`;
      canvas.style.width = `${Math.max(width, naturalWidth * scale)}px`;
      canvas.style.height = `${Math.max(height, naturalHeight * scale)}px`;
      stage.toggleAttribute('data-pannable', naturalWidth * scale > width + .5 || naturalHeight * scale > height + .5);
      scaleLabel.textContent = `${Math.round(scale * 100)}%`;
      zoomOut.disabled = scale <= fitValue / 4 + .00001;
      zoomIn.disabled = scale >= 8;
      fit.disabled = false; actual.disabled = false;
    }
    function zoom(value: number, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
      if (!loaded) return;
      stopSwipe(true);
      endDrag();
      const offsetX = Math.max(0, (stage.clientWidth - img.naturalWidth * scale) / 2);
      const offsetY = Math.max(0, (stage.clientHeight - img.naturalHeight * scale) / 2);
      const imageX = (stage.scrollLeft + x - offsetX) / scale;
      const imageY = (stage.scrollTop + y - offsetY) / scale;
      scale = Math.max(fitScale() / 4, Math.min(8, value));
      fitted = false;
      render();
      stage.scrollLeft = imageX * scale + Math.max(0, (stage.clientWidth - img.naturalWidth * scale) / 2) - x;
      stage.scrollTop = imageY * scale + Math.max(0, (stage.clientHeight - img.naturalHeight * scale) / 2) - y;
    }
    function fitImage() {
      stopSwipe(true);
      endDrag(); fitted = true; render();
      stage.scrollLeft = 0; stage.scrollTop = 0;
    }
    const notice = document.createElement('div');
    notice.className = 'se-image-notice';
    notice.hidden = true;
    const feedback = document.createElement('p');
    feedback.setAttribute('role', 'status');
    feedback.className = 'se-image-feedback';
    function button(label: string, action: () => void, icon: keyof typeof ICONS, keys: string) {
      const result = document.createElement('button');
      result.type = 'button';
      result.setAttribute('aria-label', label);
      result.setAttribute('aria-keyshortcuts', keys);
      result.title = `${label} (${keys})`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', ICONS[icon]); svg.append(path); result.append(svg);
      result.addEventListener('click', action);
      return result;
    }
    function navigate(value: number, fromSwipe = false) {
      const nextIndex = Math.max(0, Math.min(items.length - 1, value));
      if (nextIndex !== index) show(nextIndex, fromSwipe);
    }
    const sidePrevious = button(zh ? '上一项' : 'Previous', () => navigate(index - 1), 'previous', 'ArrowLeft PageUp');
    const sideNext = button(zh ? '下一项' : 'Next', () => navigate(index + 1), 'next', 'ArrowRight PageDown');
    for (const [control, direction] of [[sidePrevious, 'previous'], [sideNext, 'next']] as const) {
      control.className = 'se-image-side'; control.dataset.direction = direction;
      control.hidden = items.length < 2;
    }
    const retry = button(zh ? '重试' : 'Retry', () => show(index), 'retry', 'R');
    retry.className = 'se-image-retry';
    const zoomOut = button(zh ? '缩小' : 'Zoom out', () => zoom(scale / 1.25), 'out', '-');
    const zoomIn = button(zh ? '放大' : 'Zoom in', () => zoom(scale * 1.25), 'in', '+ =');
    const fit = button(zh ? '适应窗口' : 'Fit to window', fitImage, 'fit', '0 F');
    const actual = button(zh ? '原始大小' : 'Actual size', () => zoom(1), 'actual', '1');
    const copyStatus = document.createElement('p');
    copyStatus.className = 'se-image-help se-image-feedback';
    copyStatus.setAttribute('role', 'status');
    const copy = button(zh ? '复制图片' : 'Copy image', () => { void copyImage(); }, 'copy', 'C');
    copy.disabled = true;
    const download = button(zh ? '下载原图' : 'Download original', () => { void downloadImage(); }, 'download', 'E');
    download.disabled = true;
    const rotate = button(zh ? '旋转 90°' : 'Rotate 90°', rotateImage, 'rotate', 'T');
    rotate.disabled = true;
    function rotateImage() {
      if (!loaded) return;
      rotation = (rotation + 90) % 360;
      img.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    }
    async function downloadImage() {
      if (download.disabled || disposed || displayedIndex < 0) return;
      download.disabled = true;
      copyStatus.textContent = zh ? '正在下载原图…' : 'Downloading image…';
      try {
        const src = imageAt(displayedIndex)!.src;
        const response = await fetch(src, { credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (disposed) return;
        const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `x-image-${displayedIndex + 1}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        copyStatus.textContent = zh ? '已开始下载原图' : 'Download started';
      } catch {
        if (!disposed) copyStatus.textContent = zh ? '下载失败，请重试' : 'Download failed. Please try again.';
      } finally {
        if (!disposed) download.disabled = !loaded || displayedIndex !== index;
      }
    }
    async function copyImage() {
      if (copy.disabled || disposed) return;
      const controller = new AbortController();
      copyController = controller;
      copy.disabled = true;
      copyStatus.textContent = zh ? '正在复制图片…' : 'Copying image…';
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        // Start the clipboard write within the user gesture, before fetching/encoding.
        const png = imageToPng(imageAt(displayedIndex)!.src, controller.signal);
        // Observe rejection even if ClipboardItem construction or write fails synchronously.
        void png.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        if (!disposed && copyController === controller) copyStatus.textContent = zh ? '已复制图片' : 'Image copied';
      } catch {
        if (!disposed && copyController === controller) copyStatus.textContent = zh ? '复制失败，请重试' : 'Copy failed. Please try again.';
      } finally {
        clearTimeout(timeout);
        controller.abort();
        if (!disposed && copyController === controller) {
          copyController = undefined;
          copy.disabled = !loaded || displayedIndex !== index;
        }
      }
    }
    const toggleHelp = () => {
      shortcuts.hidden = !shortcuts.hidden;
      helpButton.setAttribute('aria-expanded', String(!shortcuts.hidden));
    };
    const helpButton = button(zh ? '快捷键' : 'Keyboard shortcuts', toggleHelp, 'help', '?');
    helpButton.setAttribute('aria-expanded', 'false');
    helpButton.setAttribute('aria-controls', shortcuts.id);
    function releasePlayer() {
      if (lifted) {
        if (lifted.isConnected) lifted.hidePopover();
        lifted.removeAttribute('popover');
        lifted = undefined;
      }
      if (!player) return;
      releaseSpeed();
      videoBar?.remove(); videoBar = undefined;
      player.querySelector('video')?.pause();
      if (speed) {
        speed.close(); player.append(speed.root); speed = undefined;
      }
      player.removeAttribute('data-site-enhancer-video-expanded');
      player.querySelector('[data-site-enhancer-video-expand]')?.setAttribute('aria-expanded','false');
      player = undefined;
    }
    function fullscreenChange() {
      if (!switching && fullscreen && document.fullscreenElement !== (player ?? host)) close();
    }
    async function exitOwned() {
      while (document.fullscreenElement && owned.has(document.fullscreenElement)) {
        const before = document.fullscreenElement;
        try { await document.exitFullscreen(); } catch { break; }
        if (document.fullscreenElement === before) break;
      }
    }
    refreshControls = target => {
      if (target !== player) return;
      if (videoChrome.parentElement !== target) target.append(videoChrome);
      speed = options.speed(target);
      const video = target.querySelector('video');
      if (video && (video !== videoBar?.video || isGifVideo(video) !== videoBar.gif)) {
        videoBar?.remove();
        videoBar = mountVideoBar(target,videoChrome,video,zh,options,close);
      }
      videoBar?.mountSpeed(speed);
    };
    function present(nextPlayer?: HTMLElement) {
      const outgoing = player?.querySelector('video') ?? (loaded ? img : preview);
      const still = generation > 1 ? transitionStill(outgoing) : undefined;
      const wantsFullscreen = nextPlayer || fullscreen || switching || document.fullscreenElement;
      const token = switching = ++sequence;
      const destination = nextPlayer ?? host;
      owned.add(destination);
      let request: Promise<void> | undefined;
      if (wantsFullscreen && document.fullscreenElement !== destination) {
        try { request = destination.requestFullscreen?.(); }
        catch { /* Use the modal or fixed player. */ }
      }
      releasePlayer();
      player = nextPlayer;
      // While an image in a mixed post is open, refuse X's attempts to restart
      // the video we just paused, using the existing single-playback gate.
      options.activate(player ?? (mixed ? host : undefined));
      for (const tool of [zoomOut,scaleLabel,zoomIn,fit,actual,rotate,copy,download]) tool.hidden = !!player;
      if (player) {
        if (current.open) current.close();
        player.setAttribute('data-site-enhancer-video-expanded','');
        player.querySelector('[data-site-enhancer-video-expand]')?.setAttribute('aria-expanded','true');
        videoChrome.append(toolbar, sidePrevious, sideNext, shortcuts);
        refreshControls?.(player);
        videoChrome.focus({ preventScroll:true });
      } else {
        current.prepend(toolbar); current.append(sidePrevious,sideNext,shortcuts);
        videoChrome.remove();
        if (!current.open) {
          if (request || document.fullscreenElement === host) current.show();
          else current.showModal();
        }
      }
      if (still?.animate) {
        (nextPlayer ?? current).append(still);
        const fade = still.animate([{ opacity:1 },{ opacity:0 }],120);
        void fade.finished.finally(() => still.remove()).catch(() => {});
      } else if (generation > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // A video can still be buffering with no frame available to snapshot.
        (nextPlayer ?? viewport).animate?.([{ opacity: 0 }, { opacity: 1 }], 120);
      }
      function fallback() {
        // Transformed timeline ancestors can clip a fixed player. Lift it in place.
        if (player && !player.hasAttribute('popover') && player.showPopover) {
          player.setAttribute('popover','manual');
          try { player.showPopover(); lifted = player; } catch { player.removeAttribute('popover'); }
        } else if (!player) { current.close(); current.showModal(); }
      }
      if (!request) {
        switching = 0; fullscreen = document.fullscreenElement === destination;
        if (!fullscreen && nextPlayer) fallback();
        return;
      }
      void request.then(() => {
        if (disposed) { if (!dialog) void exitOwned(); return; }
        if (token !== switching) return;
        switching = 0; fullscreen = document.fullscreenElement === destination;
      }, async () => {
        if (disposed || token !== switching) return;
        fullscreen = false;
        await exitOwned();
        if (disposed || token !== switching) return;
        switching = 0;
        fallback();
      });
    }
    function show(value: number, fromSwipe = false) {
      copyController?.abort(); copyController = undefined;
      copy.disabled = true; download.disabled = true; rotate.disabled = true; copyStatus.textContent = '';
      if (!fromSwipe) stopSwipe();
      clearPreview();
      index = Math.max(0, Math.min(items.length - 1, value));
      const request = ++generation;
      const item = items[index];
      const nextPlayer = 'player' in item ? item.player : undefined;
      if ('player' in item && item.player.ownerDocument !== document) {
        const url = options.nativeVideoUrl?.(item.element);
        if (url) window.location.assign(url);
        return;
      }
      if (request === 1 || player !== nextPlayer) present(nextPlayer);
      if (!loaded && imageAt(index)?.preview) {
        preview = document.createElement('img');
        preview.src = imageAt(index)!.preview!;
        preview.alt = imageAt(index)!.alt;
        preview.draggable = false;
        preview.className = 'se-image-preview';
        preview.style.cssText = 'position:absolute;inset:0;width:calc(100% - 12px);height:calc(100% - 12px);object-fit:contain;pointer-events:none';
        viewport.append(preview);
      }
      cancelPending?.(); cancelPending = undefined;
      clearTimeout(noticeTimer);
      endDrag();
      notice.hidden = true; retry.hidden = true;
      count.textContent = `${index + 1} / ${items.length}`;
      if (mixed) {
        const path = nextPlayer ? 'M7 4l13 8-13 8z' : 'M3 4h18v16H3zM4 17l5-6 4 4 3-3 4 5M15 8h1';
        count.insertAdjacentHTML('afterbegin', `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${path}"/></svg>`);
        count.setAttribute('aria-label', (nextPlayer ? (zh ? '视频' : 'Video') : (zh ? '图片' : 'Image')) + ' ' + count.textContent);
      }
      sidePrevious.disabled = index === 0;
      sideNext.disabled = index === items.length - 1;
      if (nextPlayer) {
        loaded = false; displayedIndex = -1; canvas.replaceChildren();
        current.removeAttribute('aria-busy'); return;
      }
      current.setAttribute('aria-busy', 'true');
      // Returning to the still-visible image cancels the pending switch without resetting its view.
      if (displayedIndex === index) {
        copy.disabled = false; download.disabled = false; rotate.disabled = false;
        current.removeAttribute('aria-busy'); render(); return;
      }
      const targetIndex = index;
      function commit(candidate: HTMLImageElement) {
        if (request !== generation || dialog !== current) return;
        clearTimeout(noticeTimer);
        const apply = () => {
          if (request !== generation || dialog !== current) return;
          img = candidate;
          rotation = 0; img.style.transform = '';
          img.hidden = true; img.removeAttribute('data-pending');
          loaded = true; displayedIndex = targetIndex;
          copy.disabled = false; download.disabled = false; rotate.disabled = false;
          decoded.set(targetIndex, img);
          notice.hidden = true; retry.hidden = true; feedback.textContent = '';
          current.removeAttribute('aria-busy');
          fitted = true; render();
          canvas.replaceChildren(img); img.hidden = false;
          if (preview) {
            // Keep the decoded thumbnail over the full image until the latter is painted.
            // Fading the overlay reveals the full-resolution image without a blank frame.
            if (typeof preview.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
              const activePreview = preview;
              reveal = preview.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' });
              void reveal.finished.then(() => {
                if (preview === activePreview) clearPreview();
              }).catch(() => { /* Navigation or closing canceled the reveal. */ });
            } else clearPreview();
          }
          stage.scrollLeft = 0; stage.scrollTop = 0;
          warmNeighbors(targetIndex);
        };
        if (loaded && img !== candidate) motion.transition(img, candidate, targetIndex > displayedIndex ? 1 : -1, apply);
        else apply();
      }
      const cached = decoded.get(targetIndex);
      if (cached) { commit(cached); return; }
      const entry = requestImage(targetIndex, 'high');
      const candidate = entry.image;
      candidate.dataset.pending = '';
      if (!loaded) { img.remove(); img = candidate; }
      canvas.append(candidate);
      const fail = () => {
        if (request !== generation || dialog !== current) return;
        clearTimeout(noticeTimer);
        current.removeAttribute('aria-busy');
        if (loaded) candidate.remove();
        retry.hidden = false; notice.hidden = false;
        feedback.textContent = zh
          ? `第 ${targetIndex + 1} 张图片加载失败，请重试。`
          : `Couldn’t load image ${targetIndex + 1}. Try again.`;
      };
      entry.ready = () => commit(candidate);
      entry.failed = fail;
      cancelPending = () => {
        // Keep useful in-flight work alive when the user moves past it.
        entry.ready = undefined; entry.failed = undefined;
        if (candidate !== img || !loaded) candidate.remove();
      };
      noticeTimer = setTimeout(() => {
        if (request !== generation || dialog !== current) return;
        feedback.textContent = zh
          ? `正在加载第 ${targetIndex + 1} 张图片…${loaded ? `（当前显示第 ${displayedIndex + 1} 张）` : ''}`
          : `Loading image ${targetIndex + 1}…${loaded ? ` (showing image ${displayedIndex + 1})` : ''}`;
        notice.hidden = false;
      }, 150);
      if (!loaded) {
        zoomIn.disabled = true; zoomOut.disabled = true; fit.disabled = true; actual.disabled = true;
      }
    }
    stage.addEventListener('dblclick', event => {
      // Pointer capture retargets double-clicks to the stage while panning is enabled.
      const imageRect = img.getBoundingClientRect();
      const overImage = event.clientX >= imageRect.left && event.clientX <= imageRect.right && event.clientY >= imageRect.top && event.clientY <= imageRect.bottom;
      if (event.target !== img && !([stage, canvas].includes(event.target as HTMLDivElement) && overImage)) return;
      event.preventDefault();
      if (!fitted) return fitImage();
      const rect = stage.getBoundingClientRect();
      zoom(scale * 2, event.clientX - rect.left, event.clientY - rect.top);
    });
    let swipeDistance = 0;
    let lastWheelAt = Number.NEGATIVE_INFINITY;
    let swipeLocked = false;
    let peakDelta = 0;
    let previousDelta = 0;
    let decayingEvents = 0;
    let swipeTimer: ReturnType<typeof setTimeout> | undefined;
    function stopSwipe(complete = false) {
      clearTimeout(swipeTimer);
      swipeDistance = 0;
      swipeLocked = true;
      motion.cancel(complete);
    }
    function finishSwipe() {
      clearTimeout(swipeTimer);
      swipeLocked = true;
      const direction = swipeDistance > 0 ? 1 : -1;
      const target = index + direction;
      if (Math.abs(swipeDistance) < 64 || target < 0 || target >= items.length) {
        motion.rebound(); return;
      }
      if (imageAt(target) && !decoded.has(target) && motion.active) {
        requestImage(target, 'high');
        motion.rebound(() => navigate(target));
      } else navigate(target, true);
    }
    current.addEventListener('wheel', event => {
      const now = Date.now();
      if (now - lastWheelAt > 240) {
        swipeDistance = 0; swipeLocked = false;
        peakDelta = previousDelta = decayingEvents = 0;
      }
      lastWheelAt = now;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        stopSwipe(true);
        event.preventDefault(); event.stopPropagation();
        const rect = stage.getBoundingClientRect();
        const delta = event.deltaY * unit;
        zoom(scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * .01), event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      const overStage = stage.contains(event.target as Node);
      if ((overStage && stage.hasAttribute('data-pannable')) || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.25) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaX * unit;
      const magnitude = Math.abs(delta);
      if (swipeLocked) {
        // Observe the tail even while locked. A new acceleration after decay or
        // a deliberate reversal starts a new gesture without a pointer move.
        const fresh = magnitude >= 12 && (delta * previousDelta < 0 ||
          (Math.abs(previousDelta) <= peakDelta * .35 && magnitude >= Math.max(12, Math.abs(previousDelta) * 2.5)));
        if (!fresh) { previousDelta = delta; return; }
        motion.cancel(true);
        swipeLocked = false; swipeDistance = 0;
        peakDelta = previousDelta = decayingEvents = 0;
      }
      if (motion.settling) return;
      // A reversal is deliberate input, not the previous direction's momentum tail.
      if (delta * previousDelta < 0) peakDelta = decayingEvents = 0;
      decayingEvents = magnitude < Math.abs(previousDelta) ? decayingEvents + 1 : 0;
      peakDelta = Math.max(peakDelta, magnitude);
      previousDelta = delta;
      swipeDistance += delta;
      const direction = swipeDistance > 0 ? 1 : -1;
      if (loaded && (!items[index + direction] || imageAt(index + direction))) motion.follow(img, decoded.get(index + direction), direction, swipeDistance);
      clearTimeout(swipeTimer);
      // Commit a clear swipe immediately, without waiting for finger-up or OS inertia.
      // Short gestures can still reverse or rebound before crossing this threshold.
      if (Math.abs(swipeDistance) >= 96 && index + direction >= 0 && index + direction < items.length) {
        finishSwipe(); return;
      }
      // Wheel events have no portable finger-up phase. Settle on a sustained
      // momentum decay rather than waiting for the entire OS inertia tail.
      if (decayingEvents >= 3 && magnitude <= peakDelta * .55) {
        finishSwipe(); return;
      }
      swipeTimer = setTimeout(finishSwipe, 60);
    }, { passive: false });
    stage.addEventListener('pointerdown', event => {
      if (motion.active) { stopSwipe(true); dismissStart = undefined; suppressDismiss = true; return; }
      suppressDismiss = false;
      dismissStart = event.button === 0 && [stage, canvas].includes(event.target as HTMLDivElement) ? { x: event.clientX, y: event.clientY } : undefined;
      if (event.button !== 0 || drag || !stage.hasAttribute('data-pannable')) return;
      // Leave native scrollbar tracks and thumbs to the browser.
      const rect = stage.getBoundingClientRect();
      if (event.clientX - rect.left >= stage.clientWidth || event.clientY - rect.top >= stage.clientHeight) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
      stage.setPointerCapture(event.pointerId);
      stage.setAttribute('data-dragging', '');
      stage.focus({ preventScroll: true });
    });
    stage.addEventListener('pointermove', event => {
      if (dismissStart && Math.hypot(event.clientX - dismissStart.x, event.clientY - dismissStart.y) > 4) suppressDismiss = true;
      if (!drag || drag.id !== event.pointerId) return;
      stage.scrollLeft = drag.left - (event.clientX - drag.x);
      stage.scrollTop = drag.top - (event.clientY - drag.y);
    });
    stage.addEventListener('pointercancel', () => { suppressDismiss = true; dismissStart = undefined; });
    stage.addEventListener('click', event => {
      if (suppressDismiss || !dismissStart || ![stage, canvas].includes(event.target as HTMLDivElement)) return;
      const rect = stage.getBoundingClientRect();
      if (event.clientX - rect.left >= stage.clientWidth || event.clientY - rect.top >= stage.clientHeight) return;
      const imageRect = img.getBoundingClientRect();
      // Images don't receive pointer events: the stable canvas owns the gesture.
      if (loaded && event.clientX >= imageRect.left && event.clientX <= imageRect.right && event.clientY >= imageRect.top && event.clientY <= imageRect.bottom) return;
      close();
    });
    current.addEventListener('click', event => { if (event.target === current) close(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, endDrag);
    const imageTools = document.createElement('div'); imageTools.className = 'se-image-tools';
    imageTools.append(zoomOut, scaleLabel, zoomIn, fit, actual, rotate, copy, download);
    toolbar.append(button(zh ? '关闭' : 'Close', close, 'close', 'Escape'), count, imageTools, helpButton);
    canvas.append(img); stage.append(canvas);
    notice.append(feedback, retry);
    viewport.append(stage, notice);
    current.append(style, toolbar, viewport, sidePrevious, sideNext, copyStatus, help, shortcuts);
    current.addEventListener('cancel', event => { event.preventDefault(); close(); });
    host.append(current); document.body.append(host);
    document.addEventListener('fullscreenchange',fullscreenChange);
    let holdTimer = 0, pendingSpeed = false;
    function releaseSpeed() {
      window.clearTimeout(holdTimer); pendingSpeed = false; speed?.hold(false);
    }
    function keyup(e: KeyboardEvent) {
      const target = e.target as Element | null;
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || target?.closest?.('input,textarea,select,[role=slider],[contenteditable=true]')) return;
      e.stopImmediatePropagation();
      if (e.key === '>' || e.code === 'Period' || e.key === 'Shift') {
        if (pendingSpeed) speed?.step(.25);
        releaseSpeed();
      }
    }
    show(index);
    // Capture before host-page shortcuts can cancel the dialog's native Esc action.
    // Also cover the source frame if focus is moved back there by the host.
    const windows = new Set<Window>([window]);
    if (trigger.ownerDocument.defaultView) windows.add(trigger.ownerDocument.defaultView);
    const keyboard = (event: KeyboardEvent) => {
      videoBar?.wake();
      if (event.isComposing || speed?.keys(event)) return;
      const el = event.target as Element | null;
      if (el?.closest?.('[role=slider],input[type=range]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close(); return;
      }
      // Keep browser shortcuts and editable controls native.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as Element | null;
      if (target?.nodeType === 1 && target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.key === ' ' || event.key === 'Enter') && target?.closest?.('button')) {
        // Keep native keyboard activation without also triggering X's shortcuts.
        event.stopImmediatePropagation(); return;
      }
      const key = event.key.toLowerCase();
      let action: (() => void) | undefined;
      if (key === '?') action = () => { if (!event.repeat) toggleHelp(); };
      else if (player) {
        const video = player.querySelector('video');
        if (!video) return;
        if (key === 'home' || key === 'end') action = () => navigate(key === 'home' ? 0 : items.length - 1);
        else if (key === 'j' || key === 'l' || (items.length === 1 && ['arrowleft','arrowright'].includes(key)))
          action = () => { video.currentTime = Math.min(video.duration || Infinity, Math.max(0,video.currentTime + (['j','arrowleft'].includes(key) ? -5 : 5))); };
        else if (['arrowleft','arrowup','pageup'].includes(key)) action = () => navigate(index - 1);
        else if (['arrowright','arrowdown','pagedown'].includes(key)) action = () => navigate(index + 1);
        else if ([' ','k'].includes(key)) action = () => { if (video.paused) void video.play()?.catch(() => {}); else video.pause(); };
        else if (key === 'm' && !videoBar?.gif) action = () => options.toggleMute(video);
        else if (key === '<' || key === '>') action = () => {
          if (!speed || event.repeat) return;
          if (key === '>' && event.shiftKey) {
            const control = speed;
            pendingSpeed = true;
            holdTimer = window.setTimeout(() => { pendingSpeed = false; control.hold(true); },400);
          } else speed.step(key === '>' ? .25 : -.25);
        };
      }
      else if (key === '+' || key === '=') action = () => zoom(scale * 1.25);
      else if (key === '-') action = () => zoom(scale / 1.25);
      else if (key === '0' || key === 'f') action = fitImage;
      else if (key === '1') action = () => zoom(1);
      else if (key === 'c') action = () => { if (!event.repeat) void copyImage(); };
      else if (key === 'e') action = () => { if (!event.repeat) void downloadImage(); };
      else if (key === 't') action = () => { if (!event.repeat) rotateImage(); };
      else if (key === 'r' && !retry.hidden) action = () => show(index);
      else if (key === 'home') action = () => navigate(0);
      else if (key === 'end') action = () => navigate(items.length - 1);
      else if (key === 'pageup' || (key === 'arrowup' && !stage.hasAttribute('data-pannable'))) action = () => navigate(index - 1);
      else if (key === 'pagedown' || (key === 'arrowdown' && !stage.hasAttribute('data-pannable'))) action = () => navigate(index + 1);
      else if (key === 'arrowleft' && !event.shiftKey) action = () => navigate(index - 1);
      else if (key === 'arrowright' && !event.shiftKey) action = () => navigate(index + 1);
      else {
        const direction = { a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
        if (direction) action = () => {
          endDrag();
          const step = event.shiftKey ? 160 : 80;
          stage.scrollLeft += direction[0] * step;
          stage.scrollTop += direction[1] * step;
        };
      }
      if (!action) {
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      action();
    };
    windows.forEach(source => source.addEventListener('keydown', keyboard, true));
    const resize = new window.ResizeObserver(() => { stopSwipe(true); render(); });
    resize.observe(stage);
    windows.forEach(source => source.addEventListener('keyup', keyup, true));
    const blur = () => { releaseSpeed(); stopSwipe(true); endDrag(); };
    window.addEventListener('blur', blur);
    disposeOpenView = () => {
      disposed = true;
      document.removeEventListener('fullscreenchange', fullscreenChange);
      releasePlayer(); options.activate(undefined); videoChrome.remove();
      void exitOwned(); host.remove();
      document.documentElement.style.overflow = overflow;
      window.scrollTo(...scroll);
      windows.forEach(source => source.removeEventListener('keyup', keyup, true));
      copyController?.abort(); copyController = undefined;
      clearPreview();
      stopSwipe();
      ++generation; clearTimeout(noticeTimer); cancelPending?.();
      requests.forEach(entry => entry.cancel()); requests.clear(); decoded.clear();
      endDrag(); resize.disconnect();
      window.removeEventListener('blur', blur);
      windows.forEach(source => source.removeEventListener('keydown', keyboard, true));
    };
  }
  return {
    handleClick(event: MouseEvent): boolean {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      const target = event.target as Element | null;
      if (!target || target.nodeType !== 1) return false;
      const photo = target.closest(PHOTO);
      const article = photo?.closest(POST);
      if (!photo || !article || photo.closest('video,[data-testid="videoPlayer"]') || photo.querySelector('video')) return false;
      const link = photo.closest('a');
      if (link?.target === '_blank' || link?.hasAttribute('download')) return false;
      const items = postMedia(photo);
      const index = items.findIndex(item => 'image' in item && (photo.contains(item.element) ||
        (photo.matches('a[href*="/photo/"]') && mediaTile(item.element) === photo.parentElement)));
      if (index < 0) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      open(items,index,(photo.closest('a,button,[tabindex]') ?? article) as HTMLElement);
      return true;
    },
    close,
    refreshControls(player: HTMLElement) { refreshControls?.(player); },
    openVideo(player: HTMLElement, trigger: HTMLElement) {
      const items = postMedia(player);
      const index = items.findIndex(item => 'player' in item && item.player === player);
      if (index >= 0) open(items,index,trigger);
    },
  };
}
