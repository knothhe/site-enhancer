import { readFileSync } from 'node:fs';
import { getTweetData } from '../utils/x-menu.ts';
import { PRIMARY } from '../utils/x-dom.ts';
import { DETAIL_READY_MESSAGE, observeDetailReady } from '../utils/x-detail-ready.ts';
import { test, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { activeWidthPreset, adjustedFeedShare, columnGeometry, gutterPixels, DEFAULT_COLUMNS, parseColumnWidths, detailUrl, postPermalink, nativeVideoUrl, installXColumns, COLUMNS_WIDTH_KEY, COLUMNS_CSS, DETAIL_FRAME_CSS, STRUCTURE_GRACE_MS } from '../utils/x-columns.ts';

import { installVideoPlayGate } from '../utils/x-video-gate.ts';
import { QUOTE_REQUEST, QUOTE_URL, quoteComponentPath, normalizeQuoteUrl } from '../utils/x-quote.ts';

let win: Window;
let columns: ReturnType<typeof installXColumns> | undefined;
beforeEach(() => {
  win = new Window({ url: 'https://x.com/home', width: 1440, settings: { disableIframePageLoading: true } });
  // State tests use reduced motion; animation behavior is tested with a controlled timeline below.
  const matchMedia = win.matchMedia.bind(win);
  win.matchMedia = query => { const result = matchMedia(query); if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(result, 'matches', { value: true }); return result; };
  for (const name of ['window', 'document', 'location', 'localStorage', 'Node', 'Element', 'MutationObserver', 'getComputedStyle']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : name === 'getComputedStyle' ? win.getComputedStyle.bind(win) : (win as any)[name] });
  }
  document.body.innerHTML = `<main role="main"><div data-testid="primaryColumn"><article data-testid="tweet" tabindex="0"><a href="/alice/status/123"><time>now</time></a><div data-testid="tweetText">Post body</div><a href="/alice">Profile</a><a href="/alice/status/123/photo/1">Photo</a><button>Like</button><a href="https://example.com">External</a></article></div></main>`;
  document.documentElement.lang = 'zh-CN';
});
afterEach(async () => { columns?.remove(); columns = undefined; await win.happyDOM.close(); });
function start() { columns = installXColumns(); columns.setEnabled(true); return columns; }
function click(selector: string, init = {}) {
  const target = document.querySelector(selector)!;
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event as unknown as Event);
  return event;
}

test('X layer overlays lift the app root above the fixed detail panel only while open', () => {
  const lift = COLUMNS_CSS.split('\n').find(line => !line.startsWith('/*') && line.includes('#layers') && line.includes('z-index'))!;
  const selector = lift.slice(0, lift.indexOf('{')).replace(':root[data-site-enhancer-columns] ', '');
  const panelZ = Number(/#site-enhancer-columns\{[^}]*z-index:(\d+)/.exec(COLUMNS_CSS)![1]);
  const toggleZ = Number(/#site-enhancer-nav-toggle\{[^}]*z-index:(\d+)/.exec(COLUMNS_CSS)![1]);
  assert.ok(Number(/z-index:(\d+)/.exec(lift)![1]) > Math.max(panelZ, toggleZ));
  // happy-dom mis-evaluates descendant combinators inside :has(), so the live match is verified in Chrome.
  assert.match(selector, /^#react-root>div:has\(>div>#layers :is\(/);
  for (const overlay of ['[role="alertdialog"]', 'dialog[open]', '[role="tooltip"]', '[data-testid="confirmationSheetDialog"]', '[data-testid="sheetDialog"]', '[data-testid="toast"]', '[role="dialog"]', '[aria-modal="true"]', '[role="menu"]', '[role="listbox"]', '[role="alert"]', '[data-testid="HoverCard"]']) assert.ok(selector.includes(overlay), overlay);
  assert.ok(!/GrokDrawer|chat-drawer/.test(selector), 'idle drawers never lift the app over the panel');
  assert.match(COLUMNS_CSS, /#layers :is\(\[data-testid="GrokDrawer"\],\[data-testid="chat-drawer-root"\],\[data-testid="DMDrawer"\]\)\{display:none!important\}/);
  assert.doesNotThrow(() => new win.CSSStyleSheet().replaceSync(COLUMNS_CSS));
});
test('divider rules reserve the hairline for dragging and use a hidden grip at rest', () => {
  const dividerRules = COLUMNS_CSS.split('\n').filter(line => line.includes('.se-column-divider') && line.includes('::before'));
  assert.equal(dividerRules.length, 1);
  assert.match(dividerRules[0], /\[data-site-enhancer-resizing\] \.se-column-divider\[data-dragging\]::before/);
  assert.match(COLUMNS_CSS, /\.se-column-divider::after\{[^}]*opacity:0/);
  start();
  const divider = document.querySelector<HTMLElement>('.se-column-divider')!;
  divider.dispatchEvent(new win.PointerEvent('pointermove', { clientY: 237 }) as unknown as Event);
  assert.equal(divider.style.getPropertyValue('--se-grip-y'), '237px');
});

test('posts have inset separators in each pane and a rounded selection tint', () => {
  for (const css of [COLUMNS_CSS, DETAIL_FRAME_CSS]) {
    assert.match(css, /cellInnerDiv[^{}]+>div\{border-bottom-color:transparent[^}]+calc\(100% - 32px\) 1px/);
  }
  const selected = COLUMNS_CSS.split('\n').find(line => line.includes('[data-site-enhancer-selected]'))!;
  assert.match(selected, /border-radius:12px/);
  assert.match(selected, /background-color:color-mix/);
  assert.doesNotMatch(selected, /box-shadow/);
});

test('empty toolbar shows title and layout, with history buttons shown together after selection', () => {
  start();
  const toolbar = document.querySelector('.se-column-toolbar')!;
  const visible = () => Array.from(toolbar.children).filter(el => !(el as HTMLElement).hidden);
  const titleAndLayout = [toolbar.querySelector('.se-column-title'), toolbar.querySelector('[aria-haspopup="dialog"]')];
  assert.deepEqual(visible(), titleAndLayout);
  const back = toolbar.querySelector<HTMLButtonElement>('[aria-label="后退"]')!;
  const forward = toolbar.querySelector<HTMLButtonElement>('[aria-label="前进"]')!;
  assert.ok(back.disabled && forward.disabled);
  selectDetail(123);
  assert.equal(visible().length, 7);
  assert.equal(back.disabled, false);
  assert.equal(forward.disabled, true);
  click('.se-column-toolbar [aria-label="关闭"]');
  assert.deepEqual(visible(), titleAndLayout);
});

test('feed scroll state follows the viewport and pending updates are cancelled on unmount', async t => {
  const remove = t.mock.method(win, 'removeEventListener');
  win.scrollTo(0, 80);
  const instance = start();
  const scrolled = () => document.documentElement.hasAttribute('data-site-enhancer-feed-scrolled');
  assert.equal(scrolled(), true);
  const paint = () => new Promise<void>(resolve => win.requestAnimationFrame(() => resolve()));
  win.scrollTo(0, 0);
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(scrolled(), true);
  await paint();
  assert.equal(scrolled(), false);
  win.scrollTo(0, 100);
  win.dispatchEvent(new win.Event('scroll'));
  await paint();
  assert.equal(scrolled(), true);
  win.dispatchEvent(new win.Event('scroll'));
  instance.setEnabled(false);
  assert.ok(remove.mock.calls.some(call => call.arguments[0] === 'scroll'));
  win.dispatchEvent(new win.Event('scroll'));
  await paint();
  assert.equal(scrolled(), false);
});

test('toolbar follows the visible detail scroll on switch and restore, releasing evicted and unmounted listeners', t => {
  const instance = start();
  const panel = document.querySelector('#site-enhancer-columns')!;
  const scrolled = () => panel.hasAttribute('data-detail-scrolled');
  const first = selectDetail(123);
  const firstView = attachReadyDetail(t, first, first.src);
  const removeFirst = t.mock.method(firstView, 'removeEventListener');
  signalDetail(firstView);
  firstView.scrollTo(0, 100);
  firstView.dispatchEvent(new firstView.Event('scroll'));
  assert.equal(scrolled(), true);
  const second = selectDetail(456);
  assert.equal(scrolled(), false, 'loading');
  const secondView = attachReadyDetail(t, second, second.src);
  const removeSecond = t.mock.method(secondView, 'removeEventListener');
  signalDetail(secondView);
  firstView.dispatchEvent(new firstView.Event('scroll'));
  assert.equal(scrolled(), false, 'parked frame');
  assert.equal(selectDetail(123), first);
  assert.equal(scrolled(), true, 'restored position');
  firstView.scrollTo(0, 0);
  firstView.dispatchEvent(new firstView.Event('scroll'));
  assert.equal(scrolled(), false);
  selectDetail(789);
  assert.ok(removeSecond.mock.calls.some(call => call.arguments[0] === 'scroll'), 'discard');
  instance.setEnabled(false);
  assert.ok(removeFirst.mock.calls.some(call => call.arguments[0] === 'scroll'), 'unmount');
});

test('width preferences reject invalid values and preserve valid explicit values', () => {
  for (const value of [null, {}, { nav: 0, share: .5 }, { nav: 200, share: Infinity }, { nav: 200, share: .01 }]) {
    assert.deepEqual(parseColumnWidths(value), DEFAULT_COLUMNS);
  }
  assert.deepEqual(parseColumnWidths({ nav: 88, share: .4 }), { ...DEFAULT_COLUMNS, nav: 88, share: .4 });
  const stored = { nav: 240, share: .52, feedGutter: .04, detailGutter: .12 };
  assert.deepEqual(parseColumnWidths(stored), stored);
  assert.deepEqual(parseColumnWidths({ ...stored, detailGutter: '.12' }), { ...stored, detailGutter: 0 });
  assert.deepEqual(parseColumnWidths({ ...stored, feedGutter: .2 }), { ...stored, feedGutter: 0 });
});
test('side padding rounds each level and preserves 360px of content on narrow panes', () => {
  for (const [width, expected] of [[888, [0, 36, 71, 107]], [401, [0, 16, 20, 20]], [360, [0, 0, 0, 0]], [320, [0, 0, 0, 0]]] as const) {
    assert.deepEqual([0, .04, .08, .12].map(level => gutterPixels(level, width)), expected);
  }
});
test('every supported viewport preserves minimum reading widths and fills available space', () => {
  for (const width of [1080, 1080.2, 1200, 1440, 1920, 2560]) {
    for (const nav of [88, 200, 280]) for (const share of [.25, .52, .75]) {
      const geometry = columnGeometry(width, { nav, share });
      assert.ok(geometry.feed >= 360);
      assert.ok(geometry.detail >= 360);
      assert.equal(geometry.nav + geometry.feed + geometry.detail, width);
    }
  }
});
test('presets split the full width remaining after navigation, subject to the reading minimums', () => {
  for (const [width, expected] of [[1280, [432, 540, 648]], [1680, [592, 740, 888]], [2560, [944, 1180, 1416]]] as const) {
    assert.deepEqual([.4, .5, .6].map(share => columnGeometry(width, { nav: 200, share }).feed), expected);
  }
  assert.deepEqual(columnGeometry(1080, { nav: 280, share: .25 }), { nav: 280, feed: 360, detail: 440 });
  assert.deepEqual(columnGeometry(1080, { nav: 280, share: .75 }), { nav: 280, feed: 440, detail: 360 });
});

test('drag snaps within 12px of rendered presets, keyboard movement stays continuous', () => {
  for (const share of [.4, .5, .6]) {
    const feed = 1480 * share;
    for (const offset of [-12, 12]) assert.equal(adjustedFeedShare(1480, feed + offset, true), share);
    for (const offset of [-13, 13]) assert.equal(adjustedFeedShare(1480, feed + offset, true), (feed + offset) / 1480);
    assert.equal(adjustedFeedShare(1480, feed + 10, false), (feed + 10) / 1480);
    assert.equal(activeWidthPreset(share + .0049)?.share, share);
    assert.equal(activeWidthPreset(share - .0051), undefined);
  }
  assert.equal(adjustedFeedShare(800, 360, true), .4);
});

test('layout dialog applies live changes, traps focus by group, and restores defaults', () => {
  localStorage.setItem(COLUMNS_WIDTH_KEY, JSON.stringify({ nav: 240, share: .52 }));
  localStorage.setItem('site-enhancer:x-nav-collapsed', 'true');
  start();
  click('time');
  const selector = '.se-column-icon[aria-haspopup="dialog"]';
  const trigger = document.querySelector<HTMLButtonElement>(selector)!;
  key(trigger, { key: 'ArrowDown' });
  const dialog = document.querySelector('.se-width-menu[role="dialog"]')!;
  const [presets, feed, detail] = [...dialog.querySelectorAll('[role="radiogroup"]')]
    .map(group => [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')]);
  const reset = dialog.querySelector<HTMLButtonElement>('.se-width-reset')!;
  const press = (value: string, shiftKey = false) => key(document.activeElement, { key: value, shiftKey });
  assert.equal(document.activeElement, presets[0]);
  assert.ok(presets.every(row => row.getAttribute('aria-checked') === 'false'));
  press('ArrowUp');
  assert.equal(document.activeElement, presets[2]);
  assert.equal(presets[2].getAttribute('aria-checked'), 'true');
  press('Tab');
  assert.equal(document.activeElement, feed[0]);
  press('ArrowLeft');
  press('Tab');
  assert.equal(document.activeElement, detail[0]);
  press('ArrowRight');
  press('Tab');
  assert.equal(document.activeElement, reset);
  press('Tab');
  assert.equal(document.activeElement, presets[2]);
  press('Tab', true);
  assert.equal(document.activeElement, reset);
  assert.deepEqual(JSON.parse(localStorage.getItem(COLUMNS_WIDTH_KEY)!), { nav: 240, share: .6, feedGutter: .12, detailGutter: .04 });
  press(' ');
  assert.equal(document.activeElement, reset);
  assert.deepEqual(JSON.parse(localStorage.getItem(COLUMNS_WIDTH_KEY)!), DEFAULT_COLUMNS);
  assert.equal(localStorage.getItem('site-enhancer:x-nav-collapsed'), 'false');
  assert.equal(feed[0].tabIndex, 0);
  const stored = { nav: 200, share: .4, feedGutter: .08, detailGutter: .12 };
  win.dispatchEvent(new win.StorageEvent('storage', { key: COLUMNS_WIDTH_KEY, newValue: JSON.stringify(stored) }));
  assert.equal(feed[2].getAttribute('aria-checked'), 'true');
  assert.equal(detail[3].tabIndex, 0);
  assert.equal(document.documentElement.style.getPropertyValue('--se-feed-gutter'), '40px');
  press('Escape');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
  assert.ok(document.querySelector('iframe'));
  key(trigger, { key: 'Enter' });
  assert.equal(document.activeElement, presets[0]);
  click(selector);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  click(selector);
  click('[data-testid="tweetText"]');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('new and cached detail documents receive the live gutter without replacing frames', t => {
  start();
  const first = selectDetail(123);
  const firstWindow = attachReadyDetail(t, first, first.src);
  signalDetail(firstWindow);
  click('.se-column-icon[aria-haspopup="dialog"]');
  const choose = (level: number) => document.querySelectorAll('.se-segments')[1].querySelectorAll('button')[level].click();
  choose(2);
  const gutter = (view: Window) => view.document.documentElement.style.getPropertyValue('--se-detail-gutter');
  assert.equal(gutter(firstWindow), '0.08');
  const second = selectDetail(456);
  const secondWindow = attachReadyDetail(t, second, second.src);
  signalDetail(secondWindow);
  assert.equal(gutter(secondWindow), '0.08');
  click('.se-column-icon[aria-haspopup="dialog"]');
  choose(3);
  assert.equal(gutter(firstWindow), '0.12');
  assert.equal(gutter(secondWindow), '0.12');
  assert.equal(first.hidden, true);
  assert.equal(document.querySelector('iframe:not([hidden])'), second);
});

test('only same-origin complete post routes are eligible for embedded details', () => {
  assert.equal(detailUrl('/alice/status/123?s=20', 'https://x.com'), 'https://x.com/alice/status/123');
  assert.equal(detailUrl('/i/web/status/123', 'https://x.com'), 'https://x.com/i/web/status/123');
  for (const href of ['/alice', '/alice/status/123/photo/1', '/alice/status/123/analytics', 'https://evil.test/alice/status/123', 'javascript:alert(1)']) {
    assert.equal(detailUrl(href, 'https://x.com'), undefined);
  }
});
test('post body and timestamp clicks open one frame without navigating or replacing the timeline', () => {
  start();
  const article = document.querySelector('article');
  assert.ok(click('[data-testid="tweetText"]').defaultPrevented);
  assert.equal(document.querySelector('iframe')?.src, 'https://x.com/alice/status/123');
  assert.equal(location.pathname, '/home');
  assert.equal(document.querySelector('article'), article);
  click('time');
  assert.equal(document.querySelectorAll('iframe').length, 1);
  assert.equal(document.querySelectorAll('#site-enhancer-columns').length, 1);
});
test('outer post body resolves its own permalink even when a quoted timestamp comes first', () => {
  start();
  document.querySelector('article')!.innerHTML = `<div data-testid="tweetText">Outer body</div><div role="link" tabindex="0"><a href="/bob/status/999"><time>quoted</time></a><div>Quoted body</div></div><a href="/alice/status/123"><time>outer</time></a>`;
  assert.equal(postPermalink(document.querySelector('article')!), 'https://x.com/alice/status/123');
  assert.ok(click('[data-testid="tweetText"]').defaultPrevented);
  assert.equal(document.querySelector('iframe')?.src, 'https://x.com/alice/status/123');
});
test('interactive controls, profiles, media and modified clicks keep native behavior', () => {
  start();
  for (const selector of ['article button', 'a[href="/alice"]', 'a[href$="/photo/1"]', 'a[href="https://example.com"]']) {
    assert.equal(click(selector).defaultPrevented, false);
  }
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(click('time', modifiers).defaultPrevented, false);
  }
  assert.equal(document.querySelector('iframe'), null);
});

function liftable(element: HTMLElement) {
  let open = false;
  element.showPopover = () => { open = true; };
  element.hidePopover = () => { open = false; };
  const matches = element.matches.bind(element);
  element.matches = (selector: string) => selector === ':popover-open' ? open : matches(selector);
}
const lifted = (element: Element) => element.matches(':popover-open');

function addVideo(doc = document) {
  const player = doc.createElement('div');
  player.dataset.testid = 'videoPlayer';
  player.innerHTML = '<div data-testid="videoComponent"><video></video><div data-video-overlay></div><div role="slider"><span data-video-progress></span></div></div>';
  doc.querySelector('article')!.append(player);
  const video = player.querySelector('video')!;
  let paused = false;
  let pauses = 0;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  video.pause = () => { paused = true; pauses++; };
  const play = () => { paused = false; video.dispatchEvent(new win.Event('play') as unknown as Event); };
  // The viewer fills the tab in place; it must never use the Fullscreen API.
  player.requestFullscreen = async () => { throw new Error('unexpected requestFullscreen'); };
  // happy-dom does not implement the top layer; track the lift for assertions.
  liftable(player);
  return { player, video, play, pauses: () => pauses };
}

test('native video overlays and progress controls never navigate to post details', () => {
  addVideo(); start();
  for (const selector of ['video', '[data-video-overlay]', '[data-video-progress]']) {
    assert.equal(click(selector).defaultPrevented, false);
  }
  assert.equal(document.querySelector('iframe'), null);
});

test('opening details pauses feed videos and blocks later autoplay until details close', async () => {
  const { video, play, pauses } = addVideo();
  start();
  assert.equal(video.paused, false);
  selectDetail(123);
  assert.equal(video.paused, true);
  assert.equal(pauses(), 1);
  play();
  assert.equal(video.paused, true);
  const later = addVideo(); later.play();
  assert.equal(later.video.paused, true);
  const insertedWhilePlaying = addVideo();
  assert.equal(insertedWhilePlaying.video.paused, false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(insertedWhilePlaying.video.paused, true);
  const frame = document.querySelector('iframe')!;
  assert.equal(frame.allowFullscreen, true);
  assert.match(frame.allow, /picture-in-picture/);
  click('.se-column-toolbar button[aria-label="关闭"]');
  assert.equal(video.paused, true, 'closing details must not resume playback automatically');
  play(); assert.equal(video.paused, false);
  selectDetail(456);
  columns!.setEnabled(false);
  play(); assert.equal(video.paused, false, 'disabling columns removes the autoplay guard');
});

test('a feed video the user plays over details is not paused back, avoiding a play/pause loop', t => {
  const feed = addVideo(); start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const other = addVideo(detail.document as unknown as Document);
  signalDetail(detail);
  other.play();
  const autoplay = addVideo(); autoplay.play();
  assert.equal(autoplay.video.paused, true, 'autoplay stays blocked');
  feed.player.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }) as unknown as Event);
  const pauses = feed.pauses();
  // X re-calls play() after an external pause; each call must now be left alone.
  for (let i = 0; i < 3; i++) feed.play();
  assert.equal(feed.video.paused, false);
  assert.equal(feed.pauses(), pauses);
  assert.equal(other.video.paused, true, 'only one video stays audible');
  autoplay.play(); assert.equal(autoplay.video.paused, true);
  selectDetail(456);
  assert.equal(feed.video.paused, true, 'opening another post pauses the feed again');
  feed.play(); assert.equal(feed.video.paused, true);
});

test('blocked feed autoplay is refused at play() so X cannot loop play/pause', async t => {
  // Stand in for the browser's play(): start the helper's playback for that video.
  const proto = win.HTMLMediaElement.prototype as unknown as { play: (this: HTMLMediaElement & { start?: () => void }) => Promise<void> };
  proto.play = function () { this.start?.(); return Promise.resolve(); };
  installVideoPlayGate(win as unknown as Parameters<typeof installVideoPlayGate>[0]);
  t.after(() => (win as unknown as { __seVideoGateCleanup?: () => void }).__seVideoGateCleanup?.());
  const gated = () => { const entry = addVideo(); Object.assign(entry.video, { start: entry.play }); return entry; };
  const autoplay = gated(); start();
  await autoplay.video.play();
  assert.equal(autoplay.video.paused, false, 'autoplay is untouched without details');
  selectDetail(123);
  const pauses = autoplay.pauses();
  // X's autoplay controller keeps asking; each request is refused before playback starts.
  for (let i = 0; i < 3; i++) {
    await assert.rejects(autoplay.video.play(), (error: DOMException) => error.name === 'AbortError');
  }
  assert.equal(autoplay.video.paused, true);
  assert.equal(autoplay.pauses(), pauses, 'no pause fights the refused requests');
  const chosen = gated();
  chosen.player.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }) as unknown as Event);
  await chosen.video.play();
  assert.equal(chosen.video.paused, false, 'a video the user starts still plays');
  click('.se-column-toolbar button[aria-label="关闭"]');
  await assert.rejects(autoplay.video.play(), 'autoplay never interrupts a video the user started');
  chosen.video.pause();
  await autoplay.video.play();
  assert.equal(autoplay.video.paused, false, 'closing details lifts the gate');
});

test('video expansion keeps the original node and source, then restores focus and page interaction', async () => {
  const { player, video } = addVideo();
  video.src = 'blob:https://x.com/existing-stream';
  video.currentTime = 42;
  start();
  const button = player.querySelector<HTMLButtonElement>('button')!;
  const parent = player.parentElement;
  button.focus();
  click('[data-site-enhancer-video-expand]');
  assert.equal(player.parentElement, parent);
  assert.equal(player.querySelector('video'), video);
  assert.equal(video.currentTime, 42);
  assert.equal(video.src, 'blob:https://x.com/existing-stream');
  assert.equal(video.paused, false);
  await Promise.resolve();
  assert.equal(document.fullscreenElement ?? null, null);
  assert.equal(lifted(player), true);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  viewerKey('Escape');
  assert.equal(lifted(player), false);
  assert.equal(player.hasAttribute('popover'), false);
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), false);
  assert.equal(document.querySelector<HTMLElement>('#site-enhancer-columns')!.inert, false);
  assert.equal(document.activeElement, button);
  click('[data-site-enhancer-video-expand]');
  columns!.setEnabled(false);
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), false);
  assert.equal(player.querySelector('button'), null);
});

