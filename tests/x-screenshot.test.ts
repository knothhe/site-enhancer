import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { installReplyResolver } from '../utils/x-reply.ts';
import { screenshotSvg, screenshotPosts, screenshotThreadPosts, screenshotCornerRadius, screenshotBackground, warmScreenshotFonts } from '../utils/x-screenshot.ts';

test('screenshot warmup shares in-flight CSS across posts using the same fonts and picks up different families', async t => {
  const win = new Window();
  const doc = win.document;
  t.after(() => win.happyDOM.close());
  const original = Object.getOwnPropertyDescriptor(globalThis, 'CSSRule');
  Object.defineProperty(globalThis, 'CSSRule', { value: win.CSSRule, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'CSSRule', original);
    else Reflect.deleteProperty(globalThis, 'CSSRule');
  });
  const style = doc.createElement('style');
  style.textContent = `
    @font-face { font-family: Alpha; src: url(data:font/woff2;base64,QQ==); }
    @font-face { font-family: Beta; src: url(data:font/woff2;base64,Qg==); }
  `;
  doc.head.append(style);
  doc.body.innerHTML = '<article style="font-family:Alpha">One</article><article style="font-family:Alpha"><b>Two</b></article>';
  const [first, second] = Array.from(doc.querySelectorAll('article')) as unknown as HTMLElement[];
  const pending = warmScreenshotFonts(first);
  assert.equal(warmScreenshotFonts(second), pending);
  const regular = await pending;
  assert.match(regular, /font-family: Alpha/);
  assert.doesNotMatch(regular, /font-family: Beta/);
  second.querySelector('b')!.style.fontFamily = 'Beta';
  const mixed = await warmScreenshotFonts(second);
  assert.match(mixed, /font-family: Alpha/);
  assert.match(mixed, /font-family: Beta/);
});

for (const [path, selected, expected] of [
  ['/home', 'reply', ['reply']],
  ['/author/status/1', 'reply', ['root', 'reply']],
  ['/author/status/1', 'root', ['root']],
  ['/author/status/3', 'reply', ['reply']],
  ['/author/status/9', 'reply', ['reply']],
] as const) {
  test(`screenshot selection ${path} ${selected}`, async () => {
    const win = new Window({ url: `https://x.com${path}` });
    const doc = win.document;
    doc.body.innerHTML = '<main data-testid="primaryColumn"><article data-testid="tweet" id="root" data-url="https://x.com/author/status/1"></article><article data-testid="tweet" id="other" data-url="https://x.com/author/status/2"></article><article data-testid="tweet" id="reply" data-url="https://x.com/author/status/3"></article></main>';
    const result = screenshotPosts(doc.getElementById(selected) as unknown as HTMLElement, node => node.getAttribute('data-url')!);
    assert.deepEqual(result.map(node => node.id), expected);
    await win.happyDOM.close();
  });
}

test('conversation capture follows visible ancestors and only the connected reply branch', async t => {
  const win = new Window({ url: 'https://x.com/alice/status/3' });
  t.after(() => win.happyDOM.close());
  const doc = win.document as unknown as Document;
  const line = '<span aria-hidden="true" style="background-color:rgb(128,128,128)"></span>';
  function post(id: number, above = false, below = false) {
    return `<article data-testid="tweet" id="p${id}"><div>${above ? line : ''}<div data-post-avatar></div>${below ? line : ''}</div></article>`;
  }
  doc.body.innerHTML = `<aside>${post(0)}</aside><main data-testid="primaryColumn">${[
    post(1), post(2), post(3), post(4, false, true), post(5, true), post(6, false, true),
    post(7, true, true), post(8, true), post(9),
  ].join('')}</main>`;
  for (const el of doc.querySelectorAll('span')) {
    const index = Number(el.closest('article')!.id.slice(1));
    const y = index * 100 + (el.previousElementSibling ? 92 : 0);
    el.getBoundingClientRect = () => new win.DOMRect(0, y, 2, 8) as DOMRect;
  }
  // A quote and a content divider are not conversation edges.
  doc.querySelector('#p5')!.insertAdjacentHTML('beforeend', post(10, false, true));
  doc.querySelector('#p9')!.insertAdjacentHTML('beforeend', line);
  const collect = (id: number) => screenshotThreadPosts(doc.querySelector<HTMLElement>(`#p${id}`)!,
    node => 'https://x.com/' + (node.getAttribute('data-author') ?? 'alice') + '/status/' + node.id.slice(1)).map(node => Number(node.id.slice(1)));
  assert.deepEqual(collect(2), [1, 2]);
  assert.deepEqual(collect(3), [1, 2, 3]);
  assert.deepEqual(collect(8), [1, 2, 3, 6, 7, 8]);
  assert.deepEqual(collect(6), [1, 2, 3, 6, 7, 8]);
  doc.querySelector('#p8')!.setAttribute('data-author', 'bob');
  assert.deepEqual(collect(6), [1, 2, 3, 6, 7]);
  doc.querySelector('#p8')!.removeAttribute('data-author');
  assert.deepEqual(collect(9), [1, 2, 3, 9]);
  doc.querySelector('#p7')!.remove(); // Virtualized gap between two otherwise matching lines.
  assert.deepEqual(collect(8), [1, 2, 3, 8]);
  assert.deepEqual(collect(0), []);
  win.history.replaceState({}, '', '/home');
  assert.deepEqual(collect(8), []);
});

test('corner radius tracks capture scale and retains an eight-pixel minimum', () => {
  assert.deepEqual([2, 1.5, 0.25].map(screenshotCornerRadius), [32, 24, 8]);
});

