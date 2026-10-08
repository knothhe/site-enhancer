import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { getTweetData, installXCopyMenu } from '../utils/x-menu.ts';
import { copyToClipboard } from '../utils/clipboard.ts';

let win: Window;
let cleanup: (() => void) | undefined;
let copied: string[];

beforeEach(() => {
  win = new Window({ url: 'https://x.com/home' });
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'MutationObserver']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : (win as any)[name] });
  }
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: win.getComputedStyle.bind(win) });
  // happy-dom has no layout engine; model the visible menu and its items.
  win.HTMLElement.prototype.getClientRects = function () { return [{}] as any; };
  copied = [];
  Object.defineProperty(win.navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => { copied.push(text); } });
});
afterEach(async () => { cleanup?.(); cleanup = undefined; await win.happyDOM.close(); });

function tweet(text = 'Hello<br>world<img alt="😊">', id = '123') {
  const article = document.createElement('article');
  article.dataset.testid = 'tweet';
  article.innerHTML = `<a href="/author/status/${id}?s=20"><time>Today</time></a>
    <button data-testid="caret" aria-haspopup="menu">More</button>
    ${text ? `<div data-testid="tweetText">${text}</div>` : ''}`;
  document.body.appendChild(article);
  return article;
}
function menu() {
  const portal = document.createElement('div');
  portal.setAttribute('role', 'menu');
  portal.innerHTML = '<div style="height:44px"><div data-testid="Dropdown"><div role="menuitem" tabindex="0"><span>Native action</span></div></div></div>';
  document.body.appendChild(portal);
  return portal;
}
async function flush() { await win.happyDOM.waitUntilComplete(); }
async function open(article: Element) {
  (article.querySelector('[data-testid="caret"]') as HTMLElement).click();
  const portal = menu();
  await flush();
  return portal;
}

test('keeps line breaks/emoji and strips tracking from the primary permalink', () => {
  assert.deepEqual(getTweetData(tweet()), { text: 'Hello\nworld😊', url: 'https://x.com/author/status/123' });
});

test('does not copy quoted text or a nested quoted permalink', () => {
  const article = tweet('Outer text');
  article.insertAdjacentHTML('afterbegin', '<div role="link"><a href="/quoted/status/999"><time>Yesterday</time></a><div data-testid="tweetText">Quoted text</div></div>');
  assert.deepEqual(getTweetData(article), { text: 'Outer text', url: 'https://x.com/author/status/123' });
  article.querySelector(':scope > [data-testid="tweetText"]')?.remove();
  assert.equal(getTweetData(article).text, '');
});

test('normalizes media links and supports twitter.com', () => {
  const article = tweet('Text');
  article.querySelector('a')!.href = 'https://twitter.com/author/status/123/photo/1?ref=share';
  assert.equal(getTweetData(article).url, 'https://twitter.com/author/status/123');
});

test('injects only into the tweet More menu and handles rerender without duplicates', async () => {
  const article = tweet();
  cleanup = installXCopyMenu();
  assert.equal(article.querySelectorAll('button').length, 1);
  const unrelated = menu();
  await flush();
  assert.equal(unrelated.querySelectorAll('.site-enhancer-menuitem').length, 0);
  unrelated.remove();
  const portal = await open(article);
  assert.equal(portal.querySelectorAll('.site-enhancer-menuitem').length, 2);
  assert.ok(portal.querySelector('.site-enhancer-menu-height'));
  portal.querySelector('[data-testid="Dropdown"]')!.appendChild(document.createElement('span'));
  await flush();
  assert.equal(portal.querySelectorAll('.site-enhancer-menuitem').length, 2);
});