test('Readomi captions stack above the lifted player and are released on close', async () => {
  const { player } = addVideo();
  const early = document.createElement('div');
  early.setAttribute('data-readomi-subtitles', '');
  liftable(early);
  document.documentElement.append(early);
  start();
  click('[data-site-enhancer-video-expand]');
  await Promise.resolve();
  assert.equal(lifted(player), true);
  assert.equal(lifted(early), true);
  // Readomi can mount its caption layer after playback starts.
  const late = document.createElement('div');
  late.setAttribute('data-readomi-subtitles', '');
  liftable(late);
  document.documentElement.append(late);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(lifted(late), true);
  assert.ok(document.getElementById('site-enhancer-media-top-style'));
  viewerKey('Escape');
  for (const caption of [early, late]) {
    assert.equal(lifted(caption), false);
    assert.equal(caption.hasAttribute('popover'), false);
    assert.equal(caption.parentElement, document.documentElement);
  }
  early.remove(); late.remove();
});

test('mixed viewer switches between the lifted player and the image dialog in place', async () => {
  const { player, video } = addVideo();
  player.insertAdjacentHTML('beforebegin', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/one"></div>');
  player.insertAdjacentHTML('afterend', '<div role="link"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quote"></div></div>');
  start(); click('[data-site-enhancer-video-expand]');
  await Promise.resolve();
  assert.equal(player.querySelector('.se-image-count')?.textContent, '2 / 2');
  assert.ok(player.querySelector('.se-image-count svg'));
  assert.equal(lifted(player), true);
  const header = player.querySelector('header')!;
  const dialog = document.querySelector('dialog')!;
  viewerKey('Home'); await Promise.resolve();
  assert.equal(lifted(player), false);
  assert.equal(dialog.open, true);
  assert.equal(video.paused, true);
  assert.equal(document.querySelector('dialog header'), header);
  assert.equal(header.querySelector('.se-image-count')?.textContent, '1 / 2');
  viewerKey('ArrowDown'); await Promise.resolve();
  assert.equal(lifted(player), true);
  assert.equal(dialog.open, false);
  assert.equal(player.querySelector('header'),header);
  viewerKey('Escape'); await Promise.resolve();
  assert.equal(lifted(player), false);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.fullscreenElement ?? null, null);
});

