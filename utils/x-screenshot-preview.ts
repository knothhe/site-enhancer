/** Preview and copy the exact same PNG. Closing invalidates pending rendering. */
export function showScreenshotPreview(doc: Document, png: Promise<Blob>, trigger: HTMLElement): () => void {
  const view = doc.defaultView!;
  const zh = doc.documentElement.lang.toLowerCase().startsWith('zh');
  const text = zh ? {
    title: '截图预览', loading: '正在生成截图…', copy: '复制图片', close: '关闭',
    ready: '确认截图后复制', copied: '已复制图片', failed: '截图生成失败，请关闭后重试', copyFailed: '复制失败，请重试',
  } : {
    title: 'Screenshot preview', loading: 'Creating screenshot…', copy: 'Copy image', close: 'Close',
    ready: 'Review your screenshot before copying', copied: 'Image copied', failed: 'Screenshot failed. Close and try again.', copyFailed: 'Copy failed. Please try again.',
  };
  const dialog = doc.createElement('dialog');
  dialog.className = 'se-screenshot-preview';
  dialog.setAttribute('aria-label', text.title);
  const style = doc.createElement('style');
  style.textContent = `
.se-screenshot-preview{box-sizing:border-box;width:min(760px,94vw);max-width:94vw;max-height:90dvh;padding:0;border:1px solid #d5d9df;border-radius:16px;background:#fff;color:#17202a;font:14px/1.5 system-ui;box-shadow:0 24px 80px #0005;overflow:hidden}
.se-screenshot-preview[open]{display:flex;flex-direction:column}
.se-screenshot-preview::backdrop{background:#0009}
.se-screenshot-preview header,.se-screenshot-preview footer{display:flex;align-items:center;gap:12px;padding:16px 20px;flex-shrink:0}
.se-screenshot-preview h2{margin:0;flex:1;font:600 18px/1.4 system-ui}
.se-screenshot-preview button{font:600 14px system-ui;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;background:#e9edf2;color:#17202a}
.se-screenshot-preview button[data-copy]{background:#1769d2;color:#fff}
.se-screenshot-preview button:disabled{opacity:.5;cursor:wait}
.se-screenshot-preview button:focus-visible{outline:2px solid #1769d2;outline-offset:2px}
.se-screenshot-preview .se-shot-body{min-height:100px;overflow:auto;overscroll-behavior:contain;padding:20px;background:#e9edf2;scrollbar-color:#9aa4b2 #e9edf2}
.se-screenshot-preview img{display:block;width:100%;height:auto;max-width:100%;margin:auto;box-shadow:0 2px 12px #0002}
.se-screenshot-preview img[hidden]{display:none}
.se-screenshot-preview [role=status]{margin:0;flex:1}
@media(prefers-color-scheme:dark){.se-screenshot-preview{background:#20242b;color:#f0f2f5;border-color:#414852}.se-screenshot-preview .se-shot-body{background:#12151a;scrollbar-color:#59616c #12151a}.se-screenshot-preview button{background:#353c46;color:#f0f2f5}}
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
  const copy = doc.createElement('button'); copy.type = 'button'; copy.dataset.copy = '';
  copy.textContent = text.copy; copy.disabled = true;
  header.append(title, closeButton); footer.append(status, copy); dialog.append(style, header, body, footer);
  let closed = false, url: string | undefined, blob: Blob | undefined;
  function close() {
    if (closed) return;
    closed = true;
    if (url) view.URL.revokeObjectURL(url);
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
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
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  copy.addEventListener('click', async () => {
    if (!blob || closed) return;
    copy.disabled = true;
    try {
      await view.navigator.clipboard.write([new view.ClipboardItem({ 'image/png': blob })]);
      if (!closed) status.textContent = text.copied;
    } catch { if (!closed) status.textContent = text.copyFailed; }
    finally { if (!closed) copy.disabled = false; }
  });
  doc.body.append(dialog); dialog.showModal(); closeButton.focus();
  void png.then(async value => {
    if (closed) return;
    blob = value; url = view.URL.createObjectURL(value); image.src = url;
    await image.decode();
    if (closed) return;
    image.hidden = false; copy.disabled = false; status.textContent = text.ready;
  }).catch(() => { if (!closed) status.textContent = text.failed; });
  return close;
}
