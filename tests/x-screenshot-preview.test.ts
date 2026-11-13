import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window, HTMLButtonElement } from 'happy-dom';
import { showScreenshotPreview } from '../utils/x-screenshot-preview.ts';

test('preview waits for rendering and never copies before confirmation', async () => {
  const win = new Window();
  const trigger = win.document.createElement('button'); win.document.body.append(trigger);
  let resolve!: (value: Blob) => void;
  const pending = new Promise<Blob>(done => { resolve = done; });
  let writes = 0;
  Object.defineProperty(win.navigator.clipboard, 'write', { value: async () => { writes++; } });
  const close = showScreenshotPreview(win.document as unknown as Document, pending, trigger as unknown as HTMLElement);
  assert.equal(win.document.querySelector<HTMLButtonElement>('[data-copy]')!.disabled, true);
  assert.equal(writes, 0);
  close();
  resolve(new Blob(['png'], { type: 'image/png' })); await Promise.resolve();
  assert.equal(win.document.querySelector('dialog'), null);
  assert.equal(writes, 0);
  assert.equal(win.document.activeElement, trigger);
  await win.happyDOM.close();
});

test('preview reports a render error and keeps copying disabled', async () => {
  const win = new Window();
  const trigger = win.document.createElement('button'); win.document.body.append(trigger);
  const close = showScreenshotPreview(win.document as unknown as Document, Promise.reject(new Error('capture failed')), trigger as unknown as HTMLElement);
  await Promise.resolve(); await Promise.resolve();
  assert.match(win.document.querySelector('[role=status]')!.textContent!, /Screenshot failed/);
  assert.equal(win.document.querySelector<HTMLButtonElement>('[data-copy]')!.disabled, true);
  close(); await win.happyDOM.close();
});