test('speed popover, wheel, keyboard presets and replacement video share the remembered rate', async () => {
  const { player, video } = addVideo();
  localStorage.setItem('site-enhancer:x-video-rate','1.5');
  start();
  const pill = player.querySelector<HTMLButtonElement>('[data-site-enhancer-video-speed]')!;
  assert.equal(video.playbackRate,1.5);
  player.getBoundingClientRect = () => new win.DOMRect(0,0,320,180);
  assert.ok(pill.querySelector('svg'));
  pill.click();
  const panel = player.querySelector<HTMLElement>('[data-site-enhancer-video-popover]')!;
  assert.equal(panel.style.width,'232px');
  assert.deepEqual([...panel.querySelectorAll('button[role=radio]')].map(el => el.textContent),['0.5','0.75','1','1.25','1.5','1.75','2','3']);
  assert.equal(getComputedStyle(panel.querySelector('[role=radiogroup]')!).display,'grid');
  assert.equal(getComputedStyle(panel).bottom,'');
  assert.equal(player.querySelector('[aria-checked=true]')?.textContent,'1.5');
  const key = (value: string) => document.activeElement!.dispatchEvent(new win.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}) as unknown as Event);
  key('ArrowRight'); key('Enter');
  assert.equal(video.playbackRate,1.75);
  assert.equal(pill.getAttribute('aria-expanded'),'false');
  pill.dispatchEvent(new win.WheelEvent('wheel',{deltaY:-20,bubbles:true,cancelable:true}) as unknown as Event);
  assert.equal(localStorage.getItem('site-enhancer:x-video-rate'),'2');
  assert.equal(player.querySelector('[data-site-enhancer-video-hud]')?.textContent,'2×');
  const replacement = document.createElement('video');
  video.replaceWith(replacement);
  replacement.dispatchEvent(new win.Event('play') as unknown as Event);
  assert.equal(replacement.playbackRate,2);
  click('[data-site-enhancer-video-expand]'); await Promise.resolve();
  pill.click();
  assert.ok(pill.closest('.se-video-bar'));
  assert.equal(getComputedStyle(panel).top,'auto');
  key('Escape');
  assert.ok(player.hasAttribute('data-site-enhancer-video-expanded'));
  assert.equal(pill.getAttribute('aria-expanded'),'false');
});

test('viewer sliders capture a drag, own navigation keys and share the chosen volume', async () => {
  const {player,video} = addVideo();
  player.insertAdjacentHTML('beforebegin','<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/one"></div>');
  Object.defineProperty(video,'duration',{value:80});
  Object.defineProperty(video,'buffered',{value:{length:2,start:(i: number) => i * 40,end:(i: number) => i * 40 + 20}});
  start(); click('[data-site-enhancer-video-expand]'); await Promise.resolve();
  const [seek,volume] = player.querySelectorAll<HTMLElement>('.se-video-bar [role=slider]');
  for (const slider of [seek,volume]) {
    slider.getBoundingClientRect = () => new win.DOMRect(20,0,100,24);
    let captured = -1;
    slider.setPointerCapture = id => { captured = id; };
    for (const [type,x] of [['pointerdown',45],['pointermove',95],['pointerup',95]] as const) {
      slider.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerId:4,clientX:x}) as unknown as Event);
      assert.equal(captured,4);
      assert.equal(Number(slider.getAttribute('aria-valuenow')), (x - 20) * (slider === seek ? .8 : 1));
    }
  }
  assert.deepEqual(JSON.parse(localStorage.getItem('site-enhancer:x-video-volume')!),{volume:.75,muted:false});
  assert.equal(seek.getAttribute('aria-valuetext'),'1:00 / 1:20');
  assert.equal(seek.querySelectorAll('i').length,2);
  assert.equal(seek.querySelectorAll('i')[1].style.left,'50%');
  const key = (slider: HTMLElement,k: string) => slider.dispatchEvent(new win.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}) as unknown as Event);
  for (const [k,expected] of [['ArrowLeft',55],['ArrowRight',60],['End',80],['Home',0]] as const) {
    key(seek,k); assert.equal(video.currentTime,expected);
  }
  for (const [k,expected] of [['ArrowLeft',70],['ArrowRight',75],['Home',0],['End',100]] as const) {
    key(volume,k); assert.equal(volume.getAttribute('aria-valuenow'),String(expected));
    assert.equal(video.muted,expected === 0);
  }
  assert.equal(lifted(player), true);
});

test('surface and PiP buttons operate on the original video and release the PiP override', async () => {
  const {player,video,play} = addVideo();
  video.play = async () => { play(); };
  Object.defineProperty(document,'pictureInPictureEnabled',{value:true});
  video.setAttribute('disablepictureinpicture','');
  let requested: HTMLVideoElement | undefined;
  video.requestPictureInPicture = async function () {
    requested = this;
    return {} as PictureInPictureWindow;
  };
  start(); click('[data-site-enhancer-video-expand]'); await Promise.resolve();
  click('video');
  assert.ok(video.paused);
  click('.se-video-row > button');
  assert.equal(video.paused,false);
  assert.equal(video.hasAttribute('disablepictureinpicture'),false);
  click('.se-video-row button[aria-label="画中画"]');
  assert.equal(requested,video);
  viewerKey('Escape');
  assert.ok(video.hasAttribute('disablepictureinpicture'));
});

test('GIF controls omit sound, speed, clock and PiP, including after a player refresh', async () => {
  const {player,video} = addVideo();
  player.querySelector('[role=slider]')!.remove(); video.loop = true;
  Object.defineProperty(document,'pictureInPictureEnabled',{value:true});
  start(); click('[data-site-enhancer-video-expand]');
  player.append(video); await new Promise(resolve => setTimeout(resolve,5));
  const bar = player.querySelector('.se-video-bar')!;
  assert.equal(bar.querySelectorAll('button').length,1);
  assert.equal(bar.querySelectorAll('[role=slider]').length,1);
  assert.equal(bar.querySelector('.se-speed,.se-volume,.se-video-row span'),null);
});

test('expanded player hides only native controls and restores them on exit', async () => {
  const {player,video} = addVideo();
  const component = player.querySelector('[data-testid=videoComponent]')!;
  const native = document.createElement('div');
  native.innerHTML = '<div data-testid="scrubber"><div role="slider"></div></div><div><button></button></div>';
  component.append(native);
  const caption = document.createElement('div'); caption.dataset.readomiSubtitles = ''; component.append(caption);
  start(); click('[data-site-enhancer-video-expand]'); await Promise.resolve();
  assert.ok(native.hasAttribute('data-se-native-controls'));
  assert.equal(video.closest('[data-se-native-controls]'),null);
  assert.equal(caption.closest('[data-se-native-controls]'),null);
  const replacement = native.cloneNode(true) as HTMLElement;
  replacement.removeAttribute('data-se-native-controls');
  native.replaceWith(replacement); await new Promise(resolve => setTimeout(resolve,5));
  assert.ok(replacement.hasAttribute('data-se-native-controls'));
  viewerKey('Escape');
  assert.equal(player.querySelector('[data-se-native-controls]'),null);
});

test('playing viewer chrome idles only away from hovered or focused controls and open popovers', async t => {
  const {player,video} = addVideo();
  let expire = () => {};
  const timeout = win.setTimeout.bind(win);
  t.mock.method(win,'setTimeout',(fn: () => void, ms: number) => {
    if (ms === 2500) { expire = fn; return 0; }
    return timeout(fn,ms);
  });
  start(); click('[data-site-enhancer-video-expand]'); await Promise.resolve();
  const idle = () => player.hasAttribute('data-se-idle');
  const bar = player.querySelector<HTMLElement>('.se-video-bar')!;
  const pill = bar.querySelector<HTMLButtonElement>('[data-site-enhancer-video-speed]')!;
  expire(); assert.ok(idle());
  bar.dispatchEvent(new win.PointerEvent('pointermove',{bubbles:true}) as unknown as Event);
  expire(); assert.equal(idle(),false);
  video.dispatchEvent(new win.PointerEvent('pointermove',{bubbles:true}) as unknown as Event);
  pill.focus(); expire(); assert.equal(idle(),false);
  pill.click(); (document.activeElement as HTMLElement).blur(); expire(); assert.equal(idle(),false);
  pill.click(); expire(); assert.ok(idle());
  viewerKey('j'); assert.equal(idle(),false);
  video.pause(); video.dispatchEvent(new win.Event('pause') as unknown as Event); expire();
  assert.equal(idle(),false);
});

test('native video destinations respect mixed media order, quoted posts and explicit video links', () => {
  const article = document.querySelector('article')!;
  article.insertAdjacentHTML('beforeend', `<a href="/alice/status/123/photo/1"><img></a><video></video>
    <div role="link" data-href="/bob/status/789"><video></video></div>
    <a href="/alice/status/123/video/3"><video></video></a>`);
  const [second, quoted, linked] = article.querySelectorAll('video');
  assert.equal(nativeVideoUrl(second), 'https://x.com/alice/status/123/video/2');
  assert.equal(nativeVideoUrl(quoted), 'https://x.com/bob/status/789');
  assert.equal(nativeVideoUrl(linked), 'https://x.com/alice/status/123/video/3');
});

test('a player without popover support still expands in place and can be reopened', async () => {
  const { player } = addVideo();
  (player as { showPopover?: unknown }).showPopover = undefined;
  start();
  click('[data-site-enhancer-video-expand]');
  await Promise.resolve();
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), true);
  assert.equal(player.hasAttribute('popover'), false);
  assert.ok(player.querySelector('.se-video-chrome'));
  viewerKey('Escape');
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), false);
  click('[data-site-enhancer-video-expand]');
  await Promise.resolve();
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), true);
});

test('detail full screen covers the tab in place, keeps the live player and selection, and cached hidden details cannot autoplay', async t => {
  start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  Object.defineProperty(detail, 'frameElement', { configurable: true, value: frame });
  liftable(frame);
  const doc = detail.document as unknown as Document;
  const { player, video, play } = addVideo(doc);
  signalDetail(detail);
  const navigate = t.mock.method(window.location, 'assign', () => {});
  video.src = 'blob:https://x.com/detail-stream';
  video.currentTime = 37;
  const button = player.querySelector<HTMLButtonElement>('[data-site-enhancer-video-expand]')!;
  assert.equal(button.title, '全屏观看');
  button.click();
  await Promise.resolve();
  assert.equal(lifted(player), true);
  assert.equal(frame.hasAttribute('data-site-enhancer-media-frame'), true);
  assert.equal(lifted(frame), true);
  assert.equal(player.querySelector('video'), video);
  assert.equal(video.currentTime, 37);
  assert.equal(video.src, 'blob:https://x.com/detail-stream');
  doc.querySelector('dialog')!.dispatchEvent(new detail.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }) as unknown as Event);
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), false);
  assert.equal(frame.hasAttribute('data-site-enhancer-media-frame'), false);
  assert.equal(frame.hasAttribute('popover'), false);
  assert.equal(lifted(frame), false);
  assert.equal(detail.document.activeElement, button);
  assert.equal(document.querySelector('iframe:not([hidden])'), frame);
  assert.equal(navigate.mock.callCount(), 0);
  selectDetail(456);
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), false);
  assert.equal(video.paused, true);
  play(); assert.equal(video.paused, true);
  selectDetail(123);
  play(); assert.equal(video.paused, false);
});

test('browsing a detail photo to its video stays in the gallery', async t => {
  start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const doc = detail.document as unknown as Document;
  const { player, video } = addVideo(doc);
  player.insertAdjacentHTML('beforebegin', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/mixed"></div>');
  signalDetail(detail);
  const navigate = t.mock.method(window.location, 'assign', () => {});
  detail.document.querySelector('img')!.click();
  const gallery = detail.document.querySelector('dialog')!;
  assert.equal(gallery.querySelector('.se-image-count')?.textContent, '1 / 2');
  gallery.querySelector('button[data-direction=next]')!.dispatchEvent(new detail.MouseEvent('click', { bubbles: true }));
  await Promise.resolve();
  assert.equal(lifted(player), true);
  assert.equal(player.querySelector('video'), video);
  assert.equal(player.querySelector('.se-image-count')?.textContent, '2 / 2');
  assert.equal(navigate.mock.callCount(), 0);
  assert.equal(document.querySelector('iframe:not([hidden])'), frame);
});

test('subtitle action opens a new tab without navigating and restores only the addressed attachment', async t => {
  document.documentElement.lang = 'en';
  start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const { player, video } = addVideo(detail.document as unknown as Document);
  player.insertAdjacentHTML('beforebegin', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/first"></div>');
  signalDetail(detail);
  const navigate = t.mock.method(window.location, 'assign', () => {});
  const opened = t.mock.method(window, 'open', () => null);
  video.currentTime = 41.5;
  player.querySelector<HTMLButtonElement>('[aria-label="Full screen"]')!.click();
  const subtitle = player.querySelector<HTMLButtonElement>('.se-subtitle-post')!;
  assert.equal(subtitle.textContent, 'Open in new tab (for subtitles)');
  void video.play();
  subtitle.click();
  const destination = 'https://x.com/alice/status/123/video/2';
  assert.deepEqual(opened.mock.calls.map(call => call.arguments), [[destination, '_blank', 'noopener']]);
  assert.equal(navigate.mock.callCount(), 0);
  assert.equal(video.paused, true);
  assert.equal(win.localStorage.length, 1);

  columns!.remove();
  columns = undefined;
  win.happyDOM.setURL(destination);
  const other = addVideo().video;
  Object.defineProperty(other, 'readyState', { value: 1 });
  const matching = addVideo().video;
  start();
  assert.equal(other.currentTime, 0);
  assert.equal(matching.currentTime, 0);
  Object.defineProperty(matching, 'readyState', { value: 1 });
  matching.dispatchEvent(new win.Event('loadedmetadata') as unknown as Event);
  assert.equal(matching.currentTime, 41.5);
  assert.equal(other.currentTime, 0);
  assert.equal(win.localStorage.length, 0);
  matching.currentTime = 5;
  matching.dispatchEvent(new win.Event('loadedmetadata') as unknown as Event);
  assert.equal(matching.currentTime, 5);
});

test('an explicitly expanded feed video can play alone and pauses again when collapsed over details', async t => {
  const feed = addVideo(); start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const other = addVideo(detail.document as unknown as Document);
  signalDetail(detail);
  click('[data-site-enhancer-video-expand]');
  await Promise.resolve();
  assert.equal(other.video.paused, true);
  feed.play(); assert.equal(feed.video.paused, false);
  other.play(); assert.equal(other.video.paused, true);
  click('[data-site-enhancer-video-expand]');
  assert.equal(feed.video.paused, true);
  other.play(); assert.equal(other.video.paused, false);
});

test('removing a virtualized expanded player releases background interaction', async () => {
  const { player } = addVideo(); start();
  click('[data-site-enhancer-video-expand]');
  player.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), false);
  assert.equal(document.querySelector<HTMLElement>('#site-enhancer-columns')!.inert, false);
  assert.equal(document.querySelector('[data-site-enhancer-video-expand]'), null);
});

