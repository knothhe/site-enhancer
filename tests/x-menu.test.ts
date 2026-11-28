import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { collectThreadPosts, formatScopeText, formatThreadMarkdown, formatTweetCopy, getTweetData, installXCopyMenu } from '../utils/x-menu.ts';
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
  assert.equal(portal.querySelectorAll('.site-enhancer-menuitem').length, 4);
  assert.ok(portal.querySelector('.site-enhancer-menu-height'));
  portal.querySelector('[data-testid="Dropdown"]')!.appendChild(document.createElement('span'));
  await flush();
  assert.equal(portal.querySelectorAll('.site-enhancer-menuitem').length, 4);
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
  assert.equal(portal.querySelectorAll('.site-enhancer-menuitem').length, 4);
  assert.equal(dropdown.querySelectorAll('.site-enhancer-menuitem').length, 4);
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


test('copies only the canonical URL without text, tracking or hashtag', async () => {
  cleanup = installXCopyMenu();
  const portal = await open(tweet());
  const item = portal.querySelectorAll<HTMLButtonElement>('.site-enhancer-menuitem')[2];
  assert.equal(item.textContent, 'Copy post link');
  item.click();
  await flush();
  assert.deepEqual(copied, ['https://x.com/author/status/123']);
});

test('URL-only copy reports a missing permalink instead of copying empty text', async () => {
  const article = tweet();
  article.querySelector('a')!.remove();
  cleanup = installXCopyMenu();
  const portal = await open(article);
  portal.querySelectorAll<HTMLButtonElement>('.site-enhancer-menuitem')[2].click();
  await flush();
  assert.deepEqual(copied, []);
  assert.match(document.body.textContent!, /Post link unavailable/);
});

test('adds actions when X opens the menu from a cancelled Enter or Space keydown', async () => {
  cleanup = installXCopyMenu();
  for (const key of ['Enter', ' ']) {
    const caret = tweet('Keyboard', key === 'Enter' ? '7' : '8').querySelector<HTMLElement>('[data-testid="caret"]')!;
    caret.addEventListener('keydown', event => event.preventDefault(), { once: true });
    caret.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }) as any);
    const portal = menu();
    await flush();
    const items = portal.querySelectorAll<HTMLButtonElement>('.site-enhancer-menuitem');
    assert.equal(items.length, 4);
    items[2].click();
    await flush();
    portal.remove();
    await flush();
  }
  assert.deepEqual(copied, ['https://x.com/author/status/7', 'https://x.com/author/status/8']);
});

test('a keyboard click after keydown keeps the menu session', async () => {
  cleanup = installXCopyMenu();
  const caret = tweet().querySelector<HTMLElement>('[data-testid="caret"]')!;
  caret.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) as any);
  const portal = menu();
  await flush();
  caret.dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 0 }) as any);
  await flush();
  assert.equal(portal.querySelectorAll('.site-enhancer-menuitem').length, 4);
});

test('offers screenshot copying even for posts without text', async () => {
  cleanup = installXCopyMenu();
  const portal = await open(tweet(''));
  const item = Array.from(portal.querySelectorAll('.site-enhancer-menuitem')).find(node => node.textContent === 'Copy as image or text…');
  assert.ok(item);
});

test('unwraps non-truncated t.co links while preserving truncated display text', () => {
  const full = tweet('Check <a href="https://t.co/abc123">example.com/docs</a> and <a href="https://t.co/xyz">https://foo.bar/a</a>');
  assert.equal(getTweetData(full).text, 'Check https://example.com/docs and https://foo.bar/a');
  const truncated = tweet('See <a href="https://t.co/trunc">example.com/very/long…</a>');
  assert.equal(getTweetData(truncated).text, 'See example.com/very/long…');
});

test('formats tweet copy output for default, plain and markdown templates', () => {
  const data = { text: 'Line 1\nLine 2', url: 'https://x.com/alice/status/123' };
  assert.equal(formatTweetCopy(data, 'default'), 'Line 1\nLine 2\nhttps://x.com/alice/status/123\n#X');
  assert.equal(formatTweetCopy(data, 'plain'), 'Line 1\nLine 2\nhttps://x.com/alice/status/123');
  assert.equal(formatTweetCopy(data, 'markdown'), '> Line 1\n> Line 2\n\n— @alice [X](https://x.com/alice/status/123)');
});

