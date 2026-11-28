import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { ScreenshotTooLargeError } from '../utils/x-screenshot.ts';
import { encodeScreenshot, showScreenshotPreview, type ScreenshotScope } from '../utils/x-screenshot-preview.ts';

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
  let rerenderOptions: { hideMetrics: boolean; scope: ScreenshotScope } | undefined;
  const close = showScreenshotPreview(doc, Promise.resolve(original), trigger, {
    scopes: [{id:'post',count:1},{id:'parent',count:2}], scope:'parent',
    rerender: async opts => { rerenderOptions = opts; return updated; },
  });
  await Promise.resolve();
  const dialog = doc.querySelector('dialog')!;
  assert.equal(dialog.hasAttribute('data-dark'), true);
  const toggles = dialog.querySelectorAll<HTMLButtonElement>('button[aria-pressed]');
  assert.equal(toggles.length, 2);
  assert.equal(toggles[1].getAttribute('aria-pressed'),'false');
  toggles[0].click();
  assert.equal(toggles[0].getAttribute('aria-pressed'),'true');
  assert.equal(doc.querySelector('canvas'),original);
  assert.deepEqual(rerenderOptions, { hideMetrics: true, scope: 'parent' });
  failOriginal(null);
  await new Promise(setImmediate);
  const copy = doc.querySelector<HTMLButtonElement>('[data-copy]')!;
  assert.equal(doc.querySelector('canvas:not([data-outgoing])'), updated);
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

test('keyboard toggles reuse idle-rendered canvases and PNGs while the preview body stays mounted', async () => {
  const { win, doc, trigger } = setup();
  const renders: string[] = [], encodes: string[] = [];
  function canvas(id: string) {
    const el = doc.createElement('canvas');
    el.dataset.key = id;
    el.toBlob = cb => { encodes.push(id); cb(new Blob()); };
    return el;
  }
  let idle!: () => void;
  Object.defineProperty(win,'requestIdleCallback',{value:(fn: () => void) => { idle = fn; }});
  const initial = canvas('false/parent');
  const close = showScreenshotPreview(doc,Promise.resolve(initial),trigger,{
    scopes: [{id:'post',count:1},{id:'parent',count:2},{id:'thread',count:4}], scope:'parent',
    rerender: async ({ hideMetrics, scope }) => {
      const id = hideMetrics + '/' + scope;
      renders.push(id); return canvas(id);
    },
  });
  await Promise.resolve(); idle(); await new Promise(setImmediate);
  const dialog = doc.querySelector('dialog')!, body = dialog.querySelector('.se-shot-body');
  // happy-dom does not resolve dynamic viewport units. Browser regression
  // measures the actual top edge and the gap below the canvas.
  assert.match(dialog.querySelector('style')!.textContent!,/margin:5dvh auto auto;transition:height 150ms/);
  assert.match(dialog.querySelector('style')!.textContent!,/max-height:90dvh/);
  assert.equal(dialog.querySelector('h2'),null);
  assert.equal(dialog.querySelector('[data-copy]')?.textContent,'Copy');
  assert.equal(dialog.querySelector('[data-copy]')?.getAttribute('aria-label'),'Copy image (C)');
  assert.equal(dialog.querySelector('[role=radiogroup]')!.getAttribute('aria-label'), 'Copy scope');
  const radios = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role=radio]'));
  assert.deepEqual(radios.map(r => [r.textContent, r.tabIndex, r.getAttribute('aria-checked')]), [
    ['This post', -1, 'false'], ['With original', 0, 'true'], ['Full thread · 4', -1, 'false'],
  ]);
  assert.deepEqual(renders, ['true/parent','false/post','true/post','false/thread']);
  radios[1].focus();
  radios[1].dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft', bubbles:true}) as unknown as Event);
  assert.equal(doc.activeElement, radios[0]);
  for (const [key, expected] of [['2','false/parent'],['h','true/parent'],['p','true/thread'],['1','true/post'],['h','false/post'],['3','false/thread'],['p','false/post']]) {
    dialog.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true}) as unknown as Event);
    assert.ok(body!.querySelector('canvas'));
    await Promise.resolve();
    assert.equal(dialog.querySelector('.se-shot-body'),body);
    assert.equal(body!.querySelector<HTMLCanvasElement>('canvas:not([data-outgoing])')!.dataset.key,expected);
  }
  assert.equal(renders.length,5); assert.equal(new Set(encodes).size,6); assert.equal(encodes.length,6);
  close(); await win.happyDOM.close();
});

