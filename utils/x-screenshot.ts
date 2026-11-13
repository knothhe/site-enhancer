import { toCanvas } from 'html-to-image';

/** Only attach the page's focal post when capturing a reply below it. */
export function screenshotPosts(tweet: HTMLElement, permalink: (node: Element) => string): HTMLElement[] {
  const doc = tweet.ownerDocument;
  const id = doc.location.pathname.match(/^\/(?:\w+|i\/web)\/status\/(\d+)(?:\/|$)/)?.[1];
  if (!id) return [tweet];
  const scope = tweet.closest('[data-testid="primaryColumn"]') ?? doc;
  const posts = Array.from(scope.querySelectorAll<HTMLElement>('article[data-testid="tweet"]'));
  const parent = posts.find(post => permalink(post).match(/\/status\/(\d+)$/)?.[1] === id);
  return parent && parent !== tweet && posts.indexOf(parent) < posts.indexOf(tweet) ? [parent, tweet] : [tweet];
}

export function screenshotBackground(node: HTMLElement): string {
  const view = node.ownerDocument.defaultView!;
  for (let element: HTMLElement | null = node; element; element = element.parentElement) {
    const color = view.getComputedStyle(element).backgroundColor;
    // A hover tint or transparent wrapper must not become the exported background.
    const alpha = color.match(/(?:,|\/)\s*([\d.]+%?)\s*\)$/)?.[1];
    const translucent = color.startsWith('rgba(') || color.includes('/');
    if (color && color !== 'transparent' && (!translucent || alpha === '1' || alpha === '100%')) return color;
  }
  return '#ffffff';
}

export async function renderPostScreenshot(posts: HTMLElement[]): Promise<Blob> {
  if (!posts.length || posts.some(post => !post.isConnected)) throw new Error('Post unavailable');
  const backgroundColor = screenshotBackground(posts[0]);
  // Capture just the selected articles, never menus, the composer or intervening replies.
  const captures = await Promise.all(posts.map(post => toCanvas(post, {
    pixelRatio: 2, backgroundColor, includeQueryParams: true,
    filter: node => !node.matches?.('[data-testid="caret"], [role="menu"], .site-enhancer-menuitem'),
    style: { transform: 'none', margin: '0' },
  })));
  const padding = 48, gap = 32; // 24px outer margin and 16px between posts at 2x.
  const canvas = posts[0].ownerDocument.createElement('canvas');
  canvas.width = Math.max(...captures.map(image => image.width)) + padding * 2;
  canvas.height = captures.reduce((height, image) => height + image.height, 0) + padding * 2 + gap * (captures.length - 1);
  if (canvas.width * canvas.height > 64_000_000) throw new Error('Screenshot too large');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas unavailable');
  // Seed an opaque white base even if a future theme supplies an alpha color.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = padding;
  for (const image of captures) {
    context.drawImage(image, padding, y);
    y += image.height + gap;
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
}
