import { POST as TWEET, PRIMARY, TEXT, MENU_TRIGGER as CARET, TIMESTAMP, PHOTO_IMAGE } from './x-dom.ts';
import { encodeScreenshot, showScreenshotPreview, type ScreenshotScope } from './x-screenshot-preview.ts';
import { renderPostScreenshot, screenshotPosts, screenshotThreadPosts } from './x-screenshot.ts';
import { copyToClipboard } from './clipboard.ts';
import { createToast } from './toast.ts';
import { resolveLocale } from './i18n.ts';
import type { XCopyFormat } from './x-settings.ts';

const ITEM = 'site-enhancer-menuitem';
const MENU = 'site-enhancer-menu';
const HEIGHT = 'site-enhancer-menu-height';
const icons = {
  image: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v14h14V5H5zm1 12 4-5 3 3 2-2 3 4H6zm2-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  text: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  thread: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h11v2H4v-2z',
};

// Quoted posts can share the outer article, but live inside a separate link.
function belongsToTweet(element: Element, tweet: Element): boolean {
  if (element.closest(TWEET) !== tweet) return false;
  const quote = element.parentElement?.closest('[role="link"], a[href*="/status/"]');
  if (quote && tweet.contains(quote)) return false;
  return !element.matches('[role="link"], a[href*="/status/"]')
    || !element.querySelector(TEXT);
}

/** Restore non-truncated t.co display links to full https:// URLs when copying text. */
function unwrapAnchorText(anchor: Element): string {
  const raw = Array.from(anchor.childNodes, readText).join('');
  const href = anchor.getAttribute('href') ?? '';
  if (!/^https?:\/\/t\.co\//i.test(href)) return raw;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.endsWith('…') || trimmed.endsWith('...')) return raw;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return raw;
}

function readText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.tagName === 'BUTTON') return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') return node.getAttribute('alt') ?? '';
  if (node.tagName === 'A') return unwrapAnchorText(node);
  return Array.from(node.childNodes, readText).join('');
}

export function getTweetData(tweet: Element): { text: string; url: string } {
  const textElement = Array.from(tweet.querySelectorAll(TEXT))
    .find(element => belongsToTweet(element, tweet));
  const text = textElement ? readText(textElement).trim() : '';
  return { text, url: tweetPermalink(tweet) };
}

function tweetPermalink(tweet: Element): string {
  const links = Array.from(tweet.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
    .filter(link => belongsToTweet(link, tweet));
  // The timestamp is the primary permalink; media/analytics links are fallbacks.
  links.sort((a, b) => Number(b.matches(TIMESTAMP)) - Number(a.matches(TIMESTAMP)));
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.getAttribute('href') ?? '', window.location.origin);
    } catch {
      continue;
    }
    const match = url.pathname.match(/^\/(?:[\w]+|i\/web)\/status\/\d+(?=\/|$)/);
    if (/(^|\.)(?:x|twitter)\.com$/.test(url.hostname) && match) {
      return `${url.origin}${match[0]}`;
    }
  }
  return '';
}

function authorFromUrl(url: string): string | undefined {
  try {
    const match = new URL(url).pathname.match(/^\/([\w]+)\/status\/\d+/);
    return match && match[1] !== 'i' ? match[1] : undefined;
  } catch { return undefined; }
}

export function formatTweetCopy(data: { text: string; url: string }, format: XCopyFormat = 'default'): string {
  const { text, url } = data;
  if (format === 'plain') return [text, url].filter(Boolean).join('\n');
  if (format === 'markdown') {
    const author = authorFromUrl(url);
    const quote = text ? text.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n') : '';
    const attribution = url ? `— ${author ? `@${author} ` : ''}[X](${url})` : '';
    return [quote, attribution].filter(Boolean).join('\n\n');
  }
  return [text, url, '#X'].filter(Boolean).join('\n');
}