test('timeline mutations update changed video players without rescanning existing ones', async t => {
  const existing = addVideo();
  start();
  const documentQueries = t.mock.method(document, 'querySelectorAll');
  const existingQueries = t.mock.method(existing.player, 'querySelector');
  existing.player.querySelector('[data-video-progress]')!.replaceChildren(document.createElement('span'));
  const added = addVideo();
  await new Promise(resolve => setTimeout(resolve, 0));
  const button = added.player.querySelector('[data-site-enhancer-video-expand]')!;
  assert.ok(button);
  assert.equal(existingQueries.mock.calls.filter(call => call.arguments[0] === 'video').length, 0);
  assert.equal(documentQueries.mock.calls.filter(call => String(call.arguments[0]).includes('video')).length, 0);

  button.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(added.player.querySelector('[data-site-enhancer-video-expand]'), button);
  const media = added.video.parentElement!;
  media.remove();
  media.replaceChildren();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(added.player.querySelector('[data-site-enhancer-video-expand]'), null);
});

test('video controls follow test IDs assigned after the video mounts', async () => {
  const primary = document.querySelector('[data-testid="primaryColumn"]')!;
  const { player } = addVideo();
  player.removeAttribute('data-testid');
  start();
  const button = () => player.querySelector('[data-site-enhancer-video-expand]');
  assert.equal(button(), null);

  player.dataset.testid = 'videoPlayer';
  player.append(document.createElement('span'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(button());

  player.removeAttribute('data-testid');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(button(), null);

  primary.removeAttribute('data-testid');
  player.dataset.testid = 'videoPlayer';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(button(), null);
  primary.setAttribute('data-testid', 'primaryColumn');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(button());
  primary.removeAttribute('data-testid');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(button(), null);
});

test('keyboard resizing persists preferences, reset restores defaults, and disable removes listeners/UI', () => {
  const controller = start();
  const divider = document.querySelector('.se-column-divider')!;
  divider.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }) as unknown as Event);
  assert.equal(JSON.parse(localStorage.getItem(COLUMNS_WIDTH_KEY)!).nav, 190);
  assert.equal(document.documentElement.style.getPropertyValue('--se-nav'), '190px');
  divider.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }) as unknown as Event);
  assert.equal(JSON.parse(localStorage.getItem(COLUMNS_WIDTH_KEY)!).nav, 200);
  click('time');
  controller.setEnabled(false);
  assert.equal(document.querySelector('#site-enhancer-columns'), null);
  assert.equal(document.querySelector('.se-column-divider'), null);
  assert.equal(document.documentElement.hasAttribute('data-site-enhancer-columns'), false);
  assert.equal(click('time').defaultPrevented, false);
  controller.remove();
  assert.equal(document.querySelector('#site-enhancer-columns-style'), null);
});
test('narrow windows retain native navigation, and widening restores the panel with saved widths', () => {
  const controller = start();
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: 900 });
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(document.querySelector('#site-enhancer-columns'), null);
  assert.equal(click('time').defaultPrevented, false);
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: 1440 });
  win.dispatchEvent(new win.Event('resize'));
  click('time');
  win.history.pushState({}, '', '/explore');
  controller.onNavigate();
  assert.equal(document.querySelector('iframe'), null);
  assert.match(document.querySelector('#site-enhancer-columns')!.textContent!, /选择一条推文/);
});

test('dialog routes such as quote and compose keep the open detail frame', () => {
  const controller = start();
  click('time');
  const frame = document.querySelector('iframe');
  assert.ok(frame);
  win.history.pushState({}, '', '/compose/post');
  controller.onNavigate();
  assert.equal(document.querySelector('iframe'), frame);
  win.history.back();
  win.history.pushState({}, '', '/alice/status/123/likes');
  document.body.insertAdjacentHTML('beforeend', '<div id="layers"><div role="dialog" aria-modal="true"></div></div>');
  controller.onNavigate();
  assert.equal(document.querySelector('iframe'), frame);
  document.getElementById('layers')!.remove();
  win.history.pushState({}, '', '/explore');
  controller.onNavigate();
  assert.equal(document.querySelector('iframe'), null);
});

test('failed frame loading exposes retry, and closing prevents late work from recreating the frame', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const controller = start();
  click('time');
  const originalFrame = document.querySelector('iframe');
  t.mock.timers.tick(20500);
  assert.equal(document.querySelector('iframe'), null);
  assert.match(document.querySelector('[role="status"]')!.textContent!, /详情暂时无法加载/);
  const retry = Array.from(document.querySelectorAll('#site-enhancer-columns button')).find(button => button.textContent === '重试') as HTMLElement;
  assert.equal(retry.hidden, false);
  retry.click();
  assert.ok(document.querySelector('iframe'));
  assert.notEqual(document.querySelector('iframe'), originalFrame);
  win.history.pushState({}, '', '/explore');
  controller.onNavigate();
  t.mock.timers.tick(30000);
  assert.equal(document.querySelector('iframe'), null);
  assert.match(document.querySelector('[role="status"]')!.textContent!, /选择一条推文/);
});

test('late preparation cannot revive a closed detail or replace a newer selection', async () => {
  const requests: Array<(url: string) => void> = [];
  let releases = 0;
  columns = installXColumns({
    prepareDetail: () => new Promise(resolve => requests.push(resolve)),
    releaseDetail: () => { releases++; },
  });
  columns.setEnabled(true);
  click('time');
  const first = document.querySelector('iframe')!;
  document.querySelector<HTMLAnchorElement>('a:has(time)')!.href = '/alice/status/456';
  click('time');
  const second = document.querySelector('iframe')!;
  requests[0]('https://x.com/alice/status/123?old=1');
  await Promise.resolve();
  assert.equal(first.getAttribute('src'), null);
  assert.equal(second.getAttribute('src'), null);
  win.history.pushState({}, '', '/explore');
  columns.onNavigate();
  requests[1]('https://x.com/alice/status/123?new=1');
  await Promise.resolve();
  assert.equal(second.getAttribute('src'), null);
  assert.equal(document.querySelector('iframe'), null);
  assert.equal(releases, 1);
});

test('detail toolbar follows the measured native header and releases its alignment marker', () => {
  const primary = document.querySelector('[data-testid="primaryColumn"]')!;
  const header = document.createElement('div');
  header.style.borderBottom = '1px solid rgb(239, 243, 244)';
  header.innerHTML = '<nav><div role="tablist"></div></nav>';
  primary.prepend(header);
  let height = 54;
  header.getBoundingClientRect = () => ({ top: 0, height } as DOMRect);
  const controller = start();
  assert.equal(document.documentElement.style.getPropertyValue('--se-column-header-height'), '54px');
  assert.equal(header.hasAttribute('data-site-enhancer-column-header'), true);
  height = 64;
  controller.onNavigate();
  assert.equal(document.documentElement.style.getPropertyValue('--se-column-header-height'), '64px');
  controller.setEnabled(false);
  assert.equal(header.hasAttribute('data-site-enhancer-column-header'), false);
  assert.equal(document.documentElement.style.getPropertyValue('--se-column-header-height'), '');
});

test('loading and updating the timeline does not rediscover the header until it appears', async t => {
  const primary = document.querySelector('[data-testid="primaryColumn"]')!;
  const querySelector = document.querySelector.bind(document);
  const search = t.mock.method(document, 'querySelector', querySelector);
  start();
  await win.happyDOM.waitUntilComplete();
  const headerSearches = () => search.mock.calls.filter(call => call.arguments[0] === PRIMARY).length;
  const initialSearches = headerSearches();

  for (let i = 0; i < 3; i++) {
    primary.insertAdjacentHTML('beforeend', '<div data-testid="cellInnerDiv"><article data-testid="tweet">New post</article></div>');
    document.body.append(document.createElement('div'));
    await win.happyDOM.waitUntilComplete();
  }
  assert.equal(headerSearches(), initialSearches);

  const header = document.createElement('div');
  header.style.borderBottom = '1px solid black';
  let height = 0;
  header.getBoundingClientRect = () => ({ top: 0, height } as DOMRect);
  const tabs = header.appendChild(document.createElement('div'));
  primary.prepend(header);
  await win.happyDOM.waitUntilComplete();
  tabs.setAttribute('role', 'tablist');
  await win.happyDOM.waitUntilComplete();
  assert.equal(headerSearches(), initialSearches + 1);
  assert.equal(document.documentElement.style.getPropertyValue('--se-column-header-height'), '54px');

  height = 72;
  header.append(document.createElement('button'));
  await win.happyDOM.waitUntilComplete();
  assert.equal(headerSearches(), initialSearches + 2);
  assert.equal(document.documentElement.style.getPropertyValue('--se-column-header-height'), '72px');

  header.remove();
  await win.happyDOM.waitUntilComplete();
  assert.equal(document.documentElement.style.getPropertyValue('--se-column-header-height'), '54px');
});


test('quote destinations are read from their own link component and normalized safely', () => {
  const card = document.createElement('div');
  (card as any).__reactFiber$test = { return: { memoizedProps: { link: { pathname: 'https://twitter.com/quoted/status/456' } } } };
  assert.equal(quoteComponentPath(card), 'https://twitter.com/quoted/status/456');
  assert.equal(normalizeQuoteUrl(quoteComponentPath(card)!, location.origin), 'https://x.com/quoted/status/456');
  for (const url of ['https://evil.test/quoted/status/456', 'javascript:alert(1)', '/quoted/status/456/photo/1']) {
    assert.equal(normalizeQuoteUrl(url, location.origin), undefined);
  }
  (card as any).__reactFiber$test = { return: { stateNode: document.createElement('div'), memoizedProps: { link: { pathname: '/outer/status/123' } } } };
  assert.equal(quoteComponentPath(card), undefined);
});

test('timeline quote clicks open the quote and unavailable cards retain native behavior', () => {
  start();
  document.querySelector('article')!.insertAdjacentHTML('beforeend', '<div role="link" id="quote"><div data-testid="tweetText">Quote</div></div>');
  const card = document.querySelector('#quote')!;
  assert.equal(click('#quote').defaultPrevented, false);
  assert.equal(document.querySelector('iframe'), null);
  card.addEventListener(QUOTE_REQUEST, () => card.setAttribute(QUOTE_URL, '/quoted/status/456'));
  assert.equal(click('#quote [data-testid="tweetText"]').defaultPrevented, true);
  assert.equal(document.querySelector('iframe')?.src, 'https://x.com/quoted/status/456');
  assert.equal(card.hasAttribute(QUOTE_URL), false);
  assert.equal(location.pathname, '/home');
});

test('quotes inside the detail document replace details instead of reopening their parent', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  start();
  click('time');
  const frame = document.querySelector('iframe:not([hidden])')!;
  const detailWindow = new Window({ url: 'https://x.com/alice/status/123' });
  t.after(() => detailWindow.happyDOM.close());
  const doc = detailWindow.document;
  Object.defineProperty(frame, 'contentDocument', { value: doc });
  doc.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><a href="https://x.com/alice/status/123"><time>Now</time></a><div role="link" id="quote">Quoted post</div></article></div>';
  const card = doc.querySelector('#quote')!;
  card.addEventListener(QUOTE_REQUEST, () => card.setAttribute(QUOTE_URL, '/quoted/status/456'));
  t.mock.timers.tick(250);
  card.dispatchEvent(new detailWindow.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(document.querySelector<HTMLIFrameElement>('iframe:not([hidden])')?.src, 'https://x.com/quoted/status/456');
  assert.notEqual(document.querySelector('iframe:not([hidden])'), frame);
  assert.equal(location.pathname, '/home');
});

test('follows the X page language and uses English outside Chinese', () => {
  document.documentElement.lang = 'en';
  start();
  const panel = document.querySelector('#site-enhancer-columns')!;
  assert.match(panel.textContent!, /Select a post/);
  assert.doesNotMatch(panel.textContent!, /[\u3400-\u9fff]/);
  assert.equal(panel.getAttribute('aria-label'), 'Post details');
  const labels = Array.from(document.querySelectorAll('#site-enhancer-columns :is(button, a)'), element => element.getAttribute('aria-label') ?? element.textContent);
  assert.ok(labels.includes('Close') && labels.includes('Back') && labels.includes('New tab'), labels.join(','));
});

test('re-labels the panel when X sets its language after start', async () => {
  document.documentElement.lang = '';
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'en-US' } });
  try { start(); } finally { Object.defineProperty(globalThis, 'navigator', original); }
  const panel = document.querySelector('#site-enhancer-columns')!;
  assert.match(panel.textContent!, /Select a post/);
  document.documentElement.lang = 'zh-CN';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(panel.textContent!, /选择一条推文/);
  assert.equal(panel.getAttribute('aria-label'), '推文详情');
  assert.ok(document.querySelector('#site-enhancer-columns [aria-label="关闭"]'));
  assert.equal(document.querySelector('.se-column-divider')!.getAttribute('aria-label'), '调整导航栏宽度');
});

