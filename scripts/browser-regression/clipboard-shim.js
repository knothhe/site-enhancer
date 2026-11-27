// Prepended to the content scripts of the regression copy of the build.
// Replaces every clipboard path used by utils/clipboard.ts with an in-memory
// recorder that writes to a DOM attribute, so the test never touches the
// system clipboard. Setting data-se-test-clipboard-mode="reject" on <html>
// makes writeText fail to exercise the execCommand fallback.
(() => {
  const root = () => document.documentElement;
  const record = entry => {
    const list = JSON.parse(root().getAttribute('data-se-test-clipboard') || '[]');
    list.push(entry);
    root().setAttribute('data-se-test-clipboard', JSON.stringify(list));
  };
  Object.defineProperty(Clipboard.prototype, 'writeText', {
    configurable: true,
    value: async function writeText(text) {
      if (root().getAttribute('data-se-test-clipboard-mode') === 'reject') {
        throw new DOMException('Rejected by the regression harness', 'NotAllowedError');
      }
      record({ text: String(text), via: 'clipboard' });
    },
  });
  Object.defineProperty(Clipboard.prototype, 'write', {
    configurable: true,
    value: async function write(items) {
      for (const item of items) {
        const png = await item.getType('image/png');
        const signature = Array.from(new Uint8Array(await png.slice(0, 8).arrayBuffer()));
        const bitmap = await createImageBitmap(png);
        // The corner and center are stable samples of the test fixture's padding and post.
        const canvas = new OffscreenCanvas(1, 1);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const sample = (x, y) => {
          ctx.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        };
        record({
          type: png.type, signature, width: bitmap.width, height: bitmap.height,
          corner: sample(0, 0), center: sample(bitmap.width >> 1, bitmap.height >> 1),
        });
        bitmap.close();
      }
    },
  });
  Object.defineProperty(Document.prototype, 'execCommand', {
    configurable: true,
    value: function execCommand(command) {
      if (String(command).toLowerCase() !== 'copy') return false;
      const active = document.activeElement;
      record({ text: active && 'value' in active ? active.value : String(getSelection()), via: 'execCommand' });
      return true;
    },
  });
  const mark = () => root().setAttribute('data-se-test-shim', `${root().getAttribute('data-se-test-shim') ?? ''} ${globalThis.__seShimName ?? 'page'}`.trim());
  if (document.documentElement) mark(); else document.addEventListener('readystatechange', mark, { once: true });
})();
