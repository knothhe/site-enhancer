// Discourse renders image filename/size captions inside lightboxes; they are not post text.
const IGNORED = '.lightbox-wrapper .meta, .cooked-selection-barrier';

export function linuxDoLabels(language = document.documentElement.lang || navigator.language) {
  return language.toLowerCase().startsWith('zh') ? {
    text: '仅复制帖子文字', link: '复制帖子和链接', copiedText: '已复制文字',
    copiedLink: '已复制帖子和链接', failed: '复制失败，请重试', empty: '这条帖子没有可复制的文字',
  } : {
    text: 'Copy post text only', link: 'Copy post with link', copiedText: 'Copied text!',
    copiedLink: 'Copied with link!', failed: 'Failed to copy', empty: 'No post text to copy',
  };
}

export function getPostText(post: Element): string | null {
  for (const selector of ['.cooked', '.post-content', '.topic-body', '[itemprop="articleBody"]']) {
    const content = post.querySelector(selector);
    if (!content) continue;
    // Hide captions only while reading layout-aware text; no frame is painted in between.
    const hidden = Array.from(content.querySelectorAll<HTMLElement>(IGNORED), element => {
      const style = element.getAttribute('style');
      element.style.setProperty('display', 'none', 'important');
      return () => style === null ? element.removeAttribute('style') : element.setAttribute('style', style);
    });
    let text: string;
    try {
      text = ((content instanceof HTMLElement ? content.innerText : content.textContent) ?? '').trim();
    } finally {
      hidden.forEach(restore => restore());
    }
    if (text) return text;
  }
  return null;
}

export function getPostUrl(post: Element, location: Location = window.location): string {
  // The post date links to this post; links inside the body may point elsewhere.
  const href = post.querySelector('a.post-date[href], a[data-post-number][href]')?.getAttribute('href')
    ?? Array.from(post.querySelectorAll('a[href]'), link => link.getAttribute('href')!)
      .find(value => value.includes('/p/') || value.includes('/t/'));
  let url = location.href;
  try {
    const parsed = new URL(href ?? location.href, location.origin);
    parsed.searchParams.delete('u');
    url = parsed.toString();
  } catch { /* Keep the current page URL. */ }
  return url;
}