test('sidebar collapse preserves expanded width and survives remount', () => {
  localStorage.setItem(COLUMNS_WIDTH_KEY, JSON.stringify({ nav: 240, share: .5 }));
  start();
  click('#site-enhancer-nav-toggle');
  assert.equal(document.documentElement.style.getPropertyValue('--se-nav'), '88px');
  assert.equal(document.querySelector('#site-enhancer-nav-toggle')?.getAttribute('aria-expanded'), 'false');
  columns!.setEnabled(false);
  assert.equal(document.querySelector('#site-enhancer-nav-toggle'), null);
  columns!.setEnabled(true);
  assert.equal(document.documentElement.style.getPropertyValue('--se-nav'), '88px');
  click('#site-enhancer-nav-toggle');
  assert.equal(document.documentElement.style.getPropertyValue('--se-nav'), '240px');
});

test('timeline images use a separate gallery without changing the detail selection', () => {
  document.querySelector('article')!.insertAdjacentHTML('beforeend', `<a href="/alice/status/123/photo/1"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/first?format=jpg&name=small" alt="First"></div></a><a href="/alice/status/123/photo/2"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/second?format=jpg&name=small" alt="Second"></div></a>`);
  start();
  click('[data-testid="tweetText"]');
  const frame = document.querySelector('iframe');
  assert.equal(click('img', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(click('img').defaultPrevented, true);
  const viewer = document.querySelector('dialog')!;
  assert.equal(viewer.querySelector('img')?.alt, 'First');
  assert.ok(viewer.querySelector('img')?.src.includes('name=orig'));
  viewer.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }) as unknown as Event);
  assert.equal(viewer.querySelector('img')?.alt, 'Second');
  assert.equal(document.querySelector('iframe'), frame);
  viewer.dispatchEvent(new win.Event('cancel', { cancelable: true }) as unknown as Event);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.querySelector('iframe'), frame);
  click('img');
  columns!.setEnabled(false);
  assert.equal(document.querySelector('dialog'), null);
});

test('detail-frame photos open in the same top-level viewer', async t => {
  start();
  click('[data-testid="tweetText"]');
  const frame = document.querySelector('iframe')!;
  const detailWindow = new Window({ url: 'https://x.com/alice/status/123' });
  t.after(() => detailWindow.happyDOM.close());
  const doc = detailWindow.document;
  Object.defineProperty(frame, 'contentDocument', { value: doc });
  doc.body.innerHTML = `<main><div data-testid="primaryColumn"><article data-testid="tweet"><a href="/alice/status/123/photo/1"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/detail?format=jpg" alt="Detail photo"></div></a></article></div></main>`;
  await new Promise(resolve => setTimeout(resolve, 300));
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  doc.querySelector('img')!.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(document.querySelector('dialog img')?.getAttribute('alt'), 'Detail photo');
  assert.equal(doc.querySelector('dialog'), null);
  doc.dispatchEvent(new detailWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.querySelector('iframe'), frame);
});


test('Escape closes the viewer before host shortcuts and releases its listener', () => {
  document.querySelector('article')!.insertAdjacentHTML('beforeend', '<a href="/alice/status/123/photo/1"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/escape?format=jpg" alt="Photo"></div></a>');
  start();
  click('[data-testid="tweetPhoto"] img');
  let hostCalls = 0;
  const hostShortcut = (event: Event) => { hostCalls++; event.preventDefault(); };
  document.addEventListener('keydown', hostShortcut, true);
  const key = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.querySelector('dialog button')!.dispatchEvent(key as unknown as Event);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(hostCalls, 0);
  assert.equal(key.defaultPrevented, true);
  assert.equal(document.activeElement?.getAttribute('href'), '/alice/status/123/photo/1');
  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
  assert.equal(hostCalls, 1);
  document.removeEventListener('keydown', hostShortcut, true);
});

async function openMeasuredImage() {
  document.querySelector('article')!.insertAdjacentHTML('beforeend', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/large?format=jpg" alt="Large"></div>');
  start(); click('[data-testid="tweetPhoto"] img');
  const stage = document.querySelector<HTMLElement>('.se-image-stage')!;
  const img = document.querySelector<HTMLImageElement>('dialog img')!;
  Object.defineProperties(stage, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  Object.defineProperties(img, { naturalWidth: { value: 1600 }, naturalHeight: { value: 1200 } });
  img.dispatchEvent(new win.Event('load') as unknown as Event);
  await Promise.resolve();
  const control = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('dialog button')).find(button => button.getAttribute('aria-label') === label)!;
  return { stage, img, control };
}

test('image copy writes original-resolution PNG, reports failure, and supports retry with C', { timeout: 2000 }, async t => {
  const { control } = await openMeasuredImage();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  t.after(() => {
    for (const [name, descriptor] of [['navigator', originalNavigator], ['ClipboardItem', originalItem], ['createImageBitmap', originalBitmap]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator });
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class { data: Record<string, Promise<Blob>>; constructor(data: Record<string, Promise<Blob>>) { this.data = data; } } });
  let closed = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 1600, height: 1200, close() { closed++; } }) });
  const fetches: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    fetches.push(url); return new Response(new Blob(['original'], { type: 'image/jpeg' }));
  });
  const png = new Blob(['encoded'], { type: 'image/png' });
  t.mock.method(win.HTMLCanvasElement.prototype, 'getContext', function(this: HTMLCanvasElement) {
    assert.equal(this.width, 1600); assert.equal(this.height, 1200);
    return { drawImage() {} };
  });
  t.mock.method(win.HTMLCanvasElement.prototype, 'toBlob', (done: (blob: Blob) => void, type: string) => { assert.equal(type, 'image/png'); done(png); });
  let reject = true, writes = 0;
  t.mock.method(win.navigator.clipboard, 'write', async (items: { data: Record<string, Promise<Blob>> }[]) => {
    writes++;
    assert.equal(await items[0].data['image/png'], png);
    if (reject) throw new Error('Clipboard denied');
  });
  control('复制图片').click();
  assert.equal(writes, 1, 'clipboard write begins synchronously within the click');
  assert.equal(control('复制图片').disabled, true);
  while (control('复制图片').disabled) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(document.querySelector('dialog')!.textContent!, /复制失败，请重试/);
  assert.equal(control('复制图片').disabled, false);
  reject = false;
  viewerKey('c');
  while (control('复制图片').disabled) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(document.querySelector('dialog')!.textContent!, /已复制图片/);
  assert.equal(writes, 2);
  assert.equal(closed, 2);
  assert.deepEqual(fetches, Array(2).fill('https://pbs.twimg.com/media/large?format=jpg&name=orig'));
});

test('image copy is disabled until the selected image is decoded, including failed switches', async () => {
  addGalleryPhotos();
  start(); click('[data-testid="tweetPhoto"] img');
  const copy = document.querySelector<HTMLButtonElement>('dialog [aria-label="复制图片"]')!;
  assert.equal(copy.disabled, true);
  loadImage(document.querySelector('dialog img')!); await Promise.resolve();
  assert.equal(copy.disabled, false);
  viewerKey('ArrowRight');
  assert.equal(copy.disabled, true);
  document.querySelector('dialog img[data-pending]')!.dispatchEvent(new win.Event('error') as unknown as Event);
  assert.equal(copy.disabled, true);
  viewerKey('Home');
  assert.equal(copy.disabled, false);
});

test('image zoom is bounded, fits initially, and resets scroll offsets', async () => {
  const { stage, img, control } = await openMeasuredImage();
  assert.equal(img.style.width, '800px');
  assert.equal(document.querySelector('.se-image-scale')?.textContent, '50%');
  control('放大').click();
  assert.equal(img.style.width, '1000px');
  assert.equal(stage.scrollLeft, 100);
  assert.equal(stage.scrollTop, 75);
  for (let i = 0; i < 30; i++) control('放大').click();
  assert.equal(img.style.width, '12800px');
  assert.equal(control('放大').disabled, true);
  control('适应窗口').click();
  assert.equal(img.style.width, '800px');
  assert.equal(stage.scrollLeft, 0);
  assert.equal(stage.scrollTop, 0);
  assert.equal(stage.hasAttribute('data-pannable'), false);
  for (let i = 0; i < 30; i++) control('缩小').click();
  assert.equal(img.style.width, '200px');
  assert.equal(control('缩小').disabled, true);
});

test('wheel scrolling remains native, modifier wheel zooms, and pointer cancellation ends panning', async () => {
  const { stage, img, control } = await openMeasuredImage();
  const scroll = new win.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
  stage.dispatchEvent(scroll as unknown as Event);
  assert.equal(scroll.defaultPrevented, false);
  assert.equal(img.style.width, '800px');
  const zoom = new win.WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true });
  // happy-dom's WheelEvent extends UIEvent and omits MouseEvent modifier fields.
  Object.defineProperties(zoom, { ctrlKey: { value: true }, clientX: { value: 400 }, clientY: { value: 300 } });
  stage.dispatchEvent(zoom as unknown as Event);
  assert.equal(zoom.defaultPrevented, true);
  assert.ok(parseFloat(img.style.width) > 800);
  control('适应窗口').click(); control('放大').click();
  stage.setPointerCapture = () => {};
  stage.hasPointerCapture = () => false;
  const pointer = (type: string, x: number, y: number) => stage.dispatchEvent(new win.PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }) as unknown as Event);
  pointer('pointerdown', 300, 200);
  pointer('pointermove', 250, 150);
  assert.equal(stage.scrollLeft, 150);
  assert.equal(stage.scrollTop, 125);
  pointer('pointercancel', 250, 150);
  pointer('pointermove', 200, 100);
  assert.equal(stage.scrollLeft, 150);
  assert.equal(stage.hasAttribute('data-dragging'), false);
  assert.ok(document.querySelector('dialog'));
});

test('viewer icon controls keep accessible names and keyboard zoom/pan leaves browser shortcuts native', async () => {
  const { stage, img } = await openMeasuredImage();
  const viewer = document.querySelector('dialog')!;
  for (const button of viewer.querySelectorAll('button')) {
    assert.ok(button.getAttribute('aria-label'));
    assert.ok(button.title);
    assert.ok(button.querySelector('svg[aria-hidden="true"]'));
    assert.equal(button.textContent, '');
  }
  function key(value: string, init = {}) {
    const event = new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init });
    stage.dispatchEvent(event as unknown as Event);
    return event;
  }
  key('1');
  assert.equal(img.style.width, '1600px');
  const before = stage.scrollLeft;
  key('d');
  assert.equal(stage.scrollLeft, before + 80);
  key('ArrowLeft', { shiftKey: true });
  assert.equal(stage.scrollLeft, before - 80);
  key('F');
  assert.equal(img.style.width, '800px');
  assert.equal(stage.scrollLeft, 0);
  assert.equal(key('+', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(img.style.width, '800px');
  assert.equal(key('Tab').defaultPrevented, false);
  assert.equal(key(' ', {}).defaultPrevented, false);
  assert.equal(key('=', { isComposing: true }).defaultPrevented, false);
  key('?');
  assert.equal(document.querySelector<HTMLElement>('.se-image-shortcuts')!.hidden, false);
  assert.equal(document.querySelector('[aria-controls="se-image-shortcuts"]')!.getAttribute('aria-expanded'), 'true');
  key('?');
  assert.equal(document.querySelector<HTMLElement>('.se-image-shortcuts')!.hidden, true);
});

test('side navigation and gallery keys share boundaries and do not reset the current image at an endpoint', () => {
  document.querySelector('article')!.insertAdjacentHTML('beforeend', [1, 2, 3].map(n => `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/gallery${n}?format=jpg" alt="Photo ${n}"></div>`).join(''));
  start(); click('[data-testid="tweetPhoto"] img');
  const viewer = document.querySelector('dialog')!;
  const sidePrevious = viewer.querySelector<HTMLButtonElement>('[data-direction="previous"]')!;
  const sideNext = viewer.querySelector<HTMLButtonElement>('[data-direction="next"]')!;
  const img = () => viewer.querySelector('img')!;
  const key = (value: string) => viewer.dispatchEvent(new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }) as unknown as Event);
  assert.equal(sidePrevious.disabled, true);
  assert.equal(sideNext.hidden, false);
  sideNext.click(); assert.equal(img().alt, 'Photo 2');
  key('End'); assert.equal(img().alt, 'Photo 3');
  assert.equal(sideNext.disabled, true);
  img().style.width = '123px';
  key('ArrowRight'); assert.equal(img().style.width, '123px');
  key('Home'); assert.equal(img().alt, 'Photo 1');
  key('PageDown'); assert.equal(img().alt, 'Photo 2');
  key('PageUp'); assert.equal(img().alt, 'Photo 1');
  sideNext.click(); sidePrevious.click(); assert.equal(img().alt, 'Photo 1');
});

test('single-image viewer hides side navigation and keyboard retry recovers the error state', async () => {
  document.querySelector('article')!.insertAdjacentHTML('beforeend', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/fail?format=jpg" alt="Photo"></div>');
  start(); click('[data-testid="tweetPhoto"] img');
  for (const side of document.querySelectorAll<HTMLElement>('.se-image-side')) assert.equal(side.hidden, true);
  document.querySelector('dialog img')!.dispatchEvent(new win.Event('error') as unknown as Event);
  const retry = document.querySelector<HTMLButtonElement>('dialog [aria-label="重试"]')!;
  assert.equal(retry.hidden, false);
  document.querySelector('dialog')!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }) as unknown as Event);
  assert.equal(retry.hidden, true);
  assert.equal(document.querySelector('dialog')!.getAttribute('aria-busy'), 'true');
});

