import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { holdPreloadedAutoplay, VIDEO_PLAY_REQUEST } from '../utils/x-video-gate.ts';
import { installXVideoPlayback, parseVideoVolume, VIDEO_VOLUME_KEY } from '../utils/x-video-playback.ts';

let win: Window;
let active: boolean;
let blocked: Set<Document>;
let hidden: Set<Document>;
let playback: ReturnType<typeof installXVideoPlayback> | undefined;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

beforeEach(() => {
  win = new Window({ url: 'https://x.com/home' });
  active = true; blocked = new Set(); hidden = new Set();
  Object.defineProperty(win.navigator, 'userActivation', { configurable: true, get: () => ({ hasBeenActive: active }) });
  for (const name of ['window', 'document', 'localStorage']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : (win as any)[name] });
  }
});
afterEach(async () => { playback?.remove(); playback = undefined; await win.happyDOM.close(); });

function start() {
  playback = installXVideoPlayback({
    blocked: doc => blocked.has(doc), hidden: doc => hidden.has(doc), expanded: () => undefined,
  });
  playback.attach(document);
  return playback;
}
function frameDocument() {
  const frame = new Window({ url: 'https://x.com/alice/status/1' });
  return frame.document as unknown as Document;
}
function addVideo(doc: Document = document, parent: Element = doc.body) {
  const view = doc.defaultView!;
  const player = doc.createElement('div');
  player.dataset.testid = 'videoPlayer';
  player.innerHTML = `<video></video><div data-testid="scrubber"><div role="slider"></div></div>
    <div class="transport"><button class="play"></button></div>
    <div class="volume"><button class="mute"></button><div><div role="slider"></div></div></div>`;
  parent.append(player);
  const video = player.querySelector('video')!;
  let paused = true, volume = 1, muted = false;
  let pauses = 0, changes = 0;
  const emit = (type: string) => video.dispatchEvent(new view.Event(type));
  Object.defineProperties(video, {
    paused: { get: () => paused }, ended: { get: () => false },
    volume: { get: () => volume, set: (value: number) => { volume = value; changes++; emit('volumechange'); } },
    muted: { get: () => muted, set: (value: boolean) => { muted = value; changes++; emit('volumechange'); } },
  });
  video.pause = () => { if (!paused) { paused = true; pauses++; emit('pause'); } };
  // As the gated play() does: ask first, then start.
  video.play = () => {
    if (!video.dispatchEvent(new view.Event(VIDEO_PLAY_REQUEST, { bubbles: true, cancelable: true }))) return Promise.reject(new Error('refused'));
    if (paused) { paused = false; emit('play'); }
    return Promise.resolve();
  };
  const press = (selector: string, release = true) => {
    const target = player.querySelector(selector)!;
    target.dispatchEvent(new view.Event('pointerdown', { bubbles: true }));
    if (release) target.dispatchEvent(new view.Event('pointerup', { bubbles: true }));
  };
  return { player, video, press, pauses: () => pauses, changes: () => changes };
}
const stored = () => JSON.parse(localStorage.getItem(VIDEO_VOLUME_KEY) ?? 'null');

test('stored volumes are validated', () => {
  assert.deepEqual(parseVideoVolume('{"volume":0.4,"muted":true}'), { volume: .4, muted: true });
  for (const value of [null, '', 'x', '{}', '{"volume":0,"muted":true}', '{"volume":2,"muted":false}', '{"volume":0.5}']) {
    assert.equal(parseVideoVolume(value), undefined);
  }
});

test('a newly autoplayed video replaces the previous one without a play/pause fight', async () => {
  start();
  const first = addVideo(), second = addVideo();
  await first.video.play();
  await second.video.play();
  assert.equal(first.video.paused, true);
  assert.equal(second.video.paused, false);
  for (let i = 0; i < 5; i++) await assert.rejects(first.video.play());
  assert.equal(first.pauses(), 1, 'retries are refused before playback starts');
  assert.equal(second.pauses(), 0);
  second.video.pause();
  await first.video.play();
  assert.equal(first.video.paused, false, 'a stopped video may play once nothing else does');
});

test('autoplay in any document never interrupts a video the user started, and the user can always switch', async () => {
  const rules = start();
  const detail = frameDocument(); rules.attach(detail);
  const feed = addVideo(), other = addVideo(), reply = addVideo(detail);
  feed.press('.play');
  await feed.video.play();
  await assert.rejects(other.video.play());
  await assert.rejects(reply.video.play());
  reply.press('.play');
  await reply.video.play();
  assert.equal(feed.video.paused, true);
  await assert.rejects(feed.video.play(), 'X cannot resume the video the user left');
  feed.press('.play');
  await feed.video.play();
  assert.equal(reply.video.paused, true);
});

test('a video opened in X\'s media dialog outranks blocked timeline videos', async () => {
  start(); blocked.add(document);
  const feed = addVideo();
  await assert.rejects(feed.video.play());
  feed.press('.play');
  await feed.video.play();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  const media = addVideo(document, dialog);
  await media.video.play();
  assert.equal(feed.video.paused, true);
  await assert.rejects(feed.video.play());
  assert.equal(media.pauses(), 0);
});

