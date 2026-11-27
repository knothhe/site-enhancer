import { resolveLocale } from './i18n.ts';

export type ScreenshotPreviewOptions = {
  filename?: string;
  hasParent?: boolean;
  rerender?: (opts: { hideMetrics: boolean; includeParent: boolean }) => Promise<Blob>;
};

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
  png: Promise<Blob>,
  trigger: HTMLElement,
  options: ScreenshotPreviewOptions = {},
): () => void {
  const view = doc.defaultView!;
  const zh = resolveLocale(doc.documentElement.lang || view.navigator?.language) === 'zh';
  const text = zh ? {
    title: '截图预览', loading: '正在生成截图…', copy: '复制图片', download: '下载 PNG', close: '关闭',
    ready: '确认截图后复制或下载', copied: '已复制图片', downloaded: '已开始下载',
    failed: '截图生成失败，请关闭后重试', copyFailed: '复制失败，请重试',
    hideMetrics: '隐藏互动数据', includeParent: '包含原推文',
  } : {
    title: 'Screenshot preview', loading: 'Creating screenshot…', copy: 'Copy image', download: 'Download PNG', close: 'Close',
    ready: 'Review your screenshot before copying or saving', copied: 'Image copied', downloaded: 'Download started',
    failed: 'Screenshot failed. Close and try again.', copyFailed: 'Copy failed. Please try again.',
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
.se-screenshot-preview header,.se-screenshot-preview footer{display:flex;align-items:center;gap:10px;padding:14px 20px;flex-shrink:0;flex-wrap:wrap}
.se-screenshot-preview h2{margin:0;flex:1;font:600 17px/1.4 system-ui}
.se-screenshot-preview .se-shot-options{display:flex;align-items:center;gap:14px;padding:0 20px 10px;font-size:13px;color:var(--se-x-muted,#536471)}
.se-screenshot-preview .se-shot-options label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.se-screenshot-preview button{font:600 14px system-ui;border:0;border-radius:8px;padding:9px 15px;cursor:pointer;background:var(--se-x-raised,#e9edf2);color:var(--se-x-text,#17202a)}
.se-screenshot-preview button[data-copy]{background:var(--se-x-accent,#1769d2);color:#fff}
.se-screenshot-preview button:disabled{opacity:.5;cursor:wait}
.se-screenshot-preview button:focus-visible{outline:2px solid var(--se-x-accent,#1769d2);outline-offset:2px}
.se-screenshot-preview .se-shot-body{min-height:100px;overflow:auto;overscroll-behavior:contain;padding:20px;background:var(--se-x-raised,#e9edf2);scrollbar-color:#9aa4b2 transparent}
.se-screenshot-preview img{display:block;width:100%;height:auto;max-width:100%;margin:auto;box-shadow:0 2px 12px #0002}
.se-screenshot-preview img[hidden]{display:none}
.se-screenshot-preview [role=status]{margin:0;flex:1;font-size:13px;color:var(--se-x-muted,inherit)}
.se-screenshot-preview[data-dark]{background:var(--se-x-bg,#20242b);color:var(--se-x-text,#f0f2f5);border-color:var(--se-x-border,#414852)}
.se-screenshot-preview[data-dark] .se-shot-body{background:var(--se-x-raised,#12151a);scrollbar-color:#59616c transparent}
.se-screenshot-preview[data-dark] button:not([data-copy]){background:var(--se-x-input,#353c46);color:var(--se-x-text,#f0f2f5)}
`;
  const header = doc.createElement('header'), title = doc.createElement('h2');
  title.textContent = text.title;
  const closeButton = doc.createElement('button');
  closeButton.type = 'button'; closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', text.close);
  const body = doc.createElement('div'); body.className = 'se-shot-body';
  const image = doc.createElement('img'); image.alt = text.title; image.hidden = true;
  body.append(image);
  const footer = doc.createElement('footer'), status = doc.createElement('p');
  status.setAttribute('role', 'status'); status.textContent = text.loading;
  const download = doc.createElement('button'); download.type = 'button'; download.dataset.download = '';
  download.textContent = text.download; download.title = `${text.download} (S)`; download.disabled = true;
  const copy = doc.createElement('button'); copy.type = 'button'; copy.dataset.copy = '';
  copy.textContent = text.copy; copy.title = `${text.copy} (C)`; copy.disabled = true;
  header.append(title, closeButton);
  footer.append(status, download, copy);

  let closed = false, url: string | undefined, blob: Blob | undefined, renderGeneration = 0;
  let hideMetrics = false, includeParent = Boolean(options.hasParent);

  function loadBlob(pending: Promise<Blob>) {
    const gen = ++renderGeneration;
    blob = undefined;
    copy.disabled = true;
    download.disabled = true;
    status.textContent = text.loading;
    void pending.then(async value => {
      if (closed || gen !== renderGeneration) return;
      const nextUrl = view.URL.createObjectURL(value);
      image.src = nextUrl;
      await image.decode().catch(() => {});
      if (closed || gen !== renderGeneration) {
        view.URL.revokeObjectURL(nextUrl);
        return;
      }
      if (url) view.URL.revokeObjectURL(url);
      url = nextUrl;
      blob = value;
      image.hidden = false;
      copy.disabled = false;
      download.disabled = false;
      status.textContent = text.ready;
    }).catch(() => {
      if (!closed && gen === renderGeneration) status.textContent = text.failed;
    });
  }

  let optionsBar: HTMLDivElement | undefined;
  if (options.rerender) {
    const rerender = options.rerender;
    optionsBar = doc.createElement('div');
    optionsBar.className = 'se-shot-options';
    const makeToggle = (labelText: string, checked: boolean, onChange: (value: boolean) => void) => {
      const label = doc.createElement('label');
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => {
        onChange(input.checked);
        loadBlob(rerender({ hideMetrics, includeParent }));
      });
      label.append(input, labelText);
      return label;
    };
    optionsBar.append(makeToggle(text.hideMetrics, hideMetrics, v => { hideMetrics = v; }));
    if (options.hasParent) {
      optionsBar.append(makeToggle(text.includeParent, includeParent, v => { includeParent = v; }));
    }
  }

  dialog.append(style, header);
  if (optionsBar) dialog.append(optionsBar);
  dialog.append(body, footer);

  function close() {
    if (closed) return;
    closed = true;
    if (url) view.URL.revokeObjectURL(url);
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  async function performCopy() {
    if (!blob || closed || copy.disabled) return;
    copy.disabled = true;
    try {
      await view.navigator.clipboard.write([new view.ClipboardItem({ 'image/png': blob })]);
      if (!closed) status.textContent = text.copied;
    } catch { if (!closed) status.textContent = text.copyFailed; }
    finally { if (!closed) copy.disabled = false; }
  }
  function performDownload() {
    if (!blob || !url || closed || download.disabled) return;
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = options.filename || 'x-post.png';
    anchor.click();
    status.textContent = text.downloaded;
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
    if (key === 'c' && !copy.disabled) { event.preventDefault(); void performCopy(); }
    else if (key === 's' && !download.disabled) { event.preventDefault(); performDownload(); }
  });
  copy.addEventListener('click', () => { void performCopy(); });
  download.addEventListener('click', performDownload);
  doc.body.append(dialog); dialog.showModal(); closeButton.focus();
  loadBlob(png);
  return close;
}