test('does not duplicate actions when X wraps menu content after mounting', async () => {
  cleanup = installXCopyMenu();
  const article = tweet();
  (article.querySelector('[data-testid="caret"]') as HTMLElement).click();
  const portal = document.createElement('div');
  portal.setAttribute('role', 'menu');
  portal.innerHTML = '<div role="menuitem" tabindex="0">Native action</div>';
  document.body.appendChild(portal);
  await flush();
  const dropdown = document.createElement('div');
  dropdown.dataset.testid = 'Dropdown';
  dropdown.appendChild(portal.querySelector('[role="menuitem"]:not(.site-enhancer-menuitem)')!);
  portal.appendChild(dropdown);
  await flush();
  assert.equal(portal.querySelectorAll('.site-enhancer-menuitem').length, 2);
  assert.equal(dropdown.querySelectorAll('.site-enhancer-menuitem').length, 2);
});

test('copies the selected tweet snapshot even if its virtualized DOM is recycled', async () => {
  const article = tweet('Original', '123');
  cleanup = installXCopyMenu();
  const portal = await open(article);
  article.querySelector('[data-testid="tweetText"]')!.textContent = 'Recycled';
  article.querySelector('a')!.href = '/other/status/456';
  (portal.querySelector('.site-enhancer-menuitem') as HTMLElement).click();
  await flush();
  assert.deepEqual(copied, ['Original\nhttps://x.com/author/status/123\n#X']);
});

test('binds reopened menus to the new tweet and supports text-only copy', async () => {
  cleanup = installXCopyMenu();
  const first = await open(tweet('First', '123'));
  first.remove();
  await flush();
  const second = await open(tweet('Second', '456'));
  (second.querySelectorAll('.site-enhancer-menuitem')[1] as HTMLElement).click();
  await flush();
  assert.deepEqual(copied, ['Second']);
});

test('allows media-only link copying and reports empty text accurately', async () => {
  cleanup = installXCopyMenu();
  const portal = await open(tweet(''));
  (portal.querySelectorAll('.site-enhancer-menuitem')[1] as HTMLElement).click();
  await flush();
  assert.deepEqual(copied, []);
  assert.match(document.querySelector('[role="status"]')!.textContent!, /no text/);
  (portal.querySelector('.site-enhancer-menuitem') as HTMLElement).click();
  await flush();
  assert.deepEqual(copied, ['https://x.com/author/status/123\n#X']);
});

test('reports failure when both clipboard APIs fail and removes fallback textarea', async () => {
  Object.defineProperty(win.navigator.clipboard, 'writeText', { value: async () => { throw new Error('Denied'); } });
  document.execCommand = () => false;
  cleanup = installXCopyMenu();
  const portal = await open(tweet());
  (portal.querySelector('.site-enhancer-menuitem') as HTMLElement).click();
  await flush();
  assert.match(document.querySelector('[role="status"]')!.textContent!, /failed/i);
  assert.equal(document.querySelector('textarea'), null);
});

test('fallback returns the actual result and restores focus', async () => {
  Object.defineProperty(win.navigator.clipboard, 'writeText', { value: async () => { throw new Error('Denied'); } });
  document.execCommand = () => true;
  const button = document.createElement('button');
  document.body.appendChild(button);
  button.focus();
  assert.equal(await copyToClipboard('Test'), true);
  assert.equal(document.activeElement, button);
  assert.equal(document.querySelector('textarea'), null);
});

test('includes custom items in keyboard navigation and cleans up on invalidation', async () => {
  document.documentElement.lang = 'zh-CN';
  cleanup = installXCopyMenu();
  const portal = await open(tweet());
  const native = portal.querySelector<HTMLElement>('[role="menuitem"]:not(.site-enhancer-menuitem)')!;
  native.focus();
  native.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }) as any);
  assert.equal(document.activeElement?.textContent, '复制推文和链接');
  cleanup(); cleanup = undefined;
  assert.equal(document.querySelector('.site-enhancer-menuitem'), null);
  assert.equal(document.querySelector('.site-enhancer-menu-height'), null);
  assert.equal(document.querySelector('[role="status"]'), null);
});
