import { PRIMARY, POST, PLAYER } from './x-dom.ts';
import { hasReplyParent } from './x-reply.ts';
import { isGifVideo } from './x-video-playback.ts';
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

type Permalink = (node: Element) => string;

function detailStatusId(tweet: HTMLElement) {
  return tweet.ownerDocument.location.pathname.match(/^\/(?:\w+|i\/web)\/status\/(\d+)(?:\/|$)/)?.[1];
}

function focalIndex(posts: HTMLElement[], id: string, permalink: Permalink) {
  return posts.findIndex(post => permalink(post).match(/\/status\/(\d+)$/)?.[1] === id);
}

/** Only attach the page's focal post when capturing a reply below it. */
export function screenshotPosts(tweet: HTMLElement, permalink: Permalink): HTMLElement[] {
  const id = detailStatusId(tweet);
  if (!id) return [tweet];
  const scope = tweet.closest(PRIMARY) ?? tweet.ownerDocument;
  const posts = Array.from(scope.querySelectorAll<HTMLElement>(POST));
  const index = focalIndex(posts, id, permalink);
  return index >= 0 && index < posts.indexOf(tweet) ? [posts[index], tweet] : [tweet];
}

// x-web puts empty painted spans immediately above/below data-post-avatar.
// Legacy timelines wrap the avatar in a UserAvatar-Container. Check only the
// avatar's own column, so quote cards and unrelated dividers cannot join rows.
function avatarConnector(post: HTMLElement, above: boolean): DOMRect | undefined {
  const avatar = post.querySelector<HTMLElement>('[data-post-avatar], [data-testid^="UserAvatar-Container-"]');
  if (!avatar || avatar.closest(POST) !== post) return;
  function paintedConnector(line: Element): DOMRect | undefined {
    const style = post.ownerDocument.defaultView!.getComputedStyle(line);
    const rect = line.getBoundingClientRect();
    if (rect.width >= 1 && rect.width <= 3 && rect.height > rect.width &&
        style.visibility !== 'hidden' && style.backgroundColor &&
        !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor)) return rect;
  }
  // Responsive-web puts the upper half in a separate row above the avatar row.
  const legacyAvatar = avatar.closest('[data-testid="Tweet-User-Avatar"]');
  if (above && legacyAvatar) {
    const upperRow = legacyAvatar.parentElement?.parentElement?.previousElementSibling;
    const rail = upperRow?.querySelector(':scope > div > div:first-child > div:only-child:empty');
    if (rail) {
      const rect = paintedConnector(rail);
      const face = legacyAvatar.getBoundingClientRect();
      if (rect && Math.abs((rect.left + rect.right - face.left - face.right) / 2) <= 1) return rect;
    }
  }
  for (let node: Element | null = avatar; node && node !== post; node = node.parentElement) {
    const sibling = above ? node.previousElementSibling : node.nextElementSibling;
    if (sibling) {
      if (!sibling.matches('div,span') || sibling.textContent?.trim()) return;
      const line = sibling.firstElementChild ?? sibling;
      if (line.childElementCount) return;
      return paintedConnector(line);
    }
    // x-web has an explicit rail. Legacy avatars can have extra wrappers.
    if (avatar.hasAttribute('data-post-avatar') || node.parentElement?.childElementCount !== 1) return;
  }
}

function connectedReplies(earlier: HTMLElement, later: HTMLElement) {
  const end = avatarConnector(earlier, false);
  const start = avatarConnector(later, true);
  // The two halves meet at a row boundary. A gap can mean virtualized rows.
  return end && start && Math.abs(end.left - start.left) <= 1 && Math.abs(end.bottom - start.top) <= 2;
}