function addGalleryPhotos() {
  document.querySelector('article')!.insertAdjacentHTML('beforeend', [1, 2].map(n => `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/buffer${n}?format=jpg" alt="Buffer ${n}"></div>`).join(''));
}
function loadImage(img: HTMLImageElement) {
  Object.defineProperties(img, { naturalWidth: { value: 1200 }, naturalHeight: { value: 1600 } });
  img.dispatchEvent(new win.Event('load') as unknown as Event);
}
function viewerKey(key: string) {
  document.querySelector('dialog')!.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }) as unknown as Event);
}

test('switching retains the current image and view until decode, discards stale loads, and caches decoded images', async () => {
  addGalleryPhotos();
  const { img: original, stage, control } = await openMeasuredImage();
  control('放大').click();
  const oldWidth = original.style.width;
  const oldScroll = stage.scrollLeft;
  viewerKey('ArrowRight');
  const pending = document.querySelector<HTMLImageElement>('dialog img[data-pending]')!;
  let finishDecode!: () => void;
  pending.decode = () => new Promise(resolve => { finishDecode = resolve; });
  loadImage(pending);
  assert.equal(original.hidden, false);
  assert.equal(original.style.width, oldWidth);
  assert.equal(stage.scrollLeft, oldScroll);
  viewerKey('ArrowRight');
  finishDecode(); await Promise.resolve();
  assert.equal(document.querySelector('dialog img:not([hidden])'), original);
  const newest = document.querySelector<HTMLImageElement>('dialog img[data-pending]')!;
  loadImage(newest); await Promise.resolve();
  assert.equal(document.querySelector('dialog img:not([hidden])'), newest);
  assert.equal(document.querySelectorAll('dialog img').length, 1);
  assert.equal(stage.scrollLeft, 0);
  viewerKey('Home');
  assert.equal(document.querySelector('dialog img:not([hidden])'), original);
  assert.equal(document.querySelector('dialog')!.hasAttribute('aria-busy'), false);
  viewerKey('End');
  assert.equal(document.querySelector('dialog img:not([hidden])'), newest);
});

test('failed switches preserve the last image, retry safely, and closing rejects late decode', async () => {
  addGalleryPhotos();
  const { img: original, control } = await openMeasuredImage();
  viewerKey('ArrowRight');
  document.querySelector('dialog img[data-pending]')!.dispatchEvent(new win.Event('error') as unknown as Event);
  assert.equal(document.querySelector('dialog img:not([hidden])'), original);
  assert.equal(control('重试').hidden, false);
  control('重试').click();
  const pending = document.querySelector<HTMLImageElement>('dialog img[data-pending]')!;
  let finishDecode!: () => void;
  pending.decode = () => new Promise(resolve => { finishDecode = resolve; });
  loadImage(pending);
  viewerKey('Escape');
  finishDecode(); await Promise.resolve();
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(pending.isConnected, false);
});

test('background clicks dismiss but image clicks, panning and scrollbar clicks do not', async () => {
  const { img, stage, control } = await openMeasuredImage();
  const canvas = document.querySelector<HTMLElement>('.se-image-canvas')!;
  const pointer = (target: HTMLElement, type: string, x: number, y: number) => target.dispatchEvent(new win.PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }) as unknown as Event);
  const mouseClick = (target: HTMLElement, x: number, y: number) => target.dispatchEvent(new win.MouseEvent('click', { button: 0, clientX: x, clientY: y, bubbles: true }) as unknown as Event);
  pointer(img, 'pointerdown', 100, 100); mouseClick(img, 100, 100);
  assert.ok(document.querySelector('dialog'));
  pointer(stage, 'pointerdown', 805, 100); mouseClick(stage, 805, 100);
  assert.ok(document.querySelector('dialog'));
  control('放大').click(); stage.setPointerCapture = () => {}; stage.hasPointerCapture = () => false;
  pointer(canvas, 'pointerdown', 100, 100); pointer(stage, 'pointermove', 150, 100); pointer(stage, 'pointerup', 150, 100); mouseClick(stage, 150, 100);
  assert.ok(document.querySelector('dialog'));
  pointer(canvas, 'pointerdown', 100, 100); pointer(stage, 'pointerup', 100, 100); mouseClick(canvas, 100, 100);
  assert.equal(document.querySelector('dialog'), null);
});

test('layout refresh preserves the existing navigation toggle icon', () => {
  start();
  const icon = document.querySelector('#site-enhancer-nav-toggle svg');
  window.dispatchEvent(new win.Event('resize') as unknown as Event);
  assert.equal(document.querySelector('#site-enhancer-nav-toggle svg'), icon);
});

test('captured double-click restores fit and holding the help key does not toggle repeatedly', async () => {
  const { img, stage, control } = await openMeasuredImage();
  control('放大').click();
  img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 750, width: 1000, height: 750, x: 0, y: 0, toJSON() {} });
  stage.dispatchEvent(new win.MouseEvent('dblclick', { clientX: 100, clientY: 100, bubbles: true, cancelable: true }) as unknown as Event);
  assert.equal(img.style.width, '800px');
  viewerKey('?');
  document.querySelector('dialog')!.dispatchEvent(new win.KeyboardEvent('keydown', { key: '?', repeat: true, bubbles: true }) as unknown as Event);
  assert.equal(document.querySelector<HTMLElement>('.se-image-shortcuts')!.hidden, false);
});

function trackViewerImages(t: TestContext) {
  const images: HTMLImageElement[] = [];
  const create = document.createElement.bind(document);
  t.mock.method(document, 'createElement', (tag: string, options?: ElementCreationOptions) => {
    const node = create(tag, options);
    if (tag === 'img') images.push(node as HTMLImageElement);
    return node;
  });
  return images;
}

test('neighbors are predecoded off-DOM and ready switches do not restart loading or decoding', async t => {
  const created = trackViewerImages(t);
  addGalleryPhotos();
  const { img: original } = await openMeasuredImage();
  const neighbor = created.find(image => image.alt === 'Buffer 2')!;
  assert.ok(neighbor);
  assert.equal(neighbor.isConnected, false);
  assert.equal(neighbor.fetchPriority, 'low');
  let decodes = 0;
  neighbor.decode = async () => { decodes++; };
  loadImage(neighbor); await Promise.resolve();
  assert.equal(document.querySelector('dialog img:not([hidden])'), original);
  viewerKey('ArrowRight');
  assert.equal(document.querySelector('dialog img:not([hidden])'), neighbor);
  assert.equal(document.querySelector('dialog')!.hasAttribute('aria-busy'), false);
  viewerKey('ArrowLeft'); viewerKey('ArrowRight');
  assert.equal(decodes, 1);
  assert.equal(created.filter(image => image.alt === 'Buffer 2').length, 1);
  assert.equal(document.querySelector('dialog img:not([hidden])'), neighbor);
});

test('rapid navigation shares in-flight neighbor requests and closing cancels background work', async t => {
  const created = trackViewerImages(t);
  addGalleryPhotos();
  await openMeasuredImage();
  const neighbor = created.find(image => image.alt === 'Buffer 2')!;
  let complete!: () => void;
  let decodes = 0;
  neighbor.decode = () => { decodes++; return new Promise(resolve => { complete = resolve; }); };
  loadImage(neighbor);
  viewerKey('ArrowRight');
  assert.equal(neighbor.fetchPriority, 'high');
  viewerKey('ArrowRight'); viewerKey('ArrowLeft');
  assert.equal(document.querySelector('dialog img[data-pending]'), neighbor);
  assert.equal(created.filter(image => image.alt === 'Buffer 2').length, 1);
  complete(); await Promise.resolve();
  assert.equal(document.querySelector('dialog img:not([hidden])'), neighbor);
  assert.equal(decodes, 1);
  const stillLoading = created.find(image => image.alt === 'Large')!;
  viewerKey('Escape');
  assert.equal(stillLoading.hasAttribute('src'), false);
  assert.equal(document.querySelector('dialog'), null);
});

function attachReadyDetail(t: TestContext, frame: HTMLIFrameElement, url: string) {
  const detail = new Window({ url });
  t.after(() => detail.happyDOM.close());
  Object.defineProperties(frame, { contentDocument: { configurable: true, value: detail.document }, contentWindow: { configurable: true, value: detail } });
  detail.document.body.innerHTML = `<div data-testid="primaryColumn"><article data-testid="tweet"><a href="${url}"><time>Now</time></a></article><textarea aria-label="Reply"></textarea><video></video></div>`;
  return detail;
}
function signalDetail(source: unknown, origin = 'https://x.com') {
  const event = new win.Event('message');
  Object.assign(event, { source, origin, data: { type: DETAIL_READY_MESSAGE } });
  window.dispatchEvent(event as unknown as Event);
}
function selectDetail(id: number) {
  document.querySelector<HTMLAnchorElement>('a:has(time)')!.href = `/alice/status/${id}`;
  click('time');
  return document.querySelector<HTMLIFrameElement>('iframe:not([hidden])')!;
}

test('only the current same-origin detail signal bypasses the readiness poll', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  start(); const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  signalDetail(win);
  signalDetail(detail, 'https://untrusted.test');
  assert.equal(frame.style.visibility, 'hidden');
  signalDetail(detail);
  assert.equal(frame.style.visibility, '');
  assert.equal(document.querySelector<HTMLElement>('.se-column-status')!.hidden, true);
});

test('detail notifier fires as content renders, fires once and stops after disposal', async t => {
  const detail = new Window({ url: 'https://x.com/alice/status/123' });
  t.after(() => detail.happyDOM.close());
  const primary = detail.document.createElement('section');
  primary.setAttribute('data-testid', 'primaryColumn');
  detail.document.body.append(primary);
  let calls = 0;
  const stop = observeDetailReady(detail.document as unknown as Document, () => { calls++; });
  primary.innerHTML = '<div><article data-testid="tweet"></article></div>';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  detail.document.querySelector('article')!.textContent = 'Updated';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1); stop();
  detail.document.body.innerHTML = '';
  const dispose = observeDetailReady(detail.document as unknown as Document, () => { calls++; });
  dispose();
  detail.document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"></article></div>';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
});

test('detail notifier ignores unrelated mutations and detects late test IDs', async t => {
  const detail = new Window({ url: 'https://x.com/alice/status/123' });
  t.after(() => detail.happyDOM.close());
  const primary = detail.document.createElement('section');
  const post = detail.document.createElement('article');
  const sidebar = detail.document.createElement('aside');
  primary.append(post);
  detail.document.body.append(primary, sidebar);
  const queries = t.mock.method(detail.document, 'querySelector');
  let calls = 0;
  const doc = detail.document as unknown as Document;
  observeDetailReady(doc, () => { calls++; });
  const initialQueries = queries.mock.callCount();

  sidebar.setAttribute('data-testid', 'sidebarColumn');
  sidebar.append(detail.document.createElement('div'));
  post.setAttribute('data-testid', 'tweet');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 0);
  assert.equal(queries.mock.callCount(), initialQueries, 'mutations should not rescan the document');

  primary.setAttribute('data-testid', 'primaryColumn');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  observeDetailReady(doc, () => { calls++; });
  assert.equal(calls, 2, 'an already-rendered post is ready immediately');
});

test('recent details reuse connected documents and drafts, pause hidden video and stay bounded', async t => {
  const prepared: string[] = [];
  let released = 0;
  columns = installXColumns({ prepareDetail: async url => { prepared.push(url); return url; }, releaseDetail: () => { released++; } });
  columns.setEnabled(true);
  const first = selectDetail(123); await Promise.resolve();
  const firstDoc = attachReadyDetail(t, first, 'https://x.com/alice/status/123'); signalDetail(firstDoc);
  firstDoc.document.querySelector('textarea')!.value = 'Unsent reply';
  firstDoc.document.documentElement.scrollTop = 180;
  const video = firstDoc.document.querySelector('video')!;
  Object.defineProperty(video, 'paused', { value: false });
  let pauses = 0; video.pause = () => { pauses++; };
  const second = selectDetail(456); await Promise.resolve();
  const secondDoc = attachReadyDetail(t, second, 'https://x.com/alice/status/456'); signalDetail(secondDoc);
  assert.equal(first.hidden, true); assert.equal(first.isConnected, true); assert.equal(pauses, 1);
  firstDoc.document.documentElement.scrollTop = 0;
  t.mock.method(firstDoc, 'scrollTo', (_x: number, y: number) => { firstDoc.document.documentElement.scrollTop = y; });
  assert.equal(selectDetail(123), first);
  assert.equal(prepared.length, 2);
  assert.equal(firstDoc.document.querySelector('textarea')!.value, 'Unsent reply');
  assert.equal(firstDoc.document.documentElement.scrollTop, 180);
  const third = selectDetail(789); await Promise.resolve();
  assert.equal(document.querySelectorAll('iframe').length, 2);
  assert.equal(second.isConnected, false);
  secondDoc.document.querySelector('time')!.dispatchEvent(new secondDoc.MouseEvent('click', { button: 0, bubbles: true }));
  assert.equal(document.querySelector('iframe:not([hidden])'), third);
  click('.se-column-toolbar button[aria-label="关闭"]');
  assert.equal(document.querySelectorAll('iframe').length, 0);
  assert.equal(released, 1);
  signalDetail(firstDoc);
  assert.equal(document.querySelectorAll('iframe').length, 0);
});

