import { copyToClipboard } from './clipboard.ts';
import { resolveLocale } from './i18n.ts';
import { roundScreenshot, ScreenshotTooLargeError } from './x-screenshot.ts';

export type ScreenshotScope = 'post' | 'parent' | 'thread';
export type ScreenshotPreviewOptions = {
  filename?: string;
  scopes?: { id: ScreenshotScope; count: number }[];
  scope?: ScreenshotScope;
  rounded?: boolean;
  onRoundedChange?: (value: boolean) => void;
  copyText?: (scope: ScreenshotScope, invalidateImages: () => void) => Promise<string>;
  onClose?: () => void;
  rerender?: (opts: { hideMetrics: boolean; scope: ScreenshotScope }) => Promise<HTMLCanvasElement>;
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
    textCopy: '复制文字', textCopied: '已复制文字', textFailed: '复制文字失败，请重试', empty: '没有可复制的文字',
    title: '复制预览', loading: '正在生成截图…', copy: '复制', copyImage: '复制图片', download: '下载 PNG', close: '关闭',
    ready: '确认截图后复制或下载', copying: '正在复制…', copied: '已复制图片', downloading: '正在准备下载…', downloaded: '已开始下载',
    failed: '截图生成失败，请关闭后重试', copyFailed: '复制失败，请重试', downloadFailed: '下载失败，请重试',
    hideMetrics: '隐藏互动数据', scope: '复制范围', post: '仅此推文', parent: '含原推文', thread: '完整串推', tooLong: '串推过长，无法生成截图', rounded: '圆角',
  } : {
    textCopy: 'Copy text', textCopied: 'Text copied', textFailed: 'Text copy failed. Please try again.', empty: 'No text to copy',
    title: 'Copy preview', loading: 'Creating screenshot…', copy: 'Copy', copyImage: 'Copy image', download: 'Download PNG', close: 'Close',
    ready: 'Review your screenshot before copying or saving', copying: 'Copying…', copied: 'Image copied', downloading: 'Preparing download…', downloaded: 'Download started',
    failed: 'Screenshot failed. Close and try again.', copyFailed: 'Copy failed. Please try again.', downloadFailed: 'Download failed. Please try again.',
    hideMetrics: 'Hide metrics', scope: 'Copy scope', post: 'This post', parent: 'With original', thread: 'Full thread', tooLong: 'Thread is too long to capture', rounded: 'Rounded corners',
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
.se-shot-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,currentColor 30%,transparent) transparent;padding:20px;background:var(--se-x-raised,#edf1f4)}
.se-shot-stack{position:relative;overflow:clip;overflow-clip-margin:12px}
.se-shot-stack canvas{display:block;width:100%;height:auto;filter:drop-shadow(0 2px 8px #0003)}
.se-shot-stack canvas[data-outgoing]{position:absolute;inset:0;pointer-events:none}
.se-shot-toolbar{position:relative;z-index:2;box-sizing:border-box;flex:none;width:100%;display:flex;align-items:center;gap:4px;padding:8px 10px 8px 12px;border-bottom:1px solid var(--se-x-border,#d5d9df);background:var(--se-x-bg,#fff)}
.se-shot-actions{margin-left:auto;display:flex;align-items:center;gap:4px}
.se-shot-scopes{display:flex;max-width:100%;box-sizing:border-box;margin-right:6px;padding:2px;border-radius:999px;background:color-mix(in srgb,currentColor 7%,transparent)}
.se-shot-scopes button[role=radio]{min-width:0;min-height:30px;padding:0 12px;border-radius:999px;font:600 13px system-ui;color:color-mix(in srgb,currentColor 62%,transparent);overflow-wrap:anywhere}
.se-shot-scopes button[aria-checked=true]{background:var(--se-x-bg,#fff);color:inherit;box-shadow:0 1px 2px #0003}
.se-screenshot-preview[data-dark] button[aria-checked=true]{background:color-mix(in srgb,currentColor 16%,transparent);box-shadow:none}
@media(max-width:559px){.se-shot-toolbar{flex-wrap:wrap}.se-shot-actions{max-width:100%;flex-wrap:wrap;justify-content:flex-end}}
.se-screenshot-preview button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0;border:0;background:transparent;color:inherit;font:600 14px system-ui;cursor:pointer}
.se-screenshot-preview button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.se-screenshot-preview .se-shot-icon{flex:none;width:36px;height:36px;padding:0;border-radius:50%}
.se-shot-icon:hover:not(:disabled):not([aria-pressed=true]){background:color-mix(in srgb,currentColor 10%,transparent)}
.se-screenshot-preview .se-shot-icon[aria-pressed=true]{color:var(--se-x-accent,#1d9bf0);background:color-mix(in srgb,var(--se-x-accent,#1d9bf0) 14%,transparent)}
.se-screenshot-preview[data-dark] .se-shot-icon[aria-pressed=true]{background:color-mix(in srgb,var(--se-x-accent,#1d9bf0) 24%,transparent)}
.se-screenshot-preview button[data-copy]{height:36px;padding:0 16px 0 13px;border-radius:999px;background:var(--se-x-accent,#1d9bf0);color:#fff}
.se-screenshot-preview button:disabled{opacity:.5}
.se-shot-divider{width:1px;height:18px;background:color-mix(in srgb,currentColor 18%,transparent);margin:0 6px}
.se-shot-spinner{width:12px;height:12px;border:2px solid #9995;border-top-color:currentColor;border-radius:50%;visibility:hidden}
.se-shot-spinner[data-busy]{visibility:visible;animation:se-shot-spin .8s linear infinite}
@keyframes se-shot-spin{to{transform:rotate(360deg)}}
.se-shot-toast{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#272b30;color:white;padding:6px 12px;border-radius:8px;width:max-content;max-width:90%;box-sizing:border-box;text-align:center}
.se-shot-toast:empty{display:none}
.se-screenshot-preview [role=status]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.se-screenshot-preview[data-dark]{--se-shot-dark:#20242b;background:var(--se-x-bg,var(--se-shot-dark));color:var(--se-x-text,#fff)}
.se-screenshot-preview[data-dark] .se-shot-toolbar{background:var(--se-x-bg,var(--se-shot-dark))!important}
.se-screenshot-preview[data-dark] .se-shot-body{background:var(--se-x-raised,#12151a)}
`;
  const icons = {
    close: 'M6 6l12 12M18 6L6 18', metrics: 'M4 20h16M6 16V9m6 7V4m6 12v-5',
    text: 'M5 7V5h14v2M12 5v14M9 19h6',
    rounded: 'M4 4h6a10 10 0 0 1 10 10v6M4 9h.01M4 14.5h.01M4 20h.01M9.5 20h.01M15 20h.01',
    copy: 'M8 8h12v12H8zM5 15H3V3h12v2', check: 'M4 12l5 5L20 6',
    download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  };
  function button(label: string, shortcut: string, icon: keyof typeof icons) {
    const el = doc.createElement('button');
    el.type = 'button';
    if (icon !== 'copy') el.className = 'se-shot-icon';
    el.title = `${label} (${shortcut})`;
    el.setAttribute('aria-label', el.title);
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[icon]}"/></svg>`;
    return el;
  }
  const closeButton = button(text.close, 'Esc', 'close');
  closeButton.classList.add('se-shot-close');
  const body = doc.createElement('div'); body.className = 'se-shot-body';
  const stack = doc.createElement('div'); stack.className = 'se-shot-stack'; body.append(stack);
  const toolbar = doc.createElement('div'); toolbar.className = 'se-shot-toolbar';
  const status = doc.createElement('span'); status.setAttribute('role', 'status');
  const spinner = doc.createElement('span'); spinner.className = 'se-shot-spinner';
  const toast = doc.createElement('span'); toast.className = 'se-shot-toast';
  const download = button(text.download, 'S', 'download'); download.dataset.download = '';
  const copy = button(text.copyImage, 'C', 'copy'); copy.dataset.copy = ''; copy.append(text.copy);
  const copyText = button(text.textCopy, 'T', 'text');
  copyText.dataset.copyText = '';
  const textIcon = copyText.querySelector('path')!;
  const copyIcon = copy.querySelector('path')!;
  let closed = false, renderGeneration = 0;
  let png: Promise<Blob> | undefined, downloadUrl: string | undefined;
  const scopes = options.scopes ?? [{ id: 'post' as const, count: 1 }];
  let scope = options.scope ?? scopes[0].id;
  let rounded = options.rounded ?? false;
  let hideMetrics = false;
  let shown: HTMLCanvasElement | undefined;
  let spinTimer = 0, checkTimer = 0, textCheckTimer = 0, toastTimer = 0;
  const key = (hide: boolean, id: ScreenshotScope) => `${hide}/${id}`;
  const cache = new Map([[key(false, scope), initialCanvas]]);
  function variant(hide: boolean, id: ScreenshotScope) {
    const cacheKey = key(hide, id);
    let pending = cache.get(cacheKey);
    if (!pending) {
      pending = options.rerender!({ hideMetrics: hide, scope: id });
      cache.set(cacheKey, pending);
      void pending.catch(() => { if (cache.get(cacheKey) === pending) cache.delete(cacheKey); });
    }
    return pending;
  }
  async function warm() {
    if (closed || !options.rerender) return;
    const cheap = scopes.filter(option => option.id !== 'thread');
    cheap.sort((a, b) => Number(b.id === scope) - Number(a.id === scope));
    async function prepare(hide: boolean, id: ScreenshotScope) {
      try {
        const source = await variant(hide, id);
        if (!closed) await encodeScreenshot(rounded ? roundScreenshot(source) : source);
      } catch { /* Retry on demand. */ }
    }
    for (const { id } of cheap) {
      for (const hide of id === scope ? [!hideMetrics, hideMetrics] : [hideMetrics, !hideMetrics]) {
        if (closed) return;
        await prepare(hide, id);
      }
    }
    if (!closed && scopes.some(option => option.id === 'thread')) await prepare(hideMetrics, 'thread');
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
    const padding = view.getComputedStyle(body);
    const frame = view.getComputedStyle(dialog);
    const height = stack.getBoundingClientRect().height + toolbar.getBoundingClientRect().height +
      [padding.paddingTop,padding.paddingBottom,
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
    view.clearTimeout(toastTimer);
    toast.textContent = '';
    status.textContent = text.loading;
    void pending.then(source => {
      if (closed || gen !== renderGeneration) return;
      const canvas = rounded ? roundScreenshot(source) : source;
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
    }).catch(cause => {
      if (closed || gen !== renderGeneration) return;
      view.clearTimeout(spinTimer); spinner.removeAttribute('data-busy');
      clearExport();
      error(scope === 'thread' && cause instanceof ScreenshotTooLargeError ? text.tooLong : text.failed);
    });
  }
  const metrics = button(text.hideMetrics, 'H', 'metrics');
  const corners = button(text.rounded, 'R', 'rounded');
  corners.dataset.corners = '';
  const group = doc.createElement('div');
  group.className = 'se-shot-scopes';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', text.scope);
  const radios = scopes.map(({id, count}, index) => {
    const radio = doc.createElement('button');
    radio.type = 'button';
    radio.setAttribute('role', 'radio');
    radio.textContent = id === 'thread' ? `${text.thread} · ${count}` : text[id];
    radio.title = `${radio.textContent} (${index + 1}, P)`;
    radio.onclick = () => selectScope(index);
    return radio;
  });
  function syncToggles() {
    metrics.setAttribute('aria-pressed', String(hideMetrics));
    metrics.querySelector('path')!.setAttribute('d', icons.metrics + (hideMetrics ? 'M3 3l18 18' : ''));
    corners.setAttribute('aria-pressed', String(rounded));
    radios.forEach((radio, i) => {
      const checked = scopes[i].id === scope;
      radio.tabIndex = checked ? 0 : -1;
      radio.setAttribute('aria-checked', String(checked));
    });
  }
  function update() {
    syncToggles();
    loadCanvas(variant(hideMetrics, scope));
  }
  function selectScope(index: number) {
    scope = scopes[index].id;
    if (group.contains(doc.activeElement)) radios[index].focus();
    update();
  }
  metrics.onclick = () => { hideMetrics = !hideMetrics; update(); };
  corners.onclick = () => {
    rounded = !rounded;
    options.onRoundedChange?.(rounded);
    update();
  };
  syncToggles();
  if (options.rerender && scopes.length > 1) {
    group.append(...radios);
    toolbar.append(group);
  }
  if (options.rerender) toolbar.append(metrics);
  const actions = doc.createElement('div');
  actions.className = 'se-shot-actions';
  const divider = doc.createElement('span');
  divider.className = 'se-shot-divider';
  actions.append(spinner, download);
  if (options.copyText) actions.append(copyText);
  actions.append(copy, divider, closeButton);
  toolbar.append(corners, actions, toast);
  dialog.append(style, toolbar, body, status);

  function close() {
    if (closed) return;
    closed = true;
    clearExport();
    resize.disconnect();
    doc.removeEventListener('keydown', onDocumentKey, true);
    cache.clear();
    for (const timer of [spinTimer, checkTimer, textCheckTimer, toastTimer]) view.clearTimeout(timer);
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
  async function performTextCopy() {
    if (!options.copyText || copyText.disabled) return;
    copyText.disabled = true;
    const empty = new Error('Empty clipboard text');
    try {
      const value = options.copyText(scope, () => {
        if (closed || !options.rerender) return;
        cache.clear();
        update();
      }).then(value => {
        if (!value.trim()) throw empty;
        return value;
      });
      if (view.ClipboardItem && view.navigator.clipboard?.write) {
        const blob = value.then(value => new Blob([value], { type: 'text/plain' }));
        // Also handle a constructor that rejects promise inputs before consuming the blob.
        void blob.catch(() => {});
        try {
          await view.navigator.clipboard.write([new view.ClipboardItem({ 'text/plain': blob })]);
        } catch {
          if (!await copyToClipboard(await value)) throw new Error('Text copy failed');
        }
      } else if (!await copyToClipboard(await value)) throw new Error('Text copy failed');
      if (closed) return;
      status.textContent = text.textCopied;
      textIcon.setAttribute('d', icons.check);
      view.clearTimeout(textCheckTimer);
      textCheckTimer = view.setTimeout(() => textIcon.setAttribute('d', icons.text), 1500);
    } catch (cause) {
      if (!closed) error(cause === empty ? text.empty : text.textFailed);
    } finally {
      copyText.disabled = false;
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
  function onKey(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'INPUT') return;
    const key = event.key.toLowerCase();
    if (key === 'h' && options.rerender) { event.preventDefault(); metrics.click(); }
    else if (key === 'r') { event.preventDefault(); corners.click(); }
    else if (group.isConnected && (key === 'p' || /^[1-3]$/.test(key) || (group.contains(target) && ['arrowleft', 'arrowright'].includes(key)))) {
      const index = scopes.findIndex(option => option.id === scope);
      const next = /^[1-3]$/.test(key) ? Number(key) - 1 : (index + (key === 'arrowleft' ? -1 : 1) + scopes.length) % scopes.length;
      if (next < scopes.length) { event.preventDefault(); selectScope(next); }
    }
    else if (key === 't' && options.copyText) { event.preventDefault(); void performTextCopy(); }
    else if (key === 'c' && !copy.disabled) { event.preventDefault(); void performCopy(); }
    else if (key === 's' && !download.disabled) { event.preventDefault(); performDownload(); }
  }
  // X can return focus to the body as its own More menu finishes closing.
  function onDocumentKey(event: KeyboardEvent) {
    if (event.target === doc.body || event.target === doc.documentElement) onKey(event);
  }
  doc.addEventListener('keydown', onDocumentKey, true);
  dialog.addEventListener('keydown', onKey);
  copyText.addEventListener('click', performTextCopy);
  copy.addEventListener('click', () => { void performCopy(); });
  download.addEventListener('click', performDownload);
  doc.body.append(dialog); dialog.showModal(); closeButton.focus();
  loadCanvas(initialCanvas);
  return close;
}