test('a hidden document cannot play even a video the user started there', async () => {
  const rules = start();
  const detail = frameDocument(); rules.attach(detail);
  const reply = addVideo(detail);
  reply.press('.play');
  hidden.add(detail); blocked.add(detail);
  await assert.rejects(reply.video.play());
});

test('videos already playing when a document is attached are reduced to one', async () => {
  const rules = start();
  const feed = addVideo(); feed.press('.play'); await feed.video.play();
  const detail = frameDocument();
  const reply = addVideo(detail); await reply.video.play();
  assert.equal(reply.video.paused, false);
  rules.attach(detail);
  assert.equal(reply.video.paused, true);
  assert.equal(feed.video.paused, false);
});

test('without a volume choice X\'s own volume and muted autoplay are untouched', async () => {
  start();
  const { video, press, changes } = addVideo();
  press('.play');
  video.muted = true;
  await video.play(); await tick();
  assert.equal(changes(), 1);
  assert.equal(stored(), null);
});

test('a volume change applies to every document and is remembered', async () => {
  const rules = start();
  const detail = frameDocument(); rules.attach(detail);
  const feed = addVideo(), reply = addVideo(detail);
  reply.video.muted = true;
  feed.press('.volume [role="slider"]', false);
  feed.video.volume = .6; feed.video.volume = .3;
  assert.equal(reply.video.volume, .3);
  assert.equal(reply.video.muted, false);
  assert.deepEqual(stored(), { volume: .3, muted: false });
  // X mutes a video again whenever it autoplays it, and starts new players at full volume.
  const later = addVideo();
  later.video.muted = true;
  await later.video.play(); await tick();
  assert.equal(later.video.muted, false);
  assert.equal(later.video.volume, .3);
  assert.deepEqual(stored(), { volume: .3, muted: false });
  // A new page starts with the remembered volume.
  rules.remove();
  start();
  const next = addVideo();
  await next.video.play(); await tick();
  assert.equal(next.video.volume, .3);
});

test('muting, unmuting by pressing the video and dragging to zero are shared', () => {
  start();
  const first = addVideo(), second = addVideo();
  first.press('.volume .mute'); first.video.muted = true;
  assert.equal(second.video.muted, true);
  second.press('video'); second.video.muted = false;
  assert.equal(first.video.muted, false, 'pressing a muted video unmutes it on X');
  first.press('.volume [role="slider"]', false);
  first.video.volume = .5;
  first.press('.volume [role="slider"]', false);
  first.video.volume = .1; first.video.volume = 0;
  assert.deepEqual(stored(), { volume: .5, muted: true }, 'the level before the drag is kept');
  assert.equal(second.video.muted, true);
  assert.equal(second.video.volume, .5);
});

test('programmatic changes during playback controls are not remembered', async () => {
  start();
  const { video, press } = addVideo();
  press('.volume [role="slider"]'); video.volume = .4;
  press('.play'); press('[data-testid="scrubber"] [role="slider"]');
  video.muted = true; video.volume = 1;
  await tick();
  assert.equal(video.muted, false);
  assert.equal(video.volume, .4);
  assert.deepEqual(stored(), { volume: .4, muted: false });
});

test('a remembered audible volume waits for the first interaction before unmuting', async () => {
  localStorage.setItem(VIDEO_VOLUME_KEY, '{"volume":0.5,"muted":false}');
  active = false;
  start();
  const { video, press } = addVideo();
  video.muted = true;
  await video.play(); await tick();
  assert.equal(video.muted, true, 'browsers pause a video unmuted too early');
  assert.equal(video.volume, .5);
  active = true;
  press('.play'); await tick();
  assert.equal(video.muted, false);
});

test('changes from another tab apply, and a competing script cannot cause a correction loop', async () => {
  start();
  const { video, changes } = addVideo();
  localStorage.setItem(VIDEO_VOLUME_KEY, '{"volume":0.2,"muted":false}');
  win.dispatchEvent(new win.StorageEvent('storage', { key: VIDEO_VOLUME_KEY }));
  assert.equal(video.volume, .2);
  video.addEventListener('volumechange', () => { if (video.volume !== .9) video.volume = .9; });
  video.volume = .9;
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(changes() < 40, String(changes()));
});

test('removing the rules restores native playback and volume', async () => {
  const rules = start();
  const first = addVideo(), second = addVideo();
  rules.remove();
  await first.video.play(); await second.video.play();
  assert.equal(first.video.paused, false);
  second.press('.volume .mute'); second.video.muted = true;
  assert.equal(first.video.muted, false);
  assert.equal(stored(), null);
});

test('a preloaded detail holds autoplay until it is first shown', async () => {
  const frame = document.createElement('iframe'); frame.hidden = true;
  Object.defineProperty(win, 'frameElement', { configurable: true, value: frame });
  const stop = holdPreloadedAutoplay(win as never);
  const { video } = addVideo();
  await assert.rejects(video.play());
  assert.equal(video.paused, true);
  frame.hidden = false; await tick();
  assert.equal(video.paused, false);
  frame.hidden = true; video.pause();
  await video.play();
  assert.equal(video.paused, false, 'later hiding is left to the timeline\'s rules');
  stop();
});