/** Visible ancestors, the selected reply branch, and its connected author continuation. */
export function screenshotThreadPosts(tweet: HTMLElement, permalink: Permalink): HTMLElement[] {
  const column = tweet.closest(PRIMARY);
  const id = detailStatusId(tweet);
  if (!column || !id) return [];
  const posts = Array.from(column.querySelectorAll<HTMLElement>(POST))
    .filter(post => !post.parentElement?.closest(POST));
  const focal = focalIndex(posts, id, permalink);
  const target = posts.indexOf(tweet);
  if (focal < 0 || target < 0) return [];
  const identity = (post: HTMLElement) => permalink(post).match(/^https?:\/\/[^/]+\/(\w+)\/status\/(\d+)$/);
  const targetIdentity = identity(tweet);
  let previousId = targetIdentity?.[2];
  const author = targetIdentity?.[1].toLowerCase();
  let end = target;
  while (previousId && end + 1 < posts.length) {
    const next = posts[end + 1];
    const nextIdentity = identity(next);
    if (!nextIdentity || nextIdentity[1].toLowerCase() !== author) break;
    if (!connectedReplies(posts[end], next) && !hasReplyParent(next, nextIdentity[2], previousId)) break;
    previousId = nextIdentity[2];
    end++;
  }
  if (target <= focal) return posts.slice(0, end + 1);
  let start = target;
  while (start > focal + 1 && connectedReplies(posts[start - 1], posts[start])) {
    start--;
  }
  return [...posts.slice(0, focal + 1), ...posts.slice(start, end + 1)];
}

export class ScreenshotTooLargeError extends Error {}

const captureScales = new WeakMap<HTMLCanvasElement, number>();
const roundedScreenshots = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export function screenshotCornerRadius(scale: number) {
  return Math.max(8, 16 * scale);
}

export function roundScreenshot(source: HTMLCanvasElement): HTMLCanvasElement {
  const cached = roundedScreenshots.get(source);
  if (cached) return cached;
  const canvas = source.ownerDocument.createElement('canvas');
  const { width, height } = source;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const radius = Math.min(screenshotCornerRadius(captureScales.get(source) ?? 2), width / 2, height / 2);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, width, height, radius);
  else {
    ctx.moveTo(radius, 0);
    ctx.arcTo(width, 0, width, height, radius);
    ctx.arcTo(width, height, 0, height, radius);
    ctx.arcTo(0, height, 0, 0, radius);
    ctx.arcTo(0, 0, width, 0, radius);
    ctx.closePath();
  }
  ctx.clip();
  ctx.drawImage(source, 0, 0);
  roundedScreenshots.set(source, canvas);
  return canvas;
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

// Replace the player interior in the serialized capture. The live player stays untouched.
const CAPTURE_PLAYER = `${PLAYER}, [data-testid="videoComponent"], [data-testid="tweetGif"]`;

