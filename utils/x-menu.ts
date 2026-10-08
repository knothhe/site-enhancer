import { copyToClipboard } from './clipboard.ts';
import { createToast } from './toast.ts';

const TWEET = '[data-testid="tweet"]';
const CARET = '[data-testid="caret"]';
const ITEM = 'site-enhancer-menuitem';
const MENU = 'site-enhancer-menu';
const HEIGHT = 'site-enhancer-menu-height';
const icons = {
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  text: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
};

// Quoted posts can share the outer article, but live inside a separate link.
function belongsToTweet(element: Element, tweet: Element): boolean {
  if (element.closest(TWEET) !== tweet) return false;
  const quote = element.parentElement?.closest('[role="link"], a[href*="/status/"]');
  if (quote && tweet.contains(quote)) return false;
  return !element.matches('[role="link"], a[href*="/status/"]')
    || !element.querySelector('[data-testid="tweetText"]');
}

function readText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') return node.getAttribute('alt') ?? '';
  return Array.from(node.childNodes, readText).join('');
}

export function getTweetData(tweet: Element): { text: string; url: string } {
  const textElement = Array.from(tweet.querySelectorAll('[data-testid="tweetText"]'))
    .find(element => belongsToTweet(element, tweet));
  const text = textElement ? readText(textElement).trim() : '';
  const links = Array.from(tweet.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
    .filter(link => belongsToTweet(link, tweet));
  // The timestamp is the primary permalink; media/analytics links are fallbacks.
  links.sort((a, b) => Number(!!b.querySelector('time')) - Number(!!a.querySelector('time')));
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.getAttribute('href') ?? '', window.location.origin);
    } catch {
      continue;
    }
    const match = url.pathname.match(/^\/(?:[\w]+|i\/web)\/status\/\d+(?=\/|$)/);
    if (/(^|\.)(?:x|twitter)\.com$/.test(url.hostname) && match) {
      return { text, url: `${url.origin}${match[0]}` };
    }
  }
  return { text, url: '' };
}

export function installXCopyMenu(): () => void {
  const chinese = document.documentElement.lang.toLowerCase().startsWith('zh');
  const labels = chinese ? {
    link: '复制推文和链接', text: '仅复制推文文字', copied: '已复制',
    failed: '复制失败，请重试', empty: '这条推文没有可复制的文字', missing: '无法获取推文链接',
  } : {
    link: 'Copy post with link', text: 'Copy post text only', copied: 'Copied!',
    failed: 'Copy failed. Please try again.', empty: 'This post has no text to copy.', missing: 'Post link unavailable.',
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
    data: ReturnType<typeof getTweetData>;
    existing: Set<Element>;
    menu?: HTMLElement;
    heights: Element[];
    maxHeight?: string;
    timer?: ReturnType<typeof setTimeout>;
  };
  let session: Session | undefined;
  let disposed = false;

  function reset() {
    observer.disconnect();
    if (!session) return;
    clearTimeout(session.timer);
    session.menu?.querySelectorAll(`.${ITEM}`).forEach(item => item.remove());
    session.menu?.classList.remove(MENU);
    if (session.menu) session.menu.style.maxHeight = session.maxHeight ?? '';
    session.heights.forEach(element => element.classList.remove(HEIGHT));
    session = undefined;
  }

  function createItem(kind: 'link' | 'text', current: Session) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ITEM;
    button.setAttribute('role', 'menuitem');
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[kind]}"></path></svg>`;
    const label = document.createElement('span');
    label.textContent = labels[kind];
    button.appendChild(label);
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const { text, url } = current.data;
      if (kind === 'text' && !text) { toast.show(labels.empty); return; }
      if (kind === 'link' && !url) { toast.show(labels.missing); return; }
      const value = kind === 'text' ? text : [text, url, '#X'].filter(Boolean).join('\n');
      // Start the write within the user gesture before closing the native menu.
      const result = copyToClipboard(value);
      current.trigger.click();
      reset();
      current.trigger.focus({ preventScroll: true });
      const success = await result;
      if (!disposed) toast.show(success ? labels.copied : labels.failed);
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
    for (let parent = dropdown.parentElement; parent && parent !== menu; parent = parent.parentElement) {
      if (parent.style.height && !parent.classList.contains(HEIGHT)) {
        parent.classList.add(HEIGHT);
        current.heights.push(parent);
      }
    }
    const existingItems = Array.from(menu.querySelectorAll(`.${ITEM}`));
    if (existingItems.length === 2 && existingItems.every(item => dropdown.contains(item))) return;
    // X can move native items into Dropdown after initially mounting the menu.
    existingItems.forEach(item => item.remove());
    const nativeItem = dropdown.querySelector<HTMLElement>('[role="menuitem"]');
    if (!nativeItem) return;
    const color = getComputedStyle(nativeItem.querySelector('span') ?? nativeItem).color;
    const link = createItem('link', current);
    const text = createItem('text', current);
    link.style.color = text.style.color = color;
    nativeItem.before(link, text);
  }

  const observer = new MutationObserver(syncMenu);

  function start(trigger: HTMLElement) {
    const tweet = trigger.closest(TWEET);
    if (!tweet) { reset(); return; }
    reset();
    session = {
      trigger, data: getTweetData(tweet), heights: [],
      existing: new Set(document.querySelectorAll('[role="menu"]')),
    };
    // Observe only while opening/using a tweet menu, not while scrolling the feed.
    observer.observe(document.body, { childList: true, subtree: true });
    session.timer = setTimeout(() => { if (!session?.menu) reset(); }, 2000);
  }

  function onClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest<HTMLElement>(CARET);
    if (trigger) { start(trigger); return; }
    if (!session?.menu?.contains(event.target)) reset();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest<HTMLElement>(CARET);
    // Enter/Space produce a click; ArrowDown can open a native menu directly.
    if (trigger && event.key === 'ArrowDown') { start(trigger); return; }
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

  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('popstate', reset);
  window.addEventListener('resize', syncMenu);
  return () => {
    disposed = true;
    reset();
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('popstate', reset);
    window.removeEventListener('resize', syncMenu);
    style.remove();
    toast.remove();
  };
}
