import { PRIMARY, POST } from './x-dom.ts';
import { getFontEmbedCSS, toSvg } from 'html-to-image';

export type ScreenshotOptions = {
  hideMetrics?: boolean;
};

const fontCssCache = new WeakMap<Document, { families: string; css: Promise<string> }>();

/** Share the embedded fonts across posts using the same families, including an in-flight warmup. */
export function warmScreenshotFonts(post: HTMLElement): Promise<string> {
  const doc = post.ownerDocument;
  if (doc.fonts?.size === 0) return Promise.resolve('');
  const view = doc.defaultView!;
  const used = new Set<string>();
  for (const node of [post, ...post.querySelectorAll('*')]) {
    if (node instanceof view.HTMLElement) {
      const family = view.getComputedStyle(node).fontFamily;
      if (family) used.add(family);
    }
  }
  if (!used.size) return Promise.resolve('');
  const families = Array.from(used).sort().join(', ');
  const cached = fontCssCache.get(doc);
  if (cached?.families === families) return cached.css;
  // html-to-image reads the sample's font-family to select matching @font-face rules.
  const sample = doc.createElement('span');
  sample.style.fontFamily = families;
  const css = getFontEmbedCSS(sample).catch(() => {
    if (fontCssCache.get(doc)?.css === css) fontCssCache.delete(doc);
    return '';
  });
  fontCssCache.set(doc, { families, css });
  return css;
}

/** Only attach the page's focal post when capturing a reply below it. */
export function screenshotPosts(tweet: HTMLElement, permalink: (node: Element) => string): HTMLElement[] {
  const doc = tweet.ownerDocument;
  const id = doc.location.pathname.match(/^\/(?:\w+|i\/web)\/status\/(\d+)(?:\/|$)/)?.[1];
  if (!id) return [tweet];
  const scope = tweet.closest(PRIMARY) ?? doc;
  const posts = Array.from(scope.querySelectorAll<HTMLElement>(POST));
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

export async function renderPostScreenshot(posts: HTMLElement[], options: ScreenshotOptions = {}): Promise<HTMLCanvasElement> {
  if (!posts.length || posts.some(post => !post.isConnected)) throw new Error('Post unavailable');
  const doc = posts[0].ownerDocument;
  const backgroundColor = screenshotBackground(posts[0]);
  // Drawing a cross-origin <video> frame taints the canvas; X overlays a poster <img> instead.
  const omit = '[data-testid="caret"], [role="menu"], .site-enhancer-menuitem, video'
    + (options.hideMetrics ? ', [role="group"]' : '');
  const captures = await Promise.all(posts.map(async post => {
    const image = doc.createElement('img');
    image.src = await toSvg(post, {
      backgroundColor, includeQueryParams: true, fontEmbedCSS: await warmScreenshotFonts(post),
      filter: node => !node.matches?.(omit),
      style: { transform: 'none', margin: '0' },
    });
    await image.decode();
    // Match html-to-image's 2x raster size and 16384px per-image dimension cap.
    const scale = Math.min(2, 16384 / Math.max(image.naturalWidth, image.naturalHeight));
    return { image, width: Math.floor(image.naturalWidth * scale), height: Math.floor(image.naturalHeight * scale) };
  }));
  const padding = 48, gap = 32; // 24px outer margin and 16px between posts at 2x.
  const width = Math.max(...captures.map(capture => capture.width)) + padding * 2;
  const height = captures.reduce((sum, capture) => sum + capture.height, 0) + padding * 2 + gap * (captures.length - 1);
  if (width * height > 64_000_000) throw new Error('Screenshot too large');
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas unavailable');
  // Seed an opaque white base even if a future theme supplies an alpha color.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = padding;
  for (const capture of captures) {
    context.drawImage(capture.image, padding, y, capture.width, capture.height);
    y += capture.height + gap;
  }
  return canvas;
}