async function videoStill(video: HTMLVideoElement, player: HTMLElement) {
  const doc = player.ownerDocument;
  const poster = player.querySelector<HTMLImageElement>('img[src*="pbs.twimg.com"]');
  const sources = new Set([video.poster, poster?.currentSrc || poster?.src]);
  for (const source of sources) {
    if (!source) continue;
    if (source.startsWith('data:image/')) return source;
    try {
      const response = await fetch(source, { credentials: 'omit' });
      if (!response.ok) continue;
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch { /* Try the other poster before falling back to a decoded frame. */ }
  }
  const src = video.currentSrc || video.src;
  if (!src || !video.videoWidth || !video.videoHeight ||
      (!video.crossOrigin && new URL(src, doc.baseURI).origin !== doc.location.origin)) return;
  const probe = doc.createElement('canvas');
  probe.width = video.videoWidth; probe.height = video.videoHeight;
  try {
    probe.getContext('2d')!.drawImage(video, 0, 0);
    return probe.toDataURL();
  } catch { /* A tainted probe never reaches the screenshot canvas. */ }
}

async function addVideoStills(xml: Document, players: HTMLElement[]) {
  const clones = xml.querySelectorAll<HTMLElement>(CAPTURE_PLAYER);
  await Promise.all(players.map(async (player, index) => {
    const video = player.querySelector('video'), clone = clones[index];
    if (!video || !clone) return;
    const rect = player.getBoundingClientRect();
    const videoBox = video.getBoundingClientRect();
    const surface = videoBox.width && videoBox.height ? video : player.querySelector('img') ?? player;
    const box = surface.getBoundingClientRect();
    const css = player.ownerDocument.defaultView!.getComputedStyle(surface);
    const still = await videoStill(video, player);
    Object.assign(clone.style, { width: `${rect.width}px`, height: `${rect.height}px`, position: clone.style.position === 'static' || !clone.style.position ? 'relative' : clone.style.position,
      overflow: 'hidden', background: '#303640' });
    if (still) {
      const image = xml.createElementNS('http://www.w3.org/1999/xhtml','img');
      image.setAttribute('src', still);
      Object.assign(image.style, {position:'absolute', left:`${box.left-rect.left}px`, top:`${box.top-rect.top}px`,
        width:`${box.width || rect.width}px`, height:`${box.height || rect.height}px`, objectFit: css.objectFit || 'contain', objectPosition: css.objectPosition});
      clone.append(image);
    }
    if (!isGifVideo(video)) {
      const glyph = xml.createElementNS('http://www.w3.org/1999/xhtml','span');
      glyph.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:50%;background:#0007;display:grid;place-items:center';
      const triangle = xml.createElementNS('http://www.w3.org/1999/xhtml','span');
      triangle.style.cssText = 'width:0;height:0;margin-left:4px;border:9px solid transparent;border-left:15px solid white;border-right:0';
      glyph.append(triangle); clone.append(glyph);
    }
  }));
}

const TRANSLATION = '[data-testid="translateTweet"],[data-testid="translateTweetButton"],[data-testid="translationButton"],' +
  'button:has(use[href*="translate"]),button:has([data-icon*="translate"]),' +
  ':is([data-testid="tweetText"],div[dir="auto"][lang]) + button,' +
  ':is([data-testid="tweetText"],div[dir="auto"][lang]) + div > button:only-child,' +
  // Live X (2026): the translate row precedes the text as <div><svg-ish icon/><button/></div>.
  'div:has(> button):has(+ [data-testid="tweetText"])';
const QUOTES = 'a:is([href$="/quotes"],[href*="/quotes?"],[href$="/retweets/with_comments"])';
const RELATED = '[data-testid="relatedPosts"],[data-testid="viewQuotes"],a[href$="/related"]';

// X wraps these controls in spacing elements. Peel off wrappers only while
// they contain nothing else, so a timestamp or quoted post can share a parent.
function removeCaptureRows(article: HTMLElement, hideMetrics: boolean) {
  const rows = new Set<Element>();
  function outerWrapper(node: Element) {
    let wrapper = node;
    while (wrapper.parentElement && wrapper.parentElement !== article &&
      wrapper.parentElement.matches('div,span') && wrapper.parentElement.childElementCount === 1 &&
      !Array.from(wrapper.parentElement.childNodes).some(child => child.nodeType === 3 && child.textContent?.trim())) {
      wrapper = wrapper.parentElement;
    }
    return wrapper;
  }
  const omit = (node: Element) => rows.add(outerWrapper(node));
  article.querySelectorAll(TRANSLATION).forEach(omit);
  article.querySelectorAll(QUOTES).forEach(link => {
    // Detail navigation can put a related-post button beside the quotes link.
    if (link.closest('[data-testid="tweetText"],div[dir="auto"][lang]')) return;
    const row = link.closest('[role=tablist],nav') ?? outerWrapper(link).parentElement;
    const content = 'time,article,[data-testid="tweetText"],[lang][dir],p,[role=group],video,img';
    if (row && row !== article && !row.querySelector(content)) omit(row);
    else omit(link);
  });
  article.querySelectorAll(RELATED).forEach(node => {
    if (!node.closest('[data-testid="tweetText"],div[dir="auto"][lang]')) omit(node);
  });
  if (hideMetrics) article.querySelectorAll('[role="group"]').forEach(omit);
  for (const row of rows) {
    for (let parent = row.parentElement; parent && article.contains(parent); parent = parent.parentElement) {
      // html-to-image freezes every computed height, even on auto-sized flex containers.
      parent.style.height = 'auto';
    }
    row.remove();
  }
  return rows.size > 0;
}

async function fitCapture(xml: Document, doc: Document) {
  const svg = xml.documentElement;
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  if (!width || !height) return;

  // Lay out the serialized article in SVG image mode, where scripts are inert.
  // Render just its first pixel column. A marker after the invisible article
  // gives its bottom edge without inserting captured markup into a live frame.
  const probe = svg.cloneNode(true) as SVGSVGElement;
  const content = probe.querySelector('foreignObject')!;
  content.setAttribute('width', String(width));
  probe.setAttribute('width', '1');
  probe.setAttribute('height', String(height + 2));
  probe.setAttribute('viewBox', `0 0 1 ${height + 2}`);
  (content.firstElementChild as HTMLElement).style.opacity = '0';
  const marker = xml.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  marker.style.cssText = 'display:block;width:1px;height:2px;background:black';
  content.append(marker);
  const image = doc.createElement('img');
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(probe));
  await image.decode();
  const canvas = doc.createElement('canvas');
  canvas.width = 1;
  canvas.height = height + 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, 1, canvas.height).data;
  for (let y = 1; y <= height; y++) {
    if (pixels[y * 4 + 3] !== 255) continue;
    svg.setAttribute('height', String(y));
    svg.setAttribute('viewBox', `0 0 ${width} ${y}`);
    return;
  }
}