test('reacts to dynamic html lang changes on subsequent menu opens', async () => {
  document.documentElement.lang = 'en';
  cleanup = installXCopyMenu({ getCopyFormat: () => 'plain' });
  const first = await open(tweet('Hello', '1'));
  assert.equal(first.querySelector('.site-enhancer-menuitem')?.textContent, 'Copy post with link');
  first.remove();
  await flush();
  document.documentElement.lang = 'zh-CN';
  const second = await open(tweet('你好', '2'));
  const item = second.querySelector<HTMLButtonElement>('.site-enhancer-menuitem')!;
  assert.equal(item.textContent, '复制推文和链接');
  item.click();
  await flush();
  assert.deepEqual(copied, ['你好\nhttps://x.com/author/status/2']);
});

test('collects multi-post author thread on status page and offers thread markdown copy', async () => {
  win.happyDOM.setURL('https://x.com/author/status/10');
  const main = document.createElement('div');
  main.dataset.testid = 'primaryColumn';
  const p1 = tweet('First part', '10');
  const p2 = tweet('Second part', '11');
  const reply = document.createElement('article');
  reply.dataset.testid = 'tweet';
  reply.innerHTML = '<a href="/someone/status/12"><time>Now</time></a><div data-testid="tweetText">Other reply</div>';
  main.append(p1, p2, reply);
  document.body.append(main);
  const thread = collectThreadPosts(p1 as unknown as HTMLElement);
  assert.equal(thread.length, 2);
  const md = formatThreadMarkdown(thread);
  assert.match(md, /# @author Thread/);
  assert.match(md, /First part/);
  assert.match(md, /Second part/);
  assert.ok(!md.includes('Other reply'));

  cleanup = installXCopyMenu();
  const portal = await open(p1);
  const items = portal.querySelectorAll<HTMLButtonElement>('.site-enhancer-menuitem');
  assert.equal(items.length, 5);
  assert.equal(items[4].textContent, 'Copy thread (Markdown)');
  items[4].click();
  await flush();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /First part[\s\S]*Second part/);
});

test('scope text preserves the post template, thread Markdown and per-author attribution', () => {
  const first = tweet('One', '1'), second = tweet('Two', '2');
  second.insertAdjacentHTML('beforeend', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/a?name=small" alt="Photo"></div>');
  assert.equal(formatScopeText([first], 'plain'), 'One\nhttps://x.com/author/status/1');
  assert.equal(formatScopeText([first, second]), formatThreadMarkdown([first, second]));
  second.querySelector('a')!.href = '/bob/status/2';
  assert.equal(formatScopeText([first, second]), [
    '**@author** · https://x.com/author/status/1', 'One', '---',
    '**@bob** · https://x.com/bob/status/2', 'Two', '![Photo](https://pbs.twimg.com/media/a?name=orig)',
  ].join('\n\n'));
});

test('first post defaults to its connected thread and text copy expands the continuation', async () => {
  Object.defineProperty(win, 'ClipboardItem', { value: undefined });
  win.happyDOM.setURL('https://x.com/author/status/10');
  const column = document.createElement('main');
  column.dataset.testid = 'primaryColumn';
  const root = tweet('First', '10'), next = tweet('Short', '11'), unrelated = tweet('Separate', '12');
  column.append(root, next, unrelated);
  document.body.append(column);
  const rail = '<span style="background-color:gray"></span>';
  root.insertAdjacentHTML('afterbegin', '<div><div data-post-avatar></div>' + rail + '</div>');
  next.insertAdjacentHTML('afterbegin', '<div>' + rail + '<div data-post-avatar></div></div>');
  root.querySelector('span')!.getBoundingClientRect = () => new win.DOMRect(0, 0, 2, 10) as DOMRect;
  next.querySelector('span')!.getBoundingClientRect = () => new win.DOMRect(0, 10, 2, 10) as DOMRect;
  const more = document.createElement('button');
  more.dataset.testid = 'tweet-text-show-more-link';
  next.append(more);
  more.onclick = () => {
    next.querySelector('[data-testid=tweetText]')!.textContent = 'Expanded continuation';
    more.remove();
  };
  cleanup = installXCopyMenu();
  const portal = await open(root);
  portal.querySelectorAll<HTMLButtonElement>('.site-enhancer-menuitem')[3].click();
  const dialog = document.querySelector('dialog')!;
  assert.equal(dialog.getAttribute('aria-label'), 'Copy preview');
  assert.equal(dialog.querySelector('[role=radio][aria-checked=true]')?.textContent, 'Full thread · 2');
  dialog.querySelector<HTMLButtonElement>('[data-copy-text]')!.click();
  await flush();
  assert.deepEqual(copied, [formatThreadMarkdown([root, next])]);
  assert.match(copied[0], /Expanded continuation/);
});
