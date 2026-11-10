import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { columnGeometry, parseColumnWidths, detailUrl, postPermalink, installXColumns, COLUMNS_WIDTH_KEY } from '../utils/x-columns.ts';

import { QUOTE_REQUEST, QUOTE_URL, quoteComponentPath, normalizeQuoteUrl } from '../utils/x-quote.ts';

let win: Window;
let columns: ReturnType<typeof installXColumns> | undefined;
beforeEach(() => {
  win = new Window({ url: 'https://x.com/home', width: 1440, settings: { disableIframePageLoading: true } });
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
  const frame = document.querySelector('iframe')!;
  const detailWindow = new Window({ url: 'https://x.com/alice/status/123' });
  t.after(() => detailWindow.happyDOM.close());
  const doc = detailWindow.document;
  Object.defineProperty(frame, 'contentDocument', { value: doc });
  doc.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><a href="https://x.com/alice/status/123"><time>Now</time></a><div role="link" id="quote">Quoted post</div></article></div>';
  const card = doc.querySelector('#quote')!;
  card.addEventListener(QUOTE_REQUEST, () => card.setAttribute(QUOTE_URL, '/quoted/status/456'));
  t.mock.timers.tick(250);
  card.dispatchEvent(new detailWindow.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(document.querySelector('iframe')?.src, 'https://x.com/quoted/status/456');
  assert.notEqual(document.querySelector('iframe'), frame);
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