export async function screenshotSvg(post: HTMLElement, options: ScreenshotOptions, backgroundColor: string) {
  // Drawing a cross-origin <video> frame taints the canvas; X overlays a poster <img> instead.
  const omit = '[data-testid="caret"], [role="menu"], .site-enhancer-menuitem, video, .se-speed, .se-video-chrome, ' +
    '[data-site-enhancer-video-expand], [data-site-enhancer-video-speed], [data-site-enhancer-video-popover], [data-site-enhancer-video-hud],script,iframe,object,embed';
  const rows = [TRANSLATION, QUOTES, RELATED];
  if (options.hideMetrics) rows.push('[role="group"]');
  const hasRows = !!post.querySelector(rows.join(','));
  const players: HTMLElement[] = [];
  const svg = await toSvg(post, {
    backgroundColor, includeQueryParams: true, fontEmbedCSS: await warmScreenshotFonts(post),
    filter: node => {
      if (node.parentElement?.closest(CAPTURE_PLAYER) || node.matches?.(omit)) return false;
      if (node.matches?.(CAPTURE_PLAYER)) players.push(node as HTMLElement);
      return true;
    },
    style: { transform: 'none', margin: '0' },
  });
  if (!players.length && !hasRows) return svg;
  const xml = new DOMParser().parseFromString(decodeURIComponent(svg.slice(svg.indexOf(',') + 1)), 'image/svg+xml');
  const article = xml.querySelector<HTMLElement>('foreignObject > *')!;
  await addVideoStills(xml,players);
  if (removeCaptureRows(article,Boolean(options.hideMetrics))) await fitCapture(xml,post.ownerDocument);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(xml));
}

export async function renderPostScreenshot(posts: HTMLElement[], options: ScreenshotOptions = {}): Promise<HTMLCanvasElement> {
  if (!posts.length || posts.some(post => !post.isConnected)) throw new Error('Post unavailable');
  const doc = posts[0].ownerDocument;
  const backgroundColor = screenshotBackground(posts[0]);
  const captures = await Promise.all(posts.map(async post => {
    const image = doc.createElement('img');
    image.src = await screenshotSvg(post, options, backgroundColor);
    await image.decode();
    // Match html-to-image's 2x raster size and 16384px per-image dimension cap.
    const scale = Math.min(2, 16384 / Math.max(image.naturalWidth, image.naturalHeight));
    return { image, scale, width: Math.floor(image.naturalWidth * scale), height: Math.floor(image.naturalHeight * scale) };
  }));
  const padding = 48, gap = 32; // 24px outer margin and 16px between posts at 2x.
  const width = Math.max(...captures.map(capture => capture.width)) + padding * 2;
  const height = captures.reduce((sum, capture) => sum + capture.height, 0) + padding * 2 + gap * (captures.length - 1);
  if (width * height > 64_000_000) throw new ScreenshotTooLargeError('Screenshot too large');
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
  captureScales.set(canvas, Math.min(...captures.map(capture => capture.scale)));
  return canvas;
}
