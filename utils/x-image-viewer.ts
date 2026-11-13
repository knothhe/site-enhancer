import { createImageMotion } from './x-image-motion.ts';
import { resolveLocale } from './i18n.ts';

type Photo = { src: string; alt: string; preview?: string };
const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  previous: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7',
  out: 'M5 12h14', in: 'M5 12h14M12 5v14',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  actual: 'M7 8v8M5 9l2-1M17 8v8M15 9l2-1M11 10h.01M11 14h.01',
  retry: 'M4 4v5h5M4 9a8 8 0 1 1-1 7',
  help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
};
/** One top-level viewer shared by timeline and same-origin detail documents. */
export function installXImageViewer() {
  let dialog: HTMLDialogElement | undefined;
  let restoreFocus: HTMLElement | undefined;
  let disposeOpenView: (() => void) | undefined;
  function close() {
    disposeOpenView?.();
    disposeOpenView = undefined;
    dialog?.remove();
    dialog = undefined;
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    restoreFocus = undefined;
  }
  function open(photos: Photo[], index: number, trigger: HTMLElement) {
    close();
    restoreFocus = trigger;
    const zh = resolveLocale(document.documentElement.lang || navigator.language) === 'zh';
    const current = document.createElement('dialog');
    dialog = current;
    current.id = 'site-enhancer-image-viewer';
    current.setAttribute('aria-label', zh ? '图片查看' : 'Image viewer');
    const style = document.createElement('style');
    style.textContent = `
#site-enhancer-image-viewer{position:fixed;inset:0;margin:0;width:100vw;height:100dvh;max-width:none;max-height:none;border:0;padding:16px;background:#101318;color:#fff;box-sizing:border-box;font:14px/1.5 system-ui;overflow:hidden}
#site-enhancer-image-viewer[open]{display:flex;flex-direction:column}
#site-enhancer-image-viewer::backdrop{background:#000b}
#site-enhancer-image-viewer header{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap}
#site-enhancer-image-viewer button{font:inherit;background:#ffffff15;color:#fff;border:0;border-radius:8px;padding:9px;cursor:pointer;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
#site-enhancer-image-viewer button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
#site-enhancer-image-viewer button:not(:disabled):hover{background:#ffffff29}
#site-enhancer-image-viewer button:disabled{opacity:.35;cursor:default}
#site-enhancer-image-viewer button:focus-visible{outline:2px solid #fff;outline-offset:2px}
#site-enhancer-image-viewer .se-image-count{margin-right:auto}
#site-enhancer-image-viewer .se-image-stage{position:relative;width:100%;height:100%;box-sizing:border-box;overflow:scroll;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-color:#59616c #101318;scrollbar-width:auto;touch-action:none;user-select:none}
#site-enhancer-image-viewer .se-image-stage::-webkit-scrollbar{width:12px;height:12px;background:#101318}
#site-enhancer-image-viewer .se-image-stage::-webkit-scrollbar-thumb{background:#59616c;border:3px solid #101318;border-radius:8px}
#site-enhancer-image-viewer .se-image-stage::-webkit-scrollbar-track,#site-enhancer-image-viewer .se-image-stage::-webkit-scrollbar-corner{background:#101318}
#site-enhancer-image-viewer .se-image-notice{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);max-width:calc(100% - 144px);display:flex;align-items:center;gap:8px;background:#1c222bf2;padding:8px 12px;border-radius:10px;z-index:2}
#site-enhancer-image-viewer .se-image-viewport{position:relative;flex:1;min-height:0;margin-top:16px}
#site-enhancer-image-viewer .se-image-motion{position:absolute;overflow:hidden;pointer-events:none;z-index:1}
#site-enhancer-image-viewer .se-image-slide{position:absolute;inset:0;will-change:transform}
#site-enhancer-image-viewer .se-image-side{z-index:2;position:absolute;top:50%;transform:translateY(-50%);width:48px;height:56px;background:#101318d9;box-shadow:0 2px 12px #0004}
#site-enhancer-image-viewer .se-image-side[data-direction="previous"]{left:12px}
#site-enhancer-image-viewer .se-image-side[data-direction="next"]{right:28px}
#site-enhancer-image-viewer .se-image-shortcuts{position:absolute;bottom:44px;left:16px;right:16px;z-index:3;max-height:25vh;overflow:auto;background:#1c222b;border-radius:8px;padding:12px;margin-top:8px;line-height:1.8;font-size:13px;color:#d4d9df}
#site-enhancer-image-viewer .se-image-canvas{display:flex;align-items:center;justify-content:center;min-width:100%;min-height:100%}
#site-enhancer-image-viewer img{display:block;flex:none;max-width:none;max-height:none;object-fit:contain;user-select:none;-webkit-user-drag:none;pointer-events:none}
#site-enhancer-image-viewer .se-image-stage[data-pannable]{cursor:grab}
#site-enhancer-image-viewer .se-image-stage[data-dragging]{cursor:grabbing}
#site-enhancer-image-viewer .se-image-help{font-size:12px;color:#aeb6bf;margin:10px 0 0;flex-shrink:0}
#site-enhancer-image-viewer .se-image-feedback{margin:0}
#site-enhancer-image-viewer .se-image-feedback:empty{display:none}
#site-enhancer-image-viewer .se-image-scale{width:56px;flex-shrink:0;text-align:center;font-variant-numeric:tabular-nums}
#site-enhancer-image-viewer .se-image-retry{align-self:center;margin:8px}
#site-enhancer-image-viewer [hidden]{display:none!important}
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
      candidate.alt = photos[target].alt;
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
      candidate.src = photos[target].src;
      return entry;
    }
    function warmNeighbors(center: number) {
      for (const target of [center + 1, center - 1]) {
        if (target >= 0 && target < photos.length && !decoded.has(target) && !requests.has(target)) requestImage(target, 'low');
      }
    }
    const help = document.createElement('p');
    help.className = 'se-image-help';
    help.textContent = zh ? '← → / 触摸板横滑切图 · + / − 缩放 · ? 快捷键 · Esc 关闭' : '← → / Swipe to browse · + / − Zoom · ? Shortcuts · Esc Close';
    const shortcuts = document.createElement('div');
    shortcuts.className = 'se-image-shortcuts';
    shortcuts.id = 'se-image-shortcuts';
    shortcuts.hidden = true;
    shortcuts.textContent = zh
      ? '← / → 或 PageUp / PageDown 切图；Home / End 首张 / 末张；+ / − 缩放；0 / F 适应窗口；1 原始大小；W A S D 或 Shift + 方向键平移；↑ / ↓ 垂直滚动；R 重试；? 显示 / 隐藏快捷键；Tab 切换控件；Enter / 空格激活按钮；Esc 关闭。双击缩放，Ctrl / ⌘ + 滚轮缩放，普通滚轮滚动。触摸板横向滑动切图；图片超出窗口时，滑动用于平移图片。'
      : '← / → or PageUp / PageDown: browse; Home / End: first / last; + / −: zoom; 0 / F: fit; 1: actual size; W A S D or Shift + arrows: pan; ↑ / ↓: scroll vertically; R: retry; ?: toggle shortcuts; Tab: move focus; Enter / Space: activate buttons; Esc: close. Double-click to zoom; Ctrl / ⌘ + scroll to zoom; scroll normally to pan. Swipe horizontally to browse; when the image exceeds the viewport, swipe to pan instead.';
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'se-image-scale';
    let scale = 1;
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
      const nextIndex = Math.max(0, Math.min(photos.length - 1, value));
      if (nextIndex !== index) show(nextIndex, fromSwipe);
    }
    const previous = button(zh ? '上一张' : 'Previous', () => navigate(index - 1), 'previous', 'ArrowLeft PageUp');
    const next = button(zh ? '下一张' : 'Next', () => navigate(index + 1), 'next', 'ArrowRight PageDown');
    const sidePrevious = button(zh ? '上一张' : 'Previous', () => navigate(index - 1), 'previous', 'ArrowLeft PageUp');
    const sideNext = button(zh ? '下一张' : 'Next', () => navigate(index + 1), 'next', 'ArrowRight PageDown');
    for (const [control, direction] of [[sidePrevious, 'previous'], [sideNext, 'next']] as const) {
      control.className = 'se-image-side'; control.dataset.direction = direction;
      control.hidden = photos.length < 2;
    }
    const retry = button(zh ? '重试' : 'Retry', () => show(index), 'retry', 'R');
    retry.className = 'se-image-retry';
    const zoomOut = button(zh ? '缩小' : 'Zoom out', () => zoom(scale / 1.25), 'out', '-');
    const zoomIn = button(zh ? '放大' : 'Zoom in', () => zoom(scale * 1.25), 'in', '+ =');
    const fit = button(zh ? '适应窗口' : 'Fit to window', fitImage, 'fit', '0 F');
    const actual = button(zh ? '原始大小' : 'Actual size', () => zoom(1), 'actual', '1');
    const toggleHelp = () => {
      shortcuts.hidden = !shortcuts.hidden;
      helpButton.setAttribute('aria-expanded', String(!shortcuts.hidden));
    };
    const helpButton = button(zh ? '快捷键' : 'Keyboard shortcuts', toggleHelp, 'help', '?');
    helpButton.setAttribute('aria-expanded', 'false');
    helpButton.setAttribute('aria-controls', shortcuts.id);
    function show(value: number, fromSwipe = false) {
      if (!fromSwipe) stopSwipe();
      clearPreview();
      index = Math.max(0, Math.min(photos.length - 1, value));
      const request = ++generation;
      if (!loaded && photos[index].preview) {
        preview = document.createElement('img');
        preview.src = photos[index].preview!;
        preview.alt = photos[index].alt;
        preview.draggable = false;
        preview.className = 'se-image-preview';
        preview.style.cssText = 'position:absolute;inset:0;width:calc(100% - 12px);height:calc(100% - 12px);object-fit:contain;pointer-events:none';
        viewport.append(preview);
      }
      cancelPending?.(); cancelPending = undefined;
      clearTimeout(noticeTimer);
      endDrag();
      notice.hidden = true; retry.hidden = true;
      count.textContent = `${index + 1} / ${photos.length}`;
      previous.disabled = sidePrevious.disabled = index === 0;
      next.disabled = sideNext.disabled = index === photos.length - 1;
      current.setAttribute('aria-busy', 'true');
      // Returning to the still-visible image cancels the pending switch without resetting its view.
      if (displayedIndex === index) {
        current.removeAttribute('aria-busy'); render(); return;
      }
      const targetIndex = index;
      function commit(candidate: HTMLImageElement) {
        if (request !== generation || dialog !== current) return;
        clearTimeout(noticeTimer);
        const apply = () => {
          if (request !== generation || dialog !== current) return;
          img = candidate;
          img.hidden = true; img.removeAttribute('data-pending');
          loaded = true; displayedIndex = targetIndex;
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
      if (Math.abs(swipeDistance) < 64 || target < 0 || target >= photos.length) {
        motion.rebound(); return;
      }
      if (!decoded.has(target) && motion.active) {
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
      if (loaded) motion.follow(img, decoded.get(index + direction), direction, swipeDistance);
      clearTimeout(swipeTimer);
      // Commit a clear swipe immediately, without waiting for finger-up or OS inertia.
      // Short gestures can still reverse or rebound before crossing this threshold.
      if (Math.abs(swipeDistance) >= 96 && index + direction >= 0 && index + direction < photos.length) {
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
    toolbar.append(button(zh ? '关闭' : 'Close', close, 'close', 'Escape'), count, zoomOut, scaleLabel, zoomIn, fit, actual, previous, next, helpButton);
    canvas.append(img); stage.append(canvas);
    notice.append(feedback, retry);
    viewport.append(stage, sidePrevious, sideNext, notice);
    current.append(style, toolbar, viewport, help, shortcuts);
    current.addEventListener('cancel', event => { event.preventDefault(); close(); });
    document.body.append(current);
    show(index);
    current.showModal();
    // Capture before host-page shortcuts can cancel the dialog's native Esc action.
    // Also cover the source frame if focus is moved back there by the host.
    const windows = new Set<Window>([window]);
    if (trigger.ownerDocument.defaultView) windows.add(trigger.ownerDocument.defaultView);
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close(); return;
      }
      // Keep browser shortcuts and editable controls native.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as Element | null;
      if (target?.nodeType === 1 && target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      let action: (() => void) | undefined;
      if (key === '?') action = () => { if (!event.repeat) toggleHelp(); };
      else if (key === '+' || key === '=') action = () => zoom(scale * 1.25);
      else if (key === '-') action = () => zoom(scale / 1.25);
      else if (key === '0' || key === 'f') action = fitImage;
      else if (key === '1') action = () => zoom(1);
      else if (key === 'r' && !retry.hidden) action = () => show(index);
      else if (key === 'home') action = () => navigate(0);
      else if (key === 'end') action = () => navigate(photos.length - 1);
      else if (key === 'pageup') action = () => navigate(index - 1);
      else if (key === 'pagedown') action = () => navigate(index + 1);
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
      if (!action) return;
      event.preventDefault(); event.stopImmediatePropagation();
      action();
    };
    windows.forEach(source => source.addEventListener('keydown', keyboard, true));
    const resize = new window.ResizeObserver(() => { stopSwipe(true); render(); });
    resize.observe(stage);
    const blur = () => { stopSwipe(true); endDrag(); };
    window.addEventListener('blur', blur);
    disposeOpenView = () => {
      disposed = true;
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
      const photo = target.closest('[data-testid="tweetPhoto"]');
      const article = photo?.closest('article[data-testid="tweet"]');
      if (!photo || !article || photo.closest('video,[data-testid="videoPlayer"]') || photo.querySelector('video')) return false;
      const link = photo.closest('a');
      if (link?.target === '_blank' || link?.hasAttribute('download')) return false;
      const group = photo.closest('[role="link"]:not(a)') ?? article;
      const images = Array.from(group.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img')).filter(img => {
        if ((img.closest('[role="link"]:not(a)') ?? img.closest('article[data-testid="tweet"]')) !== group) return false;
        try { const url = new URL(img.currentSrc || img.src); return url.protocol === 'https:' && url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/'); } catch { return false; }
      });
      const index = images.findIndex(img => photo.contains(img));
      if (index < 0) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      open(images.map(img => {
        const url = new URL(img.currentSrc || img.src); url.searchParams.set('name', 'orig');
        return { src: url.href, alt: img.alt, preview: img.complete && img.naturalWidth > 0 ? img.currentSrc || img.src : undefined };
      }), index, (photo.closest('a,button,[tabindex]') ?? article) as HTMLElement);
      return true;
    },
    close,
    remove: close,
  };
}