test('a thread beyond the canvas cap reports the specific error and switching back restores export', async t => {
  const { win, doc, trigger } = setup();
  t.after(() => win.happyDOM.close());
  const canvas = doc.createElement('canvas');
  canvas.toBlob = cb => cb(new Blob());
  const close = showScreenshotPreview(doc, Promise.resolve(canvas), trigger, {
    scopes: [{id:'post', count:1}, {id:'thread', count:3}],
    rerender: async () => { throw new ScreenshotTooLargeError(); },
  });
  const [post, thread] = doc.querySelectorAll<HTMLButtonElement>('[role=radio]');
  thread.click();
  await new Promise(setImmediate);
  assert.equal(doc.querySelector('[role=status]')?.textContent, 'Thread is too long to capture');
  assert.equal(doc.querySelector<HTMLButtonElement>('[data-copy]')!.disabled, true);
  post.click();
  await new Promise(setImmediate);
  assert.equal(doc.querySelector<HTMLButtonElement>('[data-copy]')!.disabled, false);
  assert.equal(doc.querySelector('.se-shot-toast')?.textContent, '');
  close();
});

test('rounding reuses the source capture and exports the PNG of the displayed canvas', async t => {
  const { win, doc, trigger } = setup();
  t.after(() => win.happyDOM.close());
  const canvas = doc.createElement('canvas');
  const changes: boolean[] = [];
  let draws = 0, renders = 0;
  const blob = new Blob(['rounded']);
  t.mock.method(win.HTMLCanvasElement.prototype, 'getContext', () => ({
    beginPath() {}, roundRect() {}, clip() {}, drawImage(source: HTMLCanvasElement) {
      assert.equal(source, canvas);
      draws++;
    },
  }));
  t.mock.method(win.HTMLCanvasElement.prototype, 'toBlob', (cb: BlobCallback) => cb(blob));
  canvas.toBlob = cb => cb(new Blob(['square']));
  let copied: Promise<Blob> | undefined;
  Object.defineProperty(win, 'ClipboardItem', { value: class {
    constructor(data: Record<string, Promise<Blob>>) { copied = data['image/png']; }
  } });
  Object.defineProperty(win.navigator.clipboard, 'write', { value: async () => {} });
  const close = showScreenshotPreview(doc, Promise.resolve(canvas), trigger, {
    rerender: async () => { renders++; return canvas; },
    onRoundedChange: value => changes.push(value),
  });
  await Promise.resolve();
  const dialog = doc.querySelector('dialog')!;
  assert.equal(dialog.querySelector('[role=radiogroup]'), null);
  assert.equal(doc.activeElement, dialog.querySelector('.se-shot-close'));
  const press = async (key: string) => {
    dialog.dispatchEvent(new win.KeyboardEvent('keydown', {key, bubbles:true}) as unknown as Event);
    await Promise.resolve();
  };
  await press('2'); await press('p'); await press('r');
  const rounded = dialog.querySelector('canvas:not([data-outgoing])');
  assert.ok(rounded && rounded !== canvas);
  assert.equal(dialog.querySelector('[title="Rounded corners (R)"]')?.getAttribute('aria-pressed'), 'true');
  await press('c');
  assert.equal(await copied, blob);
  await press('r');
  assert.equal(dialog.querySelector('canvas:not([data-outgoing])'), canvas);
  await press('r');
  assert.equal(dialog.querySelector('canvas:not([data-outgoing])'), rounded);
  assert.equal(renders, 0);
  assert.equal(draws, 1);
  assert.deepEqual(changes, [true, false, true]);
  close();
});

test('T starts a clipboard write during the gesture while the image is loading', async t => {
  const { win, doc, trigger } = setup();
  t.after(() => win.happyDOM.close());
  let finish!: (text: string) => void;
  let written: Promise<Blob> | undefined;
  Object.defineProperty(win, 'ClipboardItem', { value: class {
    data: Record<string, Promise<Blob>>;
    constructor(data: Record<string, Promise<Blob>>) { this.data = data; }
  } });
  Object.defineProperty(win.navigator.clipboard, 'write', { value: async ([item]: { data: Record<string, Promise<Blob>> }[]) => {
    written = item.data['text/plain'];
    await written;
  } });
  const close = showScreenshotPreview(doc, new Promise(() => {}), trigger, {
    scopes: [{ id: 'thread', count: 2 }],
    copyText: scope => {
      assert.equal(scope, 'thread');
      return new Promise(resolve => { finish = resolve; });
    },
  });
  const dialog = doc.querySelector('dialog')!;
  const press = () => doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 't', bubbles: true }) as unknown as Event);
  assert.equal(dialog.querySelector<HTMLButtonElement>('[data-copy]')!.disabled, true);
  press();
  assert.ok(written);
  finish('First and second');
  assert.equal(await (await written).text(), 'First and second');
  await new Promise(setImmediate);
  assert.equal(dialog.querySelector('[role=status]')!.textContent, 'Text copied');
  press();
  finish('');
  await new Promise(setImmediate);
  assert.equal(dialog.querySelector('.se-shot-toast')!.textContent, 'No text to copy');
  close();
});
