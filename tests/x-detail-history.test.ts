import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { installDetailHistory } from '../utils/x-detail-history.ts';

let win: Window;
let controller: ReturnType<typeof installDetailHistory>;
let displayed: string | undefined;
let enabled: boolean;
beforeEach(() => {
  win = new Window({ url: 'https://x.com/home' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: win.location });
  win.history.replaceState({ key: 'native-route', state: { retained: true } }, '');
  Object.defineProperty(win, 'navigation', { configurable: true, value: new win.EventTarget() });
  enabled = true;
  displayed = undefined;
  controller = installDetailHistory(url => { displayed = url; }, () => {}, () => enabled);
});
afterEach(async () => { controller.remove(); await win.happyDOM.close(); });
function pop(state: object | null, path = '/home') {
  win.history.replaceState(state, '', path);
  win.dispatchEvent(new win.PopStateEvent('popstate', { state }));
}

test('back/forward restores selected posts and the empty pane without changing X route state', () => {
  controller.select('https://x.com/a/status/1');
  const first = win.history.state;
  controller.select('https://x.com/b/status/2');
  const second = win.history.state as Record<string, unknown>;
  assert.equal(win.location.href, 'https://x.com/home');
  assert.equal(second.key, 'native-route');
  assert.deepEqual(second.state, { retained: true });
  assert.equal(controller.canBack(), true);
  assert.equal(controller.canForward(), false);
  pop(first);
  assert.equal(displayed, 'https://x.com/a/status/1');
  assert.equal(controller.canForward(), true);
  pop(second);
  assert.equal(displayed, 'https://x.com/b/status/2');
  controller.select(undefined);
  assert.equal(displayed, undefined);
  pop(second);
  assert.equal(displayed, 'https://x.com/b/status/2');
});
test('new selections discard the forward branch and repeated selections do not create entries', () => {
  controller.select('https://x.com/a/status/1');
  const first = win.history.state;
  const length = win.history.length;
  controller.select('https://x.com/a/status/1');
  assert.equal(win.history.length, length);
  controller.select('https://x.com/b/status/2');
  pop(first);
  controller.select('https://x.com/c/status/3');
  assert.equal(controller.canForward(), false);
  assert.equal(displayed, 'https://x.com/c/status/3');
});
test('only owned active detail events are intercepted; real route navigation reaches X', () => {
  controller.select('https://x.com/a/status/1');
  const first = win.history.state;
  let nativeEvents = 0;
  win.addEventListener('popstate', () => { nativeEvents++; });
  pop(first);
  assert.equal(nativeEvents, 0);
  pop({ key: 'explore' }, '/explore');
  assert.equal(nativeEvents, 1);
  enabled = false;
  pop(first);
  assert.equal(nativeEvents, 2);
});
test('cleanup removes only its own marker and listener, preserving host changes', () => {
  controller.select('https://x.com/a/status/1');
  win.history.replaceState({ ...win.history.state, other: 'new host state' }, '');
  controller.remove();
  assert.deepEqual(win.history.state, { key: 'native-route', state: { retained: true }, other: 'new host state' });
});

test('native route traversal renders in X before restoring the detail pane', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  controller.select('https://x.com/a/status/1');
  const first = win.history.state;
  let nativeEvents = 0;
  win.addEventListener('popstate', () => { nativeEvents++; });
  const change = new win.Event('currententrychange');
  Object.defineProperty(change, 'from', { value: { url: 'https://x.com/explore' } });
  (win as any).navigation.dispatchEvent(change);
  pop(first);
  assert.equal(nativeEvents, 1);
  t.mock.timers.tick(1);
  assert.equal(displayed, 'https://x.com/a/status/1');
});

test('detail histories from different X routes do not overwrite each other', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  controller.select('https://x.com/a/status/1');
  const home = win.history.state;
  pop({ key: 'search-route' }, '/search?q=design');
  controller.select('https://x.com/b/status/2');
  const search = win.history.state;
  pop(home, '/home');
  t.mock.timers.tick(1);
  assert.equal(displayed, 'https://x.com/a/status/1');
  assert.equal(controller.canBack(), true);
  pop(search, '/search?q=design');
  t.mock.timers.tick(1);
  assert.equal(displayed, 'https://x.com/b/status/2');
});

test('native route traversal reaches X when the Navigation API is unavailable', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  controller.remove();
  Object.defineProperty(win, 'navigation', { configurable: true, value: undefined });
  controller = installDetailHistory(url => { displayed = url; }, () => {}, () => enabled);
  controller.select('https://x.com/a/status/1');
  const home = win.history.state;
  win.history.pushState({ key: 'explore' }, '', '/explore');
  controller.restore(); // The content script's location-change notification.
  let nativeEvents = 0;
  win.addEventListener('popstate', () => { nativeEvents++; });
  pop(home, '/home');
  assert.equal(nativeEvents, 1);
  t.mock.timers.tick(1);
  assert.equal(displayed, 'https://x.com/a/status/1');
  pop(home);
  assert.equal(nativeEvents, 1);
});
