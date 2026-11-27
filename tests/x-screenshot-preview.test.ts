import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { encodeScreenshot, showScreenshotPreview } from '../utils/x-screenshot-preview.ts';

function setup() {
  const win = new Window();
  const doc = win.document as unknown as Document;
  const trigger = doc.createElement('button');
  doc.body.append(trigger);
  return { win, doc, trigger };
}

test('closing before rendering finishes restores focus and never copies', async () => {
  const { win, doc, trigger } = setup();
  let resolve!: (value: HTMLCanvasElement) => void;
  const pending = new Promise<HTMLCanvasElement>(done => { resolve = done; });
  let writes = 0, closed = 0;
  Object.defineProperty(win.navigator.clipboard, 'write', { value: async () => { writes++; } });
  const close = showScreenshotPreview(doc, pending, trigger, { onClose: () => { closed++; } });
  assert.equal(doc.querySelector<HTMLButtonElement>('[data-copy]')!.disabled, true);
  close();
  close();
  resolve(doc.createElement('canvas'));
  await Promise.resolve();
  assert.equal(closed, 1);
  assert.equal(doc.querySelector('dialog'), null);
  assert.equal(writes, 0);
  assert.equal(doc.activeElement, trigger);
  await win.happyDOM.close();
});

test('preview reports a render error and keeps copying disabled', async () => {
  const { win, doc, trigger } = setup();
  const close = showScreenshotPreview(doc, Promise.reject(new Error('capture failed')), trigger);
  await new Promise(setImmediate);
  assert.match(doc.querySelector('[role=status]')!.textContent!, /Screenshot failed/);
  assert.equal(doc.querySelector<HTMLButtonElement>('[data-copy]')!.disabled, true);
  close(); await win.happyDOM.close();
});

test('preview shows the canvas and shares the pre-encoded PNG for copy and download', async t => {
  const { win, doc, trigger } = setup();
  const canvas = doc.createElement('canvas');
  let finish!: BlobCallback, encodes = 0;
  canvas.toBlob = (callback, mime) => {
    assert.equal(mime, 'image/png');
    finish = callback;
    encodes++;
  };
  const blob = new Blob(['image bytes'], { type: 'image/png' });
  const writes: Promise<Blob>[] = [];
  class TestClipboardItem {
    data: Record<string, Promise<Blob>>;
    constructor(data: Record<string, Promise<Blob>>) { this.data = data; }
  }
  Object.defineProperty(win, 'ClipboardItem', { value: TestClipboardItem });
  Object.defineProperty(win.navigator.clipboard, 'write', {
    value: async ([item]: TestClipboardItem[]) => {
      writes.push(item.data['image/png']);
      await item.data['image/png'];
    },
  });
  const clicked: string[] = [], revoked: string[] = [];
  t.mock.method(win.URL, 'createObjectURL', (value: Blob) => {
    assert.equal(value, blob);
    return 'blob:preview';
  });
  t.mock.method(win.URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  t.mock.method(win.HTMLAnchorElement.prototype, 'click', function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });

  const prepared = encodeScreenshot(canvas);
  const close = showScreenshotPreview(doc, Promise.resolve(canvas), trigger, { filename: 'alice_123.png' });
  await Promise.resolve();
  const copy = doc.querySelector<HTMLButtonElement>('[data-copy]')!;
  const download = doc.querySelector<HTMLButtonElement>('[data-download]')!;
  assert.equal(doc.querySelector('.se-shot-body canvas'), canvas);
  assert.equal(copy.disabled, false);
  assert.equal(download.disabled, false);
  assert.equal(writes.length, 0);
  copy.click();
  assert.equal(writes[0], prepared);
  download.click();
  assert.deepEqual(clicked, []);
  finish(blob);
  assert.equal(await writes[0], blob);
  await new Promise(setImmediate);
  assert.deepEqual(clicked, ['alice_123.png']);
  assert.equal(encodes, 1);
  close();
  assert.deepEqual(revoked, ['blob:preview']);
  await win.happyDOM.close();
});

test('changing options discards stale exports and handles encoding failure on the active canvas', async () => {
  const { win, doc, trigger } = setup();
  doc.documentElement.setAttribute('data-theme', 'dark');
  const original = doc.createElement('canvas'), updated = doc.createElement('canvas');
  let failOriginal!: BlobCallback, failUpdated!: BlobCallback;
  original.toBlob = callback => { failOriginal = callback; };
  updated.toBlob = callback => { failUpdated = callback; };
  let rerenderOptions: { hideMetrics: boolean; includeParent: boolean } | undefined;
  const close = showScreenshotPreview(doc, Promise.resolve(original), trigger, {
    hasParent: true,
    rerender: async opts => { rerenderOptions = opts; return updated; },
  });
  await Promise.resolve();
  const dialog = doc.querySelector('dialog')!;
  assert.equal(dialog.hasAttribute('data-dark'), true);
  const checkboxes = dialog.querySelectorAll('input');
  assert.equal(checkboxes.length, 2);
  checkboxes[0].checked = true;
  checkboxes[0].dispatchEvent(new win.Event('change') as unknown as Event);
  assert.deepEqual(rerenderOptions, { hideMetrics: true, includeParent: true });
  failOriginal(null);
  await new Promise(setImmediate);
  const copy = doc.querySelector<HTMLButtonElement>('[data-copy]')!;
  assert.equal(doc.querySelector('canvas'), updated);
  assert.equal(copy.disabled, false);
  failUpdated(null);
  await new Promise(setImmediate);
  assert.equal(copy.disabled, true);
  assert.equal(doc.querySelector<HTMLButtonElement>('[data-download]')!.disabled, true);
  assert.match(doc.querySelector('[role=status]')!.textContent!, /Screenshot failed/);
  close(); await win.happyDOM.close();
});

test('a failed speculative encoding can be retried on the same canvas', async () => {
  const { win, doc } = setup();
  const canvas = doc.createElement('canvas');
  canvas.toBlob = callback => callback(null);
  await assert.rejects(encodeScreenshot(canvas), /PNG encoding failed/);
  const blob = new Blob(['png'], { type: 'image/png' });
  canvas.toBlob = callback => callback(blob);
  assert.equal(await encodeScreenshot(canvas), blob);
  await win.happyDOM.close();
});
