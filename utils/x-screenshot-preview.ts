import { resolveLocale } from './i18n.ts';

export type ScreenshotPreviewOptions = {
  filename?: string;
  hasParent?: boolean;
  onClose?: () => void;
  rerender?: (opts: { hideMetrics: boolean; includeParent: boolean }) => Promise<HTMLCanvasElement>;
};

const screenshotPngs = new WeakMap<HTMLCanvasElement, Promise<Blob>>();

/** Share the PNG of a finished screenshot between menu preparation and export. */
export function encodeScreenshot(canvas: HTMLCanvasElement): Promise<Blob> {
  const cached = screenshotPngs.get(canvas);
  if (cached) return cached;
  const png = new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
  });
  screenshotPngs.set(canvas, png);
  void png.catch(() => screenshotPngs.delete(canvas));
  return png;
}

function isDarkHost(doc: Document): boolean {
  const view = doc.defaultView;
  if (!view) return false;
  const tone = doc.documentElement.getAttribute('data-site-enhancer-x-tone') ?? doc.documentElement.getAttribute('data-theme');
  if (tone === 'dark') return true;
  if (tone === 'light') return false;
  if (doc.body) {
    const bg = view.getComputedStyle(doc.body).backgroundColor;
    const channels = bg.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (channels && channels.length === 3 && bg !== 'rgba(0, 0, 0, 0)') {
      return channels.reduce((sum, value) => sum + value, 0) < 384;
    }
  }
  return Boolean(view.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

/** Preview and copy/download the exact same PNG. Closing invalidates pending rendering. */
export function showScreenshotPreview(
  doc: Document,
  initialCanvas: Promise<HTMLCanvasElement>,
  trigger: HTMLElement,
  options: ScreenshotPreviewOptions = {},
): () => void {
  const view = doc.defaultView!;
  const zh = resolveLocale(doc.documentElement.lang || view.navigator?.language) === 'zh';
  const text = zh ? {
    title: '截图预览', loading: '正在生成截图…', copy: '复制', download: '下载 PNG', close: '关闭',
    ready: '确认截图后复制或下载', copying: '正在复制…', copied: '已复制图片', downloading: '正在准备下载…', downloaded: '已开始下载',
    failed: '截图生成失败，请关闭后重试', copyFailed: '复制失败，请重试', downloadFailed: '下载失败，请重试',
    hideMetrics: '隐藏互动数据', includeParent: '包含原推文',
  } : {
    title: 'Screenshot preview', loading: 'Creating screenshot…', copy: 'Copy', download: 'Download PNG', close: 'Close',
    ready: 'Review your screenshot before copying or saving', copying: 'Copying…', copied: 'Image copied', downloading: 'Preparing download…', downloaded: 'Download started',
    failed: 'Screenshot failed. Close and try again.', copyFailed: 'Copy failed. Please try again.', downloadFailed: 'Download failed. Please try again.',
    hideMetrics: 'Hide metrics', includeParent: 'Include original post',
  };
  const dark = isDarkHost(doc);
  const dialog = doc.createElement('dialog');
  dialog.className = 'se-screenshot-preview';
  if (dark) dialog.dataset.dark = '';
  dialog.setAttribute('aria-label', text.title);
  const style = doc.createElement('style');
  style.textContent = `
.se-screenshot-preview{box-sizing:border-box;width:min(760px,94vw);max-width:94vw;max-height:90dvh;padding:0;border:1px solid var(--se-x-border,#d5d9df);border-radius:16px;background:var(--se-x-bg,#fff);color:var(--se-x-text,#17202a);font:14px/1.5 system-ui;box-shadow:0 24px 80px #0005;overflow:hidden}
.se-screenshot-preview[open]{display:flex;flex-direction:column}
.se-screenshot-preview::backdrop{background:#0009}
.se-screenshot-preview{position:fixed;inset:0;margin:5dvh auto auto;transition:height 150ms ease-out}
@media(prefers-reduced-motion:reduce){.se-screenshot-preview{transition:none}}
.se-shot-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:48px 20px 20px;background:var(--se-x-raised,#edf1f4)}
.se-shot-stack{position:relative;overflow:clip}
.se-shot-stack canvas{display:block;width:100%;height:auto;box-shadow:0 2px 12px #0003}
.se-shot-stack canvas[data-outgoing]{position:absolute;inset:0;pointer-events:none}
.se-shot-toolbar{position:relative;flex:none;display:flex;align-items:center;gap:4px;align-self:center;margin:10px;padding:5px 8px;border-radius:40px;box-shadow:0 2px 14px #0003;background:var(--se-x-bg,#fff)}
.se-screenshot-preview button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px;min-height:36px;border:0;border-radius:24px;background:transparent;color:inherit;font:600 14px system-ui;cursor:pointer}
.se-screenshot-preview button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.se-screenshot-preview button[aria-pressed=true]{color:var(--se-x-accent,#1d9bf0);background:color-mix(in srgb,currentColor 15%,transparent)}
.se-screenshot-preview button[data-copy]{background:var(--se-x-accent,#1769d2);color:white;padding-inline:14px}
.se-screenshot-preview button:disabled{opacity:.5}
.se-shot-divider{height:20px;border-left:1px solid var(--se-x-border,#aaa)}
.se-shot-close{position:absolute;right:8px;top:6px;z-index:1;background:var(--se-x-bg,#fff)!important}
.se-shot-spinner{width:12px;height:12px;border:2px solid #9995;border-top-color:currentColor;border-radius:50%;visibility:hidden}
.se-shot-spinner[data-busy]{visibility:visible;animation:se-shot-spin .8s linear infinite}
@keyframes se-shot-spin{to{transform:rotate(360deg)}}
.se-shot-toast{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#272b30;color:white;padding:6px 12px;border-radius:8px;white-space:nowrap}
.se-shot-toast:empty{display:none}
.se-screenshot-preview [role=status]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.se-screenshot-preview[data-dark]{--se-shot-dark:#20242b;background:var(--se-x-bg,var(--se-shot-dark));color:var(--se-x-text,#fff)}
.se-screenshot-preview[data-dark] :is(.se-shot-toolbar,.se-shot-close){background:var(--se-x-bg,var(--se-shot-dark))!important}
.se-screenshot-preview[data-dark] .se-shot-body{background:var(--se-x-raised,#12151a)}
`;
  const icons = {
    close: 'M6 6l12 12M18 6L6 18', metrics: 'M4 20h16M6 16V9m6 7V4m6 12v-5',
    parent: 'M10 5l-6 6 6 6M5 11h9a6 6 0 0 1 6 6',
    copy: 'M8 8h12v12H8zM5 15H3V3h12v2', check: 'M4 12l5 5L20 6',
    download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  };
  function button(label: string, shortcut: string, icon: keyof typeof icons) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.title = `${label} (${shortcut})`;
    el.setAttribute('aria-label', el.title);
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[icon]}"/></svg>`;
    return el;
  }
  const closeButton = button(text.close, 'Esc', 'close');
  closeButton.className = 'se-shot-close';
  const body = doc.createElement('div'); body.className = 'se-shot-body';
  const stack = doc.createElement('div'); stack.className = 'se-shot-stack'; body.append(stack);
  const toolbar = doc.createElement('div'); toolbar.className = 'se-shot-toolbar';
  const status = doc.createElement('span'); status.setAttribute('role', 'status');
  const spinner = doc.createElement('span'); spinner.className = 'se-shot-spinner';
  const toast = doc.createElement('span'); toast.className = 'se-shot-toast';
  const download = button(text.download, 'S', 'download'); download.dataset.download = '';
  const copy = button(text.copy, 'C', 'copy'); copy.dataset.copy = ''; copy.append(text.copy);
  const copyIcon = copy.querySelector('path')!;
  let closed = false, renderGeneration = 0;
  let png: Promise<Blob> | undefined, downloadUrl: string | undefined;
  let hideMetrics = false, includeParent = Boolean(options.hasParent);
  let shown: HTMLCanvasElement | undefined;
  let spinTimer = 0, checkTimer = 0, toastTimer = 0;
  const key = (hide: boolean, parent: boolean) => `${hide}/${parent}`;
  const cache = new Map([[key(false, includeParent), initialCanvas]]);
  function variant(hide: boolean, parent: boolean) {
    const id = key(hide, parent);
    let pending = cache.get(id);
    if (!pending) {
      pending = options.rerender!({ hideMetrics: hide, includeParent: parent });
      cache.set(id, pending);
      void pending.catch(() => cache.delete(id));
    }
    return pending;
  }
  function warm() {
    if (closed || !options.rerender) return;
    const variants = options.hasParent ? [[true,true],[false,false],[true,false]] : [[true,false]];
    void (async () => {
      for (const [hide, parent] of variants) {
        if (closed) break;
        try { const canvas = await variant(hide, parent); if (!closed) await encodeScreenshot(canvas); } catch { /* Retry on demand. */ }
      }
    })();
  }
  function clearExport() {
    png = undefined;
    if (downloadUrl) view.URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
    copy.disabled = download.disabled = true;
    copyIcon.setAttribute('d', icons.copy);
  }
  function error(message: string) {
    status.textContent = toast.textContent = message;
    view.clearTimeout(toastTimer);
    toastTimer = view.setTimeout(() => { toast.textContent = ''; }, 3000);
  }
  // The stack always sizes to the incoming canvas. Measuring the non-shrinking
  // toolbar and body padding gives an explicit, animatable dialog height.
  function fitCanvas() {
    if (!shown) return;
    const padding = view.getComputedStyle(body), margins = view.getComputedStyle(toolbar);
    const frame = view.getComputedStyle(dialog);
    const height = stack.getBoundingClientRect().height + toolbar.getBoundingClientRect().height +
      [padding.paddingTop,padding.paddingBottom,margins.marginTop,margins.marginBottom,
        frame.borderTopWidth,frame.borderBottomWidth].reduce((sum, value) => sum + (parseFloat(value) || 0),0);
    dialog.style.height = `min(90dvh, ${height}px)`;
  }
  const resize = new view.ResizeObserver(fitCanvas);
  resize.observe(stack); resize.observe(toolbar);
  function loadCanvas(pending: Promise<HTMLCanvasElement>) {
    const gen = ++renderGeneration;
    clearExport();
    view.clearTimeout(spinTimer);
    spinTimer = view.setTimeout(() => spinner.setAttribute('data-busy',''), 150);
    status.textContent = text.loading;
    void pending.then(canvas => {
      if (closed || gen !== renderGeneration) return;
      const previous = shown;
      const range = body.scrollHeight - body.clientHeight;
      const ratio = range > 0 ? body.scrollTop / range : 0;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', text.title);
      for (const stale of stack.querySelectorAll('[data-outgoing]')) stale.remove();
      canvas.getAnimations?.().forEach(animation => animation.cancel());
      canvas.style.zIndex = '';
      canvas.removeAttribute('data-outgoing');
      stack.append(canvas);
      shown = canvas;
      if (previous && previous !== canvas) {
        previous.dataset.outgoing = '';
        if (previous.animate && !view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          previous.style.zIndex = '1';
          const fade = previous.animate([{opacity:1},{opacity:0}], { duration:120 });
          void fade.finished.then(() => { if (shown !== previous) previous.remove(); }).catch(() => {});
        } else previous.remove();
      }
      fitCanvas();
      body.scrollTop = ratio * (body.scrollHeight - body.clientHeight);
      copy.disabled = download.disabled = false;
      status.textContent = text.ready;
      view.clearTimeout(spinTimer); spinner.removeAttribute('data-busy');
      if (!previous && options.rerender) {
        if (view.requestIdleCallback) view.requestIdleCallback(warm);
        else view.setTimeout(warm, 50);
      }
      png = encodeScreenshot(canvas);
      return png;
    }).catch(() => {
      if (closed || gen !== renderGeneration) return;
      view.clearTimeout(spinTimer); spinner.removeAttribute('data-busy');
      clearExport(); error(text.failed);
    });
  }
  const metrics = button(text.hideMetrics, 'H', 'metrics');
  const parent = button(text.includeParent, 'P', 'parent');
  function syncToggles() {
    metrics.setAttribute('aria-pressed', String(hideMetrics));
    metrics.querySelector('path')!.setAttribute('d', icons.metrics + (hideMetrics ? 'M3 3l18 18' : ''));
    parent.setAttribute('aria-pressed', String(includeParent));
    parent.querySelector('path')!.setAttribute('d', icons.parent + (includeParent ? 'M15 5l2 2 4-4' : ''));
  }
  function update() { syncToggles(); loadCanvas(variant(hideMetrics, includeParent)); }
  metrics.onclick = () => { hideMetrics = !hideMetrics; update(); };
  parent.onclick = () => { includeParent = !includeParent; update(); };
  if (options.rerender) {
    syncToggles(); toolbar.append(metrics);
    if (options.hasParent) toolbar.append(parent);
    const divider = doc.createElement('span'); divider.className = 'se-shot-divider'; toolbar.append(divider);
  }
  toolbar.append(download, copy, spinner, toast);
  dialog.append(style, body, closeButton, toolbar, status);

  function close() {
    if (closed) return;
    closed = true;
    clearExport();
    resize.disconnect();
    cache.clear();
    for (const timer of [spinTimer, checkTimer, toastTimer]) view.clearTimeout(timer);
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
    options.onClose?.();
  }
  async function performCopy() {
    const selected = png;
    if (!selected || copy.disabled) return;
    copy.disabled = true;
    status.textContent = text.copying;
    try {
      // Start the clipboard write inside the click gesture, even while PNG encoding is pending.
      await view.navigator.clipboard.write([new view.ClipboardItem({ 'image/png': selected })]);
      if (png === selected) {
        status.textContent = text.copied;
        copyIcon.setAttribute('d', icons.check);
        view.clearTimeout(checkTimer);
        checkTimer = view.setTimeout(() => copyIcon.setAttribute('d', icons.copy), 1500);
      }
    } catch {
      if (png === selected) error(text.copyFailed);
    } finally {
      if (png === selected) copy.disabled = false;
    }
  }
  async function performDownload() {
    const selected = png;
    if (!selected || download.disabled) return;
    download.disabled = true;
    status.textContent = text.downloading;
    try {
      const blob = await selected;
      if (png !== selected) return;
      downloadUrl ??= view.URL.createObjectURL(blob);
      const anchor = doc.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = options.filename || 'x-post.png';
      anchor.click();
      status.textContent = text.downloaded;
    } catch {
      if (png === selected) error(text.downloadFailed);
    } finally {
      if (png === selected) download.disabled = false;
    }
  }

  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  // Keep X and the image viewer from handling shortcuts intended for this modal.
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'INPUT') return;
    const key = event.key.toLowerCase();
    if (key === 'h' && options.rerender) { event.preventDefault(); metrics.click(); }
    else if (key === 'p' && options.hasParent && options.rerender) { event.preventDefault(); parent.click(); }
    else if (key === 'c' && !copy.disabled) { event.preventDefault(); void performCopy(); }
    else if (key === 's' && !download.disabled) { event.preventDefault(); performDownload(); }
  });
  copy.addEventListener('click', () => { void performCopy(); });
  download.addEventListener('click', performDownload);
  doc.body.append(dialog); dialog.showModal(); closeButton.focus();
  loadCanvas(initialCanvas);
  return close;
}