test('cached frames that navigated to a different post are not reused', t => {
  start();
  const first = selectDetail(123);
  const firstDoc = attachReadyDetail(t, first, 'https://x.com/alice/status/123'); signalDetail(firstDoc);
  const second = selectDetail(456);
  const secondDoc = attachReadyDetail(t, second, 'https://x.com/alice/status/456'); signalDetail(secondDoc);
  firstDoc.history.pushState({}, '', '/alice/status/999');
  assert.notEqual(selectDetail(123), first);
  assert.equal(first.isConnected, false);
  columns!.setEnabled(false);
  assert.equal(document.querySelectorAll('iframe').length, 0);
});

function wheelAtViewer(deltaX: number, deltaY = 0, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  const event = new win.WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true });
  Object.defineProperties(event, { ctrlKey: { value: !!modifiers.ctrlKey }, metaKey: { value: !!modifiers.metaKey }, clientX: { value: 300 }, clientY: { value: 200 } });
  document.querySelector('.se-image-stage')!.dispatchEvent(event as unknown as Event);
  return event;
}

test('horizontal trackpad gestures switch once per momentum burst and work in both directions', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  addGalleryPhotos(); await openMeasuredImage();
  const count = () => document.querySelector('.se-image-count')!.textContent;
  assert.equal(wheelAtViewer(24, 2).defaultPrevented, true);
  assert.equal(count(), '1 / 3');
  wheelAtViewer(45, 1); assert.equal(count(), '1 / 3');
  t.mock.timers.tick(101); assert.equal(count(), '2 / 3');
  for (const delta of [80, 60, 40, 20, 5]) { t.mock.timers.tick(30); wheelAtViewer(delta); }
  assert.equal(count(), '2 / 3');
  t.mock.timers.tick(241);
  wheelAtViewer(70); t.mock.timers.tick(101); assert.equal(count(), '3 / 3');
  t.mock.timers.tick(241);
  wheelAtViewer(-70); t.mock.timers.tick(101); assert.equal(count(), '2 / 3');
  t.mock.timers.tick(241);
  wheelAtViewer(-70); t.mock.timers.tick(101); assert.equal(count(), '1 / 3');
  t.mock.timers.tick(241);
  assert.equal(wheelAtViewer(-90).defaultPrevented, true);
  assert.equal(count(), '1 / 3');
});

test('trackpad navigation preserves vertical scrolling, enlarged-image panning and modifier zoom', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  addGalleryPhotos(); const { img, control } = await openMeasuredImage();
  const count = () => document.querySelector('.se-image-count')!.textContent;
  assert.equal(wheelAtViewer(20, 70).defaultPrevented, false);
  assert.equal(count(), '1 / 3');
  control('放大').click();
  assert.equal(wheelAtViewer(120).defaultPrevented, false);
  assert.equal(count(), '1 / 3');
  control('适应窗口').click();
  const oldWidth = parseFloat(img.style.width);
  assert.equal(wheelAtViewer(120, -30, { ctrlKey: true }).defaultPrevented, true);
  assert.ok(parseFloat(img.style.width) > oldWidth);
  assert.equal(count(), '1 / 3');
  control('适应窗口').click(); t.mock.timers.tick(241);
  wheelAtViewer(35); wheelAtViewer(-35);
  assert.equal(count(), '1 / 3');
});

function fakeAnimations(t: TestContext) {
  t.mock.method(win, 'matchMedia', () => ({ matches: false }));
  const animations: Array<{ frames: Keyframe[]; canceled: boolean; finish: () => void }> = [];
  const proto = win.HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'animate');
  Object.defineProperty(proto, 'animate', { configurable: true, value(frames: Keyframe[]) {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const record = { frames, canceled: false, finish };
    animations.push(record);
    return { finished, cancel() { record.canceled = true; } };
  } });
  t.after(() => { if (original) Object.defineProperty(proto, 'animate', original); else delete (proto as unknown as { animate?: unknown }).animate; });
  return animations;
}

test('swiping moves decoded images with the gesture and settles into the next image', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const created = trackViewerImages(t);
  addGalleryPhotos(); const { img } = await openMeasuredImage();
  const neighbor = created.find(image => image.alt === 'Buffer 2')!;
  loadImage(neighbor); await Promise.resolve();
  const animations = fakeAnimations(t);
  wheelAtViewer(30);
  assert.ok(img.closest('.se-image-motion'));
  assert.equal(document.querySelector<HTMLElement>('.se-image-slide')!.style.transform, 'translate3d(-30px,0,0)');
  wheelAtViewer(40);
  assert.equal(document.querySelector('.se-image-count')!.textContent, '1 / 3');
  t.mock.timers.tick(101);
  assert.equal(animations.length, 2);
  assert.equal(animations[0].frames[0].transform, 'translate3d(-70px,0,0)');
  assert.equal(animations[0].frames[1].transform, 'translate3d(-824px,0,0)');
  animations.forEach(animation => animation.finish());
  await Promise.resolve(); await Promise.resolve();
  assert.equal(document.querySelector('.se-image-canvas > img'), neighbor);
  assert.equal(document.querySelector('.se-image-motion'), null);
  assert.equal(neighbor.style.position, '');
});

test('momentum decay settles before wheel events stop and ignores the remaining tail', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const created = trackViewerImages(t);
  addGalleryPhotos(); await openMeasuredImage();
  const neighbor = created.find(image => image.alt === 'Buffer 2')!;
  loadImage(neighbor); await Promise.resolve();
  const animations = fakeAnimations(t);
  for (const delta of [30, 24, 18, 12]) {
    wheelAtViewer(delta); t.mock.timers.tick(16);
  }
  assert.equal(animations.length, 2, 'settles during inertia instead of waiting for silence');
  assert.equal(animations[0].frames[0].transform, 'translate3d(-84px,0,0)');
  animations.forEach(animation => animation.finish());
  await Promise.resolve(); await Promise.resolve();
  for (const delta of [12, 8, 4, 2, 1]) {
    wheelAtViewer(delta); t.mock.timers.tick(16);
  }
  assert.equal(document.querySelector('.se-image-canvas > img'), neighbor);
  assert.equal(document.querySelector('.se-image-count')!.textContent, '2 / 3');
  assert.equal(document.querySelector('.se-image-motion'), null);
  assert.equal(animations.length, 2);
});

test('a decisive swipe settles immediately from the toolbar and viewer background', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const created = trackViewerImages(t);
  addGalleryPhotos(); const { control } = await openMeasuredImage();
  const neighbor = created.find(image => image.alt === 'Buffer 2')!;
  loadImage(neighbor); await Promise.resolve();
  const animations = fakeAnimations(t);
  const wheel = (target: Element, deltaX: number) => {
    const event = new win.WheelEvent('wheel', { deltaX, bubbles: true, cancelable: true });
    target.dispatchEvent(event as unknown as Event);
    assert.equal(event.defaultPrevented, true);
  };
  wheel(control('放大'), 40);
  assert.equal(document.querySelector<HTMLElement>('.se-image-slide')!.style.transform, 'translate3d(-40px,0,0)');
  wheel(document.querySelector('dialog')!, 60);
  assert.equal(animations.length, 2, 'crossing the threshold does not wait for an idle timer');
  animations.forEach(animation => animation.finish());
  await Promise.resolve(); await Promise.resolve();
  assert.equal(document.querySelector('.se-image-canvas > img'), neighbor);
});

test('horizontal gestures outside the stage navigate even when the image is enlarged', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  addGalleryPhotos(); const { control } = await openMeasuredImage();
  control('放大').click();
  const event = new win.WheelEvent('wheel', { deltaX: 100, bubbles: true, cancelable: true });
  document.querySelector('dialog')!.dispatchEvent(event as unknown as Event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(document.querySelector('.se-image-count')!.textContent, '2 / 3');
});

test('an abrupt gesture stop starts settling within 60ms', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  await openMeasuredImage();
  const animations = fakeAnimations(t);
  wheelAtViewer(-30);
  t.mock.timers.tick(59);
  assert.equal(animations.length, 0);
  t.mock.timers.tick(1);
  assert.equal(animations.length, 2);
  assert.equal(animations[0].frames[1].transform, 'translate3d(0px,0,0)');
});

test('short and boundary swipes rebound, and closing cancels animation completion', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const { img } = await openMeasuredImage();
  const animations = fakeAnimations(t);
  wheelAtViewer(-100);
  assert.equal(document.querySelector<HTMLElement>('.se-image-slide')!.style.transform, 'translate3d(20px,0,0)');
  t.mock.timers.tick(101);
  assert.equal(animations[0].frames[1].transform, 'translate3d(0px,0,0)');
  animations.forEach(animation => animation.finish());
  await Promise.resolve(); await Promise.resolve();
  assert.equal(document.querySelector('.se-image-canvas > img'), img);
  assert.equal(document.querySelector('.se-image-count')!.textContent, '1 / 1');
  t.mock.timers.tick(241);
  wheelAtViewer(20); t.mock.timers.tick(101);
  viewerKey('Escape');
  animations.forEach(animation => animation.finish());
  await Promise.resolve(); await Promise.resolve();
  assert.equal(document.querySelector('dialog'), null);
  assert.ok(animations.every(animation => animation.canceled));
});

test('reduced-motion preference skips tracking and settling animations without losing navigation', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const created = trackViewerImages(t);
  addGalleryPhotos(); await openMeasuredImage();
  const neighbor = created.find(image => image.alt === 'Buffer 2')!;
  loadImage(neighbor); await Promise.resolve();
  const animations = fakeAnimations(t);
  t.mock.method(win, 'matchMedia', () => ({ matches: true }));
  wheelAtViewer(70); t.mock.timers.tick(101);
  assert.equal(document.querySelector('.se-image-canvas > img'), neighbor);
  assert.equal(document.querySelector('.se-image-motion'), null);
  assert.equal(animations.length, 0);
});


test('loaded timeline thumbnail remains visible until the full image decodes and fades in', async t => {
  addGalleryPhotos();
  const source = document.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img')!;
  Object.defineProperties(source, { complete: { value: true }, naturalWidth: { value: 300 } });
  start();
  const animations = fakeAnimations(t);
  click('[data-testid="tweetPhoto"] img');
  const preview = document.querySelector<HTMLImageElement>('.se-image-preview')!;
  assert.equal(preview.src, source.src);
  assert.equal(source.isConnected, true);
  const full = document.querySelector<HTMLImageElement>('.se-image-canvas img')!;
  assert.match(full.src, /name=orig/);
  assert.equal(full.hidden, true);
  loadImage(full); await Promise.resolve();
  assert.equal(full.hidden, false);
  assert.equal(preview.isConnected, true);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].frames[0].opacity, 1);
  assert.equal(animations[0].frames[1].opacity, 0);
  animations[0].finish(); await Promise.resolve();
  assert.equal(preview.isConnected, false);
  assert.equal(document.querySelector('.se-image-canvas > img'), full);
});

test('full image failure preserves thumbnail and closing clears its pending upgrade', async () => {
  addGalleryPhotos();
  const source = document.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img')!;
  Object.defineProperties(source, { complete: { value: true }, naturalWidth: { value: 300 } });
  start(); click('[data-testid="tweetPhoto"] img');
  const preview = document.querySelector('.se-image-preview')!;
  const full = document.querySelector<HTMLImageElement>('.se-image-canvas img')!;
  full.dispatchEvent(new win.Event('error') as unknown as Event);
  assert.equal(preview.isConnected, true);
  assert.equal(document.querySelector<HTMLButtonElement>('.se-image-retry')!.hidden, false);
  viewerKey('Escape');
  loadImage(full); await Promise.resolve();
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(preview.isConnected, false);
  assert.equal(source.isConnected, true);
});


test('a fresh swipe after the momentum tail works without any pointer movement', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  addGalleryPhotos(); await openMeasuredImage();
  wheelAtViewer(100);
  assert.equal(document.querySelector('.se-image-count')!.textContent, '2 / 3');
  for (const delta of [40, 20, 8, 2]) { t.mock.timers.tick(16); wheelAtViewer(delta); }
  t.mock.timers.tick(30);
  wheelAtViewer(100);
  assert.equal(document.querySelector('.se-image-count')!.textContent, '3 / 3');
  t.mock.timers.tick(30);
  wheelAtViewer(-100);
  assert.equal(document.querySelector('.se-image-count')!.textContent, '2 / 3');
});

function key(target: unknown, init: Record<string, unknown>, view: Window = win) {
  const event = new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  (target as EventTarget).dispatchEvent(event as unknown as Event);
  return event;
}
test('Enter on a keyboard-focused post opens details instead of navigating the timeline', () => {
  start();
  const article = document.querySelector<HTMLElement>('article')!;
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }]) {
    assert.equal(key(article, { key: 'Enter', ...init }).defaultPrevented, false);
  }
  assert.equal(key(document.querySelector('a[href="/alice"]')!, { key: 'Enter' }).defaultPrevented, false, 'focused links stay native');
  assert.equal(document.querySelector('iframe'), null);
  assert.ok(key(article, { key: 'Enter' }).defaultPrevented);
  assert.equal(document.querySelector('iframe')?.src, 'https://x.com/alice/status/123');
  assert.equal(location.pathname, '/home');
  assert.equal(article.hasAttribute('data-site-enhancer-selected'), true);
  columns!.setEnabled(false);
  assert.equal(key(article, { key: 'Enter' }).defaultPrevented, false);
});
test('Escape leaves details open while X shows an alertdialog', () => {
  start();
  key(document.querySelector<HTMLElement>('article')!, { key: 'Enter' });
  const frame = document.querySelector('iframe');
  assert.ok(frame);
  document.body.insertAdjacentHTML('beforeend', '<div id="layers"><div role="alertdialog"></div></div>');
  assert.equal(key(document.body, { key: 'Escape' }).defaultPrevented, false);
  assert.equal(document.querySelector('iframe'), frame);
});