/** Collect consecutive posts by the same author on a status detail page. */
export function collectThreadPosts(tweet: HTMLElement): HTMLElement[] {
  const doc = tweet.ownerDocument;
  if (!/^\/(?:\w+|i\/web)\/status\/\d+(?:\/|$)/.test(doc.location.pathname)) return [];
  const baseAuthor = authorFromUrl(tweetPermalink(tweet))?.toLowerCase();
  if (!baseAuthor) return [];
  const scope = tweet.closest(PRIMARY) ?? doc;
  const all = Array.from(scope.querySelectorAll<HTMLElement>(TWEET));
  const index = all.indexOf(tweet);
  if (index < 0) return [];
  const matchesAuthor = (el: HTMLElement) => authorFromUrl(tweetPermalink(el))?.toLowerCase() === baseAuthor;
  let start = index;
  while (start > 0 && matchesAuthor(all[start - 1])) start--;
  let end = index;
  while (end < all.length - 1 && matchesAuthor(all[end + 1])) end++;
  return end > start ? all.slice(start, end + 1) : [];
}

function markdownBody(post: HTMLElement, text: string) {
  const images = Array.from(post.querySelectorAll<HTMLImageElement>(PHOTO_IMAGE))
    .filter(img => belongsToTweet(img, post))
    .map(img => {
      try {
        const u = new URL(img.currentSrc || img.src);
        u.searchParams.set('name', 'orig');
        return `![${(img.alt || 'image').replace(/[\[\]]/g, '')}](${u.href})`;
      } catch { return ''; }
    })
    .filter(Boolean);
  return [text, ...images].filter(Boolean).join('\n\n');
}

/** Format a multi-post author thread as Markdown, including original image links. */
export function formatThreadMarkdown(posts: HTMLElement[]): string {
  const parts: string[] = [];
  let rootUrl = '';
  let author: string | undefined;
  for (const post of posts) {
    const { text, url } = getTweetData(post);
    if (!rootUrl && url) { rootUrl = url; author = authorFromUrl(url); }
    const block = markdownBody(post, text);
    if (block) parts.push(block);
  }
  const header = author && rootUrl ? `# @${author} Thread\n\n${rootUrl}\n\n---\n\n` : rootUrl ? `${rootUrl}\n\n---\n\n` : '';
  return header + parts.join('\n\n---\n\n');
}

export function formatScopeText(posts: HTMLElement[], format: XCopyFormat = 'default'): string {
  if (!posts.length) return '';
  if (posts.length === 1) {
    const data = getTweetData(posts[0]);
    return data.text || data.url ? formatTweetCopy(data, format) : '';
  }
  const authors = posts.map(post => authorFromUrl(tweetPermalink(post)));
  if (authors[0] && authors.every(author => author?.toLowerCase() === authors[0]!.toLowerCase())) {
    return formatThreadMarkdown(posts);
  }
  return posts.map((post, i) => {
    const { text, url } = getTweetData(post);
    const attribution = [authors[i] && `**@${authors[i]}**`, url].filter(Boolean).join(' · ');
    return [attribution, markdownBody(post, text)].filter(Boolean).join('\n\n');
  }).filter(Boolean).join('\n\n---\n\n');
}

function previewScopes(tweet: HTMLElement) {
  const parent = screenshotPosts(tweet, tweetPermalink);
  const thread = screenshotThreadPosts(tweet, tweetPermalink);
  const postsByScope = { post: [tweet], parent, thread };
  const ids: ScreenshotScope[] = ['post'];
  if (parent.length > 1) ids.push('parent');
  if (thread.length > parent.length) ids.push('thread');
  const scope = ids[ids.length - 1];
  return { postsByScope, ids, scope, posts: postsByScope[scope] };
}

function screenshotFilename(url: string): string {
  const match = url.match(/\/([\w]+)\/status\/(\d+)/);
  return match ? `${match[1]}_${match[2]}.png` : 'x-post.png';
}