test('screenshot background follows the nearest opaque host background', async () => {
  const win = new Window();
  win.document.body.style.backgroundColor = 'rgb(16, 19, 24)';
  const post = win.document.createElement('article'); win.document.body.append(post);
  assert.equal(screenshotBackground(post as unknown as HTMLElement), 'rgb(16, 19, 24)');
  await win.happyDOM.close();
});

test('transparent hover backgrounds cannot make the screenshot transparent', async () => {
  const win = new Window();
  win.document.body.style.backgroundColor = 'rgb(21, 32, 43)';
  const post = win.document.createElement('article');
  post.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
  win.document.body.append(post);
  assert.equal(screenshotBackground(post as unknown as HTMLElement), 'rgb(21, 32, 43)');
  win.document.body.style.backgroundColor = 'transparent';
  assert.equal(screenshotBackground(post as unknown as HTMLElement), '#ffffff');
  await win.happyDOM.close();
});

test('serialized screenshots replace each entire player with the displayed poster and omit the GIF play glyph', async t => {
  const win = new Window({url:'https://x.com/home'});
  t.after(() => win.happyDOM.close());
  for (const name of ['window','document','Element','HTMLCanvasElement','HTMLVideoElement','HTMLIFrameElement',
    'HTMLSlotElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLImageElement',
    'SVGImageElement','SVGElement','DOMParser','XMLSerializer','FileReader','CSSRule','Node']) {
    const before = Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,value:name === 'window' ? win : Reflect.get(win,name)});
    t.after(() => { if (before) Object.defineProperty(globalThis,name,before); else Reflect.deleteProperty(globalThis,name); });
  }
  const poster = 'data:image/png;base64,iVBORw0KGgo=';
  const markup = `<div data-testid="videoPlayer"><video poster="${poster}" style="object-fit:cover"></video>
    <div role="slider">progress</div><button data-site-enhancer-video-expand>expand</button>
    <button data-site-enhancer-video-speed>speed</button><div data-site-enhancer-video-popover>preset</div>
    <div data-site-enhancer-video-hud>hud</div></div>`;
  document.body.innerHTML = `<article>${markup}<div data-testid="tweetGif">${markup}</div></article>`;
  const article = document.querySelector('article')!;
  // happy-dom does not reflect the video poster attribute onto its IDL property.
  for (const node of article.querySelectorAll<HTMLElement>('[data-testid],video')) {
    node.getBoundingClientRect = () => new win.DOMRect(10, 20, 200, 100);
  }
  for (const video of article.querySelectorAll('video')) video.poster = poster;
  article.insertAdjacentHTML('beforeend', '<div><span>⟲</span><button>Show translation</button></div>' +
    '<div data-testid="tweetText">Keep this text</div><div><button>翻訳</button></div>' +
    '<div class="metrics-padding"><div role="group"><button>Like</button></div></div>' +
    '<nav><button>Context</button><a href="/alice/status/1/quotes">引用</a></nav>');
  const url = await screenshotSvg(article,{},'white');
  const xml = new DOMParser().parseFromString(decodeURIComponent(url.slice(url.indexOf(',')+1)), 'image/svg+xml');
  assert.ok(xml.querySelector('.metrics-padding'));
  assert.doesNotMatch(xml.documentElement.textContent!,/翻訳|Show translation|⟲|Context|引用/);
  const filtered = await screenshotSvg(article,{hideMetrics:true},'white');
  const hidden = new DOMParser().parseFromString(decodeURIComponent(filtered.slice(filtered.indexOf(',')+1)), 'image/svg+xml');
  assert.equal(hidden.querySelector('.metrics-padding,[role=group],nav'),null);
  assert.match(hidden.documentElement.textContent!,/Keep this text/);
  assert.ok(article.querySelector('.metrics-padding'), 'the live post retains all wrappers');
  const players = xml.querySelectorAll('[data-testid=videoPlayer],[data-testid=tweetGif]');
  assert.equal(players.length,2);
  for (const player of players) {
    assert.equal(player.querySelector('img')?.getAttribute('src'),poster);
    assert.match(player.querySelector('img')?.getAttribute('style') ?? '',/object-fit:\s*cover/);
    assert.equal(player.querySelector('button,video,[role=slider],[data-site-enhancer-video-popover],[data-site-enhancer-video-hud]'),null);
  }
  assert.equal(players[0].querySelectorAll('span').length,2);
  assert.equal(players[1].querySelector('span'),null);
  assert.equal(article.querySelectorAll('video').length,2);
});

test('explicit reply IDs connect only the matching post and previous parent, without visible rails', async t => {
  const win = new Window({ url: 'https://x.com/alice/status/1' });
  t.after(() => win.happyDOM.close());
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = '<main data-testid="primaryColumn">' + [1, 2, 3].map(id =>
    `<article data-testid="tweet" data-url="https://x.com/alice/status/${id}"></article>`).join('') + '</main>';
  const [root, next, last] = doc.querySelectorAll<HTMLElement>('article');
  const dispose = installReplyResolver(doc);
  t.after(dispose);
  const collect = () => screenshotThreadPosts(root, post => post.getAttribute('data-url')!);
  const setRelation = (post: HTMLElement, child: string, parent?: string) => Object.assign(post, {
    __reactFiber$example: { return: { memoizedProps: { tweet: { id_str: child, in_reply_to_status_id_str: parent } } } },
  });
  setRelation(next, '2', '1');
  setRelation(last, '3', '2');
  assert.deepEqual(collect(), [root, next, last]);
  setRelation(last, '3', '1');
  assert.deepEqual(collect(), [root, next]);
  setRelation(next, '2');
  assert.deepEqual(collect(), [root]);
  setRelation(next, '99', '1');
  assert.deepEqual(collect(), [root]);
  setRelation(next, '2', '1');
  next.dataset.url = 'https://x.com/bob/status/2';
  assert.deepEqual(collect(), [root]);
});