test('Escape closes details and returns focus, but leaves editors, menus and viewers alone', t => {
  start();
  const article = document.querySelector<HTMLElement>('article')!;
  assert.equal(key(article, { key: 'Escape' }).defaultPrevented, false, 'nothing to close');
  key(article, { key: 'Enter' });
  const frame = document.querySelector('iframe')!;
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  signalDetail(detail);
  assert.equal(key(detail.document.querySelector('textarea')!, { key: 'Escape' }, detail).defaultPrevented, false);
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  document.body.append(menu);
  assert.equal(key(document.body, { key: 'Escape' }).defaultPrevented, false);
  menu.remove();
  const handled = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  handled.preventDefault();
  document.body.dispatchEvent(handled as unknown as Event);
  assert.ok(document.querySelector('iframe'), 'an Escape already handled by a viewer does not close details');
  assert.ok(key(detail.document.body, { key: 'Escape' }, detail).defaultPrevented);
  assert.equal(document.querySelector('iframe'), null);
  assert.equal(document.activeElement, article);
  assert.equal(document.querySelector('[data-site-enhancer-selected]'), null);
});
test('the selected post stays highlighted when X re-renders its virtualized cell', async () => {
  start();
  const column = document.querySelector('[data-testid="primaryColumn"]')!;
  const html = column.innerHTML;
  click('time');
  column.querySelector('article')!.remove();
  column.insertAdjacentHTML('beforeend', `<div data-testid="cellInnerDiv">${html.replace('/alice/status/123', '/bob/status/7')}</div>`);
  column.insertAdjacentHTML('beforeend', `<div data-testid="cellInnerDiv">${html}</div>`);
  await new Promise(resolve => setTimeout(resolve, 0));
  const marked = document.querySelectorAll('[data-site-enhancer-selected]');
  assert.equal(marked.length, 1);
  assert.equal(postPermalink(marked[0]), 'https://x.com/alice/status/123');
});
test('a click elsewhere closes an open X video context menu in the other document or under an intercepted click', t => {
  start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  signalDetail(detail);
  const openMenu = (doc: Document) => {
    doc.body.insertAdjacentHTML('beforeend', '<div id="layers"><div role="menu">Copy video address</div></div>');
    const layers = doc.getElementById('layers')!;
    let closes = 0;
    // X removes the menu from a click listener on its own document.
    doc.addEventListener('click', function close() { closes++; layers.remove(); doc.removeEventListener('click', close); });
    return () => closes;
  };
  const detailDoc = detail.document as unknown as Document;
  let closes = openMenu(detailDoc);
  click('a[href="/alice"]');
  assert.equal(closes(), 1, 'a timeline click reaches the detail document');
  assert.equal(detailDoc.querySelector('[role="menu"]'), null);
  closes = openMenu(detailDoc);
  const intercepted = new detail.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  detail.document.querySelector('time')!.dispatchEvent(intercepted);
  assert.ok(intercepted.defaultPrevented);
  assert.equal(closes(), 1, 'an intercepted detail click still closes the detail menu');
  closes = openMenu(document);
  detail.document.body.dispatchEvent(new detail.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(closes(), 1, 'a detail click closes a timeline menu');
  assert.equal(document.querySelector('[role="menu"]'), null);
  click('time');
  assert.equal(document.querySelectorAll('#layers').length, 0);
});

test('hover intent cancels speculative rules and reuses the hovered frame on selection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let prepared = 0;
  let released = 0;
  columns = installXColumns({
    prepareDetail: async url => { prepared++; return url; },
    releaseDetail: () => { released++; },
  });
  columns.setEnabled(true);
  const article = document.querySelector('article')!;
  const pointer = (type: string) => article.dispatchEvent(new win.PointerEvent(type, { bubbles: true }) as unknown as Event);
  pointer('pointermove');
  t.mock.timers.tick(200);
  assert.equal(prepared, 0, 'empty details do not prefetch');
  const first = selectDetail(456);
  await Promise.resolve();
  signalDetail(attachReadyDetail(t, first, 'https://x.com/alice/status/456'));
  article.querySelector('a')!.href = '/alice/status/123';
  pointer('pointermove');
  t.mock.timers.tick(199);
  window.dispatchEvent(new win.Event('scroll') as unknown as Event);
  pointer('pointermove');
  t.mock.timers.tick(200);
  assert.equal(prepared, 1, 'scroll cancels the dwell and suppresses immediate movement');
  const later = Date.now() + 201;
  t.mock.method(Date, 'now', () => later);
  pointer('pointermove');
  t.mock.timers.tick(199);
  assert.equal(prepared, 1);
  t.mock.timers.tick(1);
  pointer('pointerout');
  assert.equal(released, 1);
  assert.equal(document.querySelector('iframe[hidden]'), null);
  pointer('pointermove');
  t.mock.timers.tick(200);
  const speculative = document.querySelector<HTMLIFrameElement>('iframe[hidden]');
  assert.ok(speculative?.hidden);
  click('time');
  await Promise.resolve();
  assert.equal(document.querySelector('iframe:not([hidden])'), speculative);
  assert.equal(prepared, 3);
  assert.equal(speculative.src, 'https://x.com/alice/status/123');
  columns.remove();
  assert.equal(released, 2);
});

test('empty sidebar resets the native margin and fixed search positioning', () => {
  assert.match(COLUMNS_CSS, /width:var\(--se-detail\)!important;max-width:none!important;margin:0!important/);
  assert.match(COLUMNS_CSS, /sidebarColumn"\]>div\{width:100%!important;max-width:600px!important;margin-inline:auto/);
  assert.match(COLUMNS_CSS, /:not\(:has\(\[data-testid="trend"\]\)\)\{position:static!important/);
});

test('right bracket focuses the matching detail post for native scrolling keys', t => {
  start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const post = detail.document.querySelector('article')!;
  post.insertAdjacentHTML('beforebegin', '<article data-testid="tweet"><a href="/bob/status/9"><time></time></a></article>');
  signalDetail(detail);
  assert.ok(key(document.querySelector('article')!, { key: ']' }).defaultPrevented);
  assert.equal(detail.document.activeElement, post);
  const received: string[] = [];
  detail.document.addEventListener('keydown', event => { if (event instanceof detail.KeyboardEvent) received.push(event.key); });
  for (const name of [' ', 'ArrowDown', 'PageDown']) {
    assert.equal(key(detail.document.activeElement!, { key: name }, detail).defaultPrevented, false);
  }
  assert.deepEqual(received, [' ', 'ArrowDown', 'PageDown']);
});

test('title locates a virtualized selected post and emphasizes its replacement once', async () => {
  start();
  const article = document.querySelector('article')!;
  const html = article.outerHTML;
  Object.defineProperty(article, 'getBoundingClientRect', { value: () => ({ top: 1800 }) });
  click('time');
  article.remove();
  let top: number | undefined;
  Object.defineProperty(window, 'scrollTo', { value: (options: ScrollToOptions) => { top = options.top; } });
  click('.se-column-title');
  assert.equal(top, 1800 - window.innerHeight / 2);
  let animations = 0;
  for (let i = 0; i < 2; i++) {
    document.querySelector('[data-testid="primaryColumn"]')!.insertAdjacentHTML('beforeend', html);
    const replacement = document.querySelector('article')!;
    Object.defineProperty(replacement, 'animate', { value: () => animations++ });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(replacement.hasAttribute('data-site-enhancer-selected'));
    assert.equal(animations, 1);
    replacement.remove();
  }
});

test('native icon rail follows label removal and restores the saved nav width', async () => {
  localStorage.setItem(COLUMNS_WIDTH_KEY, JSON.stringify({ nav: 240, share: .5 }));
  document.body.insertAdjacentHTML('afterbegin', '<header role="banner"><nav><a href="/home"><svg></svg></a></nav></header>');
  start();
  const width = () => document.documentElement.style.getPropertyValue('--se-nav');
  const toggle = document.querySelector<HTMLButtonElement>('#site-enhancer-nav-toggle')!;
  assert.equal(width(), '88px');
  assert.equal(toggle.hidden, true);
  const home = document.querySelector('nav a')!;
  home.insertAdjacentHTML('beforeend', '<span>首页</span>');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(width(), '240px');
  assert.equal(toggle.hidden, false);
  home.querySelector('span')!.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(width(), '88px');
});

test('x-web mounts after streaming, copies only the selected post and keeps unsupported pages native', async () => {
  const fixture = readFileSync(new URL('../scripts/browser-regression/fixtures/x-web.html', import.meta.url), 'utf8');
  document.body.replaceChildren();
  const layout = start();
  const panel = () => document.getElementById('site-enhancer-columns');
  assert.equal(panel(), null);
  document.documentElement.setAttribute('data-app-env', 'test');
  document.documentElement.setAttribute('data-app-version', 'fixture');
  document.body.innerHTML = fixture.split('<body>')[1].split('</body>')[0];
  await win.happyDOM.waitUntilComplete();
  assert.ok(panel());
  const post = document.querySelector('article')!;
  assert.deepEqual(getTweetData(post), { text: 'Sample text', url: 'https://x.com/example/status/101' });
  assert.equal(postPermalink(post), 'https://x.com/example/status/101');
  let ready = false;
  observeDetailReady(document, () => { ready = true; });
  assert.ok(ready);
  const wrapper = post.parentElement!;
  wrapper.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) as unknown as Event);
  assert.equal(document.querySelector('iframe')?.src, 'https://x.com/example/status/101');
  assert.ok(click('article article div').defaultPrevented);
  assert.ok([...document.querySelectorAll('iframe')].some(frame => frame.src.endsWith('/quoted/status/202')));
  for (const path of ['/settings/account', '/messages', '/i/chat/1', '/i/grok']) {
    win.history.replaceState(null, '', path);
    layout.onNavigate();
    assert.equal(panel(), null);
  }
  win.history.replaceState(null, '', '/home');
  layout.onNavigate();
  assert.ok(panel());
});

test('a column missing between routes keeps the layout, and a lasting absence returns to native', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const layout = start();
  const mounted = document.getElementById('site-enhancer-columns');
  assert.ok(mounted);
  const main = document.querySelector('main')!;
  main.remove();
  layout.onNavigate();
  t.mock.timers.tick(STRUCTURE_GRACE_MS - 1);
  assert.equal(document.getElementById('site-enhancer-columns'), mounted);
  document.body.append(main);
  layout.onNavigate();
  t.mock.timers.tick(STRUCTURE_GRACE_MS);
  assert.equal(document.getElementById('site-enhancer-columns'), mounted);
  main.remove();
  layout.onNavigate();
  t.mock.timers.tick(STRUCTURE_GRACE_MS);
  assert.equal(document.getElementById('site-enhancer-columns'), null);
});

test('detail multi-video post prioritizes first focal video, resolves reply destinations, and skips video hover preload while playing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prepared: string[] = [];
  columns = installXColumns({ prepareDetail: async url => { prepared.push(url); return url; } });
  columns.setEnabled(true);
  // Add a second feed post containing a video to test hover preload throttling while playing.
  const secondPost = document.createElement('article');
  secondPost.dataset.testid = 'tweet';
  secondPost.innerHTML = '<a href="https://x.com/bob/status/999"><time>Now</time></a><div data-testid="videoPlayer"><video></video></div>';
  document.querySelector('[data-testid="primaryColumn"]')!.append(secondPost);

  const frame = selectDetail(123);
  assert.equal(frame.hasAttribute('data-site-enhancer-detail-pending'), true, 'pending attribute holds playback until ready');
  await Promise.resolve();
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const first = addVideo(detail.document as unknown as Document);
  const second = addVideo(detail.document as unknown as Document);
  const replyArticle = detail.document.createElement('article');
  replyArticle.dataset.testid = 'tweet';
  replyArticle.innerHTML = '<a href="https://x.com/carol/status/456"><time>Now</time></a>';
  detail.document.querySelector('[data-testid="primaryColumn"]')!.append(replyArticle);
  const reply = addVideo(detail.document as unknown as Document);
  replyArticle.append(reply.player as unknown as typeof replyArticle);
  signalDetail(detail);
  assert.equal(frame.hasAttribute('data-site-enhancer-detail-pending'), false, 'pending attribute clears once attached and visible');

  first.play();
  assert.equal(first.video.paused, false);
  second.play();
  reply.play();
  assert.equal(first.video.paused, false, 'later sibling and reply autoplay do not steal from first focal video');
  assert.equal(second.video.paused, true);
  assert.equal(reply.video.paused, true);

  // Hovering a video post in the timeline while a detail video is actively playing skips speculative video preload.
  const countBeforeHover = prepared.length;
  secondPost.dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }) as unknown as Event);
  t.mock.timers.tick(500);
  assert.equal(prepared.length, countBeforeHover);

  const navigate = t.mock.method(window.location, 'assign', () => {});
  const opened = t.mock.method(window, 'open', () => null);
  reply.player.querySelector<HTMLButtonElement>('[data-site-enhancer-video-expand]')!
    .dispatchEvent(new detail.MouseEvent('click', { bubbles: true, button: 0 }) as unknown as Event);
  reply.player.querySelector<HTMLButtonElement>('.se-subtitle-post')!.click();
  assert.equal(opened.mock.calls[0].arguments[0], 'https://x.com/carol/status/456');
  assert.equal(navigate.mock.callCount(), 0);
});
