// Prepended to the content scripts of the regression copy of the build.
// Replaces every clipboard path used by utils/clipboard.ts with an in-memory
// recorder that writes to a DOM attribute, so the test never touches the
// system clipboard. Setting data-se-test-clipboard-mode="reject" on <html>
// makes writeText fail to exercise the execCommand fallback.
(() => {
  const root = () => document.documentElement;
  const record = (text, via) => {
    const list = JSON.parse(root().getAttribute('data-se-test-clipboard') || '[]');
    list.push({ text: String(text), via });
    root().setAttribute('data-se-test-clipboard', JSON.stringify(list));
  };
  Object.defineProperty(Clipboard.prototype, 'writeText', {
    configurable: true,
    value: async function writeText(text) {
      if (root().getAttribute('data-se-test-clipboard-mode') === 'reject') {
        throw new DOMException('Rejected by the regression harness', 'NotAllowedError');
      }
      record(text, 'clipboard');
    },
  });
  Object.defineProperty(Clipboard.prototype, 'write', {
    configurable: true,
    value: async function write() { throw new DOMException('Not available in the regression harness', 'NotAllowedError'); },
  });
  Object.defineProperty(Document.prototype, 'execCommand', {
    configurable: true,
    value: function execCommand(command) {
      if (String(command).toLowerCase() !== 'copy') return false;
      const active = document.activeElement;
      record(active && 'value' in active ? active.value : String(getSelection()), 'execCommand');
      return true;
    },
  });
  const mark = () => root().setAttribute('data-se-test-shim', `${root().getAttribute('data-se-test-shim') ?? ''} ${globalThis.__seShimName ?? 'page'}`.trim());
  if (document.documentElement) mark(); else document.addEventListener('readystatechange', mark, { once: true });
})();
