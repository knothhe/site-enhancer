import { DETAIL_READY_MESSAGE, observeDetailReady } from '../utils/x-detail-ready.ts';
import { test, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { columnGeometry, parseColumnWidths, detailUrl, postPermalink, installXColumns, COLUMNS_WIDTH_KEY } from '../utils/x-columns.ts';

import { QUOTE_REQUEST, QUOTE_URL, quoteComponentPath, normalizeQuoteUrl } from '../utils/x-quote.ts';

let win: Window;
let columns: ReturnType<typeof installXColumns> | undefined;
beforeEach(() => {
  win = new Window({ url: 'https://x.com/home', width: 1440, settings: { disableIframePageLoading: true } });
  // State tests use reduced motion; animation behavior is tested with a controlled timeline below.
  const matchMedia = win.matchMedia.bind(win);
  win.matchMedia = query => { const result = matchMedia(query); if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(result, 'matches', { value: true }); return result; };
  for (const name of ['window', 'document', 'location', 'localStorage', 'Element', 'MutationObserver', 'getComputedStyle']) {
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

test('width preferences reject invalid values and preserve valid explicit values', () => {
  for (const value of [null, {}, { nav: 0, share: .5 }, { nav: 200, share: Infinity }, { nav: 200, share: .01 }]) {
    assert.deepEqual(parseColumnWidths(value), { nav: 200, share: .52 });
  }
  assert.deepEqual(parseColumnWidths({ nav: 88, share: .4 }), { nav: 88, share: .4 });
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
  // happy-dom does not implement the browser top layer. Browser verification
  // covers rendering; this shim exercises ownership, cleanup and focus state.
  let popover = false;
  player.showPopover = () => { popover = true; };
  player.hidePopover = () => { popover = false; };
  const matches = player.matches.bind(player);
  player.matches = selector => selector === ':popover-open' ? popover : matches(selector);
  return { player, video, play, pauses: () => pauses };
}

test('native video overlays and progress controls never navigate to post details', () => {
  addVideo(); start();
  for (const selector of ['video', '[data-video-overlay]', '[data-video-progress]']) {
    assert.equal(click(selector).defaultPrevented, false);
  }
  assert.equal(document.querySelector('iframe'), null);
});

test('opening details pauses feed videos and blocks later autoplay until details close', () => {
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

test('video expansion keeps the original node and source, then restores focus and page interaction', () => {
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
  assert.equal(player.getAttribute('role'), 'dialog');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector<HTMLElement>('#site-enhancer-columns')!.inert, true);
  button.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
  assert.equal(player.hasAttribute('popover'), false);
  assert.equal(player.hasAttribute('data-site-enhancer-video-expanded'), false);
  assert.equal(document.querySelector<HTMLElement>('#site-enhancer-columns')!.inert, false);
  assert.equal(document.activeElement, button);
  click('[data-site-enhancer-video-expand]');
  columns!.setEnabled(false);
  assert.equal(player.hasAttribute('popover'), false);
  assert.equal(player.querySelector('button'), null);
});

test('detail video expands its own frame and cached hidden details cannot autoplay', t => {
  start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const { player, video, play } = addVideo(detail.document as unknown as Document);
  signalDetail(detail);
  player.querySelector('button')!.dispatchEvent(new detail.MouseEvent('click', { bubbles: true, button: 0 }) as unknown as Event);
  assert.equal(frame.hasAttribute('data-site-enhancer-video-frame'), true);
  assert.equal(player.querySelector('video'), video);
  selectDetail(456);
  assert.equal(frame.hasAttribute('data-site-enhancer-video-frame'), false);
  assert.equal(player.hasAttribute('popover'), false);
  assert.equal(video.paused, true);
  play(); assert.equal(video.paused, true);
  selectDetail(123);
  play(); assert.equal(video.paused, false);
});

test('an explicitly expanded feed video can play alone and pauses again when collapsed over details', t => {
  const feed = addVideo(); start();
  const frame = selectDetail(123);
  const detail = attachReadyDetail(t, frame, 'https://x.com/alice/status/123');
  const other = addVideo(detail.document as unknown as Document);
  signalDetail(detail);
  click('[data-site-enhancer-video-expand]');
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
  assert.equal(player.hasAttribute('popover'), false);
  assert.equal(document.querySelector<HTMLElement>('#site-enhancer-columns')!.inert, false);
  assert.equal(document.querySelector('[data-site-enhancer-video-expand]'), null);
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
  let calls = 0;
  const stop = observeDetailReady(detail.document as unknown as Document, () => { calls++; });
  detail.document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"></article></div>';
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