/** Expand a truncated long post before reading its text, if a Show more link is present. */
async function expandShowMore(tweet: HTMLElement): Promise<boolean> {
  const button = Array.from(tweet.querySelectorAll<HTMLElement>('[data-testid="tweet-text-show-more-link"]'))
    .find(el => belongsToTweet(el, tweet));
  if (!button || !button.isConnected) return false;
  const before = getTweetData(tweet).text.length;
  await new Promise<void>(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; observer.disconnect(); clearTimeout(timer); resolve(); } };
    const observer = new MutationObserver(() => {
      if (!button.isConnected || getTweetData(tweet).text.length > before) finish();
    });
    observer.observe(tweet, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(finish, 400);
    button.click();
  });
  return true;
}

export function installXCopyMenu(options: {
  getCopyFormat?: () => XCopyFormat;
  getRounded?: () => boolean;
  setRounded?: (value: boolean) => void;
} = {}): () => void {
  const getLabels = () => {
    const chinese = resolveLocale(document.documentElement.lang || navigator.language) === 'zh';
    return chinese ? {
      image: '复制为图片或文字…', link: '复制推文和链接', text: '仅复制推文文字', url: '复制推文链接',
      thread: '复制串推 (Markdown)', copied: '已复制',
      failed: '复制失败，请重试', empty: '这条推文没有可复制的文字', missing: '无法获取推文链接',
    } : {
      image: 'Copy as image or text…', link: 'Copy post with link', text: 'Copy post text only', url: 'Copy post link',
      thread: 'Copy thread (Markdown)', copied: 'Copied!',
      failed: 'Copy failed. Please try again.', empty: 'This post has no text to copy.', missing: 'Post link unavailable.',
    };
  };
  const toast = createToast();
  const style = document.createElement('style');
  style.textContent = `
    .${ITEM} { appearance:none;border:0;background:transparent;color:inherit;
      width:100%;display:flex;align-items:center;gap:12px;padding:12px 16px;
      font:700 15px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      text-align:start;cursor:pointer;white-space:nowrap;box-sizing:border-box; }
    .${ITEM}:hover, .${ITEM}:focus-visible { background:rgba(128,128,128,.12); }
    .${ITEM}:focus-visible { outline:2px solid #1d9bf0;outline-offset:-2px; }
    .${ITEM} svg { width:20px;height:20px;fill:currentColor;flex-shrink:0; }
    .${MENU} { overflow-y:auto!important;overscroll-behavior:contain; }
    .${HEIGHT} { height:auto!important; }
  `;
  document.head.appendChild(style);

  type Session = {
    trigger: HTMLElement;
    tweet: HTMLElement;
    data: ReturnType<typeof getTweetData>;
    thread: HTMLElement[];
    existing: Set<Element>;
    menu?: HTMLElement;
    heights: Element[];
    maxHeight?: string;
    timer?: ReturnType<typeof setTimeout>;
    idleCapture?: number;
    shot?: { posts: HTMLElement[]; canvas: Promise<HTMLCanvasElement>; observer: MutationObserver };
  };
  let session: Session | undefined;
  let disposed = false;
  let closePreview: (() => void) | undefined;

  function reset() {
    observer.disconnect();
    if (!session) return;
    clearTimeout(session.timer);
    if (session.idleCapture !== undefined) window.cancelIdleCallback(session.idleCapture);
    session.shot?.observer.disconnect();
    session.menu?.querySelectorAll(`.${ITEM}`).forEach(item => item.remove());
    session.menu?.classList.remove(MENU);
    if (session.menu) session.menu.style.maxHeight = session.maxHeight ?? '';
    session.heights.forEach(element => element.classList.remove(HEIGHT));
    session = undefined;
  }

  function dismiss(current: Session) {
    if (current.trigger.hasAttribute('data-slot')) {
      current.menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } else current.trigger.click();
    reset();
  }

  function prepareShot(current: Session) {
    if (session !== current || current.shot || !current.tweet.isConnected) return;
    const { posts } = previewScopes(current.tweet);
    // X may update or recycle a captured article while the menu is open.
    const invalidate = () => {
      changes.disconnect();
      if (current.shot?.observer === changes) current.shot = undefined;
    };
    const changes = new MutationObserver(invalidate);
    for (const post of posts) changes.observe(post, {
      childList: true, subtree: true, characterData: true, attributes: true,
    });
    const canvas = renderPostScreenshot(posts);
    current.shot = { posts, canvas, observer: changes };
    void canvas.then(image => {
      if (session === current && current.shot?.canvas === canvas) {
        // A user who selects the warmed item can copy the same PNG immediately.
        void encodeScreenshot(image).catch(() => {});
      }
    }, invalidate);
  }

  function createItem(kind: 'link' | 'text' | 'url' | 'image' | 'thread', current: Session) {
    const labels = getLabels();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ITEM;
    button.setAttribute('role', 'menuitem');
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[kind === 'url' ? 'link' : kind]}"></path></svg>`;
    const label = document.createElement('span');
    label.textContent = labels[kind];
    button.appendChild(label);
    if (kind === 'image') {
      const warm = () => prepareShot(current);
      button.addEventListener('pointerenter', warm, { once: true });
      button.addEventListener('focus', warm, { once: true });
    }
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const t = getLabels();
      if (kind === 'image') {
        if (!current.tweet.isConnected || tweetPermalink(current.tweet) !== current.data.url) { toast.show(t.failed); return; }
        const { postsByScope, ids, scope, posts } = previewScopes(current.tweet);
        const shot = current.shot;
        const canvas = shot && !shot.observer.takeRecords().length &&
          shot.posts.length === posts.length && posts.every((post, index) => post === shot.posts[index])
          ? shot.canvas.catch(() => renderPostScreenshot(posts))
          : renderPostScreenshot(posts);
        const filename = screenshotFilename(current.data.url);
        dismiss(current);
        closePreview?.();
        closePreview = showScreenshotPreview(document, canvas, current.trigger, {
          onClose: () => { closePreview = undefined; },
          filename,
          scopes: ids.map(id => ({ id, count: postsByScope[id].length })),
          scope,
          rounded: options.getRounded?.(),
          onRoundedChange: options.setRounded,
          copyText: async (id, invalidate) => {
            const selected = postsByScope[id];
            const expanded = await Promise.all(selected.map(expandShowMore));
            if (expanded.some(Boolean)) invalidate();
            return formatScopeText(selected, options.getCopyFormat?.());
          },
          rerender: ({ hideMetrics, scope }) => renderPostScreenshot(postsByScope[scope], { hideMetrics }),
        });
        return;
      }
      if (kind === 'thread') {
        const md = formatThreadMarkdown(current.thread);
        if (!md) { toast.show(t.empty); return; }
        const result = copyToClipboard(md);
        dismiss(current);
        current.trigger.focus({ preventScroll: true });
        const success = await result;
        if (!disposed) toast.show(success ? t.copied : t.failed);
        return;
      }
      let { text, url } = current.data;
      if ((kind === 'text' || kind === 'link') && current.tweet.isConnected) {
        const expanded = await expandShowMore(current.tweet);
        if (expanded) {
          const fresh = getTweetData(current.tweet);
          if (fresh.url === url || !url) text = fresh.text || text;
        }
      }
      if (kind === 'text' && !text) { toast.show(t.empty); return; }
      if (kind !== 'text' && !url) { toast.show(t.missing); return; }
      const value = kind === 'text' ? text : kind === 'url' ? url : formatTweetCopy({ text, url }, options.getCopyFormat?.() ?? 'default');
      // Start the write within the user gesture before closing the native menu.
      const result = copyToClipboard(value);
      dismiss(current);
      current.trigger.focus({ preventScroll: true });
      const success = await result;
      if (!disposed) toast.show(success ? t.copied : t.failed);
    });
    return button;
  }

  function syncMenu() {
    const current = session;
    if (!current) return;
    if (current.menu && !current.menu.isConnected) { reset(); return; }
    if (!current.menu) {
      // X renders this menu in a portal outside the tweet.
      current.menu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'))
        .find(menu => !current.existing.has(menu) && menu.getClientRects().length > 0);
      if (!current.menu) return;
      clearTimeout(current.timer);
      if (window.requestIdleCallback) {
        current.idleCapture = window.requestIdleCallback(() => prepareShot(current));
      }
      current.maxHeight = current.menu.style.maxHeight;
      current.menu.classList.add(MENU);
      observer.observe(current.menu, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['style'],
      });
    }
    const menu = current.menu;
    const maxHeight = `${Math.max(44, window.innerHeight - Math.max(8, menu.getBoundingClientRect().top) - 8)}px`;
    if (menu.style.maxHeight !== maxHeight) menu.style.maxHeight = maxHeight;
    const dropdown = menu.querySelector('[data-testid="Dropdown"]') ?? menu;
    // Native opening animations fix the wrapper height to the original items.
    for (let parent = dropdown === menu ? null : dropdown.parentElement; parent && parent !== menu; parent = parent.parentElement) {
      if (parent.style.height && !parent.classList.contains(HEIGHT)) {
        parent.classList.add(HEIGHT);
        current.heights.push(parent);
      }
    }
    const kinds: ('link' | 'text' | 'url' | 'image' | 'thread')[] = ['link', 'text', 'url', 'image'];
    if (current.thread.length >= 2) kinds.push('thread');
    const existingItems = Array.from(menu.querySelectorAll(`.${ITEM}`));
    if (existingItems.length === kinds.length && existingItems.every(item => dropdown.contains(item))) return;
    // X can move native items into Dropdown after initially mounting the menu.
    existingItems.forEach(item => item.remove());
    const nativeItem = dropdown.querySelector<HTMLElement>('[role="menuitem"]');
    if (!nativeItem) return;
    const color = getComputedStyle(nativeItem.querySelector('span') ?? nativeItem).color;
    const items = kinds.map(kind => createItem(kind, current));
    for (const item of items) item.style.color = color;
    nativeItem.before(...items);
  }

  const observer = new MutationObserver(syncMenu);

  function start(trigger: HTMLElement) {
    const tweet = trigger.closest(TWEET);
    if (!tweet) { reset(); return; }
    reset();
    const tweetEl = tweet as HTMLElement;
    session = {
      trigger, tweet: tweetEl, data: getTweetData(tweetEl), thread: collectThreadPosts(tweetEl), heights: [],
      existing: new Set(document.querySelectorAll('[role="menu"]')),
    };
    // Observe only while opening/using a tweet menu, not while scrolling the feed.
    observer.observe(document.body, { childList: true, subtree: true });
    session.timer = setTimeout(() => { if (!session?.menu) reset(); }, 2000);
  }

  // Base UI opens on pointer-down, before click capture sees the portal.
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const trigger = event.target.closest<HTMLElement>(CARET);
    if (trigger?.hasAttribute('data-slot')) start(trigger);
  }

  function onClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest<HTMLElement>(CARET);
    // A keyboard activation already started this session from keydown.
    if (trigger && session?.trigger === trigger && (event.detail === 0 || trigger.hasAttribute('data-slot'))) return;
    if (trigger) { start(trigger); return; }
    if (!session?.menu?.contains(event.target)) reset();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest<HTMLElement>(CARET);
    // X opens its menu on keydown and cancels the default, so Enter/Space
    // do not reliably produce a click on the caret.
    if (trigger && ['ArrowDown', 'Enter', ' '].includes(event.key)) { start(trigger); return; }
    if (event.key === 'Escape') { reset(); return; }
    const menu = session?.menu;
    if (!menu?.contains(event.target)) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .filter(item => item.getAttribute('aria-disabled') !== 'true' && item.getClientRects().length > 0);
    const index = items.findIndex(item => item.contains(event.target as Node));
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (index + 1) % items.length; break;
      case 'ArrowUp': next = (index - 1 + items.length) % items.length; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default:
        if (event.target.closest(`.${ITEM}`) && ['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          (event.target.closest(`.${ITEM}`) as HTMLElement).click();
        }
        return;
    }
    if (!items.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    items[next]?.focus();
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('popstate', reset);
  window.addEventListener('resize', syncMenu);
  return () => {
    disposed = true;
    closePreview?.();
    reset();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('popstate', reset);
    window.removeEventListener('resize', syncMenu);
    style.remove();
    toast.remove();
  };
}
