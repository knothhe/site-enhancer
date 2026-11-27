import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window, HTMLButtonElement, HTMLInputElement } from 'happy-dom';
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

test('preview syncs dark host theme, supports download and option rerenders', async () => {
  const win = new Window();
  win.document.documentElement.setAttribute('data-theme', 'dark');
  const trigger = win.document.createElement('button'); win.document.body.append(trigger);
  let rerenderCalls: Array<{ hideMetrics: boolean; includeParent: boolean }> = [];
  const blob = new Blob(['png'], { type: 'image/png' });
  const close = showScreenshotPreview(
    win.document as unknown as Document,
    Promise.resolve(blob),
    trigger as unknown as HTMLElement,
    {
      filename: 'alice_123.png',
      hasParent: true,
      rerender: async opts => { rerenderCalls.push(opts); return blob; },
    },
  );
  const dialog = win.document.querySelector('dialog')!;
  assert.equal(dialog.hasAttribute('data-dark'), true);
  const checkboxes = dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  assert.equal(checkboxes.length, 2);
  checkboxes[0].checked = true;
  checkboxes[0].dispatchEvent(new win.Event('change'));
  assert.deepEqual(rerenderCalls, [{ hideMetrics: true, includeParent: true }]);
  close(); await win.happyDOM.close();
});
