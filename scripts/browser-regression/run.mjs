#!/usr/bin/env node
// Isolated browser regression for the built Chrome MV3 extension.
//
//   pnpm test:browser [--skip-build] [--out <dir>] [--headed]
//
// Builds .output/chrome-mv3, copies it to a temporary directory with an
// in-memory clipboard recorder prepended to the copying content scripts, and
// loads it into a Chromium browser with a new temporary profile. X and
// linux.do pages are served from offline fixtures through CDP request
// interception; every other request is blocked. Exits 1 when any assertion
// fails. Screenshots and report.json go to the output directory.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const outDir = resolve(option('--out') ?? join(root, '.output/browser-regression'));
const headed = args.includes('--headed');
const TOTAL_TIMEOUT = Number(process.env.SE_BROWSER_TIMEOUT_MS ?? 120_000);

const BROWSERS = [
  '/Applications/ego lite.app/Contents/MacOS/ego lite',
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let failures = 0;
let cleanupStarted = false;
let browserProcess;
let ws;
let workDir;

function log(line) { process.stdout.write(`${line}\n`); }

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
  if (!ok) failures += 1;
  log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n         ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

function equal(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, { expected, actual });
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  try { ws?.close(); } catch {}
  if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
    const exited = new Promise(r => browserProcess.once('exit', r));
    browserProcess.kill('SIGTERM');
    if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]) === false) {
      browserProcess.kill('SIGKILL');
      await Promise.race([exited, sleep(2000)]);
    }
  }
  if (workDir) rmSync(workDir, { recursive: true, force: true, maxRetries: 3 });
}

async function abort(code, message) {
  if (message) log(message);
  await cleanup();
  process.exit(code);
}

process.on('SIGINT', () => void abort(130, 'Interrupted; browser and temporary profile removed.'));
process.on('SIGTERM', () => void abort(143, 'Terminated; browser and temporary profile removed.'));
process.on('uncaughtException', error => void abort(1, `Error: ${error?.stack ?? error}`));
process.on('unhandledRejection', error => void abort(1, `Error: ${error?.stack ?? error}`));
const watchdog = setTimeout(() => void abort(1, `Timed out after ${TOTAL_TIMEOUT} ms.`), TOTAL_TIMEOUT);
watchdog.unref();

// ---------------------------------------------------------------- build ---

const browserPath = process.env.SE_BROWSER ?? BROWSERS.find(path => existsSync(path));
if (!browserPath || !existsSync(browserPath)) {
  log('No Chromium browser found. Set SE_BROWSER to a Chromium, Chrome for Testing or ego lite executable.');
  process.exit(2);
}

if (!args.includes('--skip-build')) {
  log('Building Chrome MV3...');
  const build = spawnSync('pnpm', ['build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (build.status !== 0) { log('pnpm build failed.'); process.exit(1); }
}
const built = join(root, '.output/chrome-mv3');
if (!existsSync(join(built, 'manifest.json'))) { log(`Missing build at ${built}; run without --skip-build.`); process.exit(1); }

workDir = mkdtempSync(join(tmpdir(), 'se-browser-regression-'));
const extDir = join(workDir, 'extension');
const profileDir = join(workDir, 'profile');
cpSync(built, extDir, { recursive: true });
const shim = readFileSync(join(here, 'clipboard-shim.js'), 'utf8');
for (const name of ['x', 'linux-do']) {
  const file = join(extDir, 'content-scripts', `${name}.js`);
  writeFileSync(file, `globalThis.__seShimName=${JSON.stringify(name)};\n${shim}\n${readFileSync(file, 'utf8')}`);
}
const fixtures = {
  x: readFileSync(join(here, 'fixtures/x.html'), 'utf8'),
  'linux-do': readFileSync(join(here, 'fixtures/linux-do.html'), 'utf8'),
};
// Replace only artifacts this command writes; --out may point at an existing directory.
mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(outDir)) {
  if (name === 'report.json' || /^(?:x|linux-do|popup)-[\w-]+\.png$/.test(name)) rmSync(join(outDir, name), { force: true });
}

// -------------------------------------------------------------- browser ---

browserProcess = spawn(browserPath, [
  ...(headed ? [] : ['--headless=new']),
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-port=0',
  `--disable-extensions-except=${extDir}`,
  `--load-extension=${extDir}`,
  '--enable-unsafe-extension-debugging',
  // Anything not served by a fixture goes to a closed local port.
  '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-default-apps', '--no-first-run', '--no-default-browser-check',
  '--password-store=basic', '--use-mock-keychain',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserLog = '';
browserProcess.stderr.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
browserProcess.on('exit', (code, signal) => {
  if (!cleanupStarted) void abort(1, `Browser exited early (${code ?? signal}).\n${browserLog}`);
});

let wsUrl;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(100);
  try {
    const [port, path] = readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    if (port && path) wsUrl = `ws://127.0.0.1:${port}${path}`;
  } catch {}
}
if (!wsUrl) await abort(1, `Browser did not open a DevTools port.\n${browserLog}`);

ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  for (const listener of listeners) listener(message);
});
function send(method, params = {}, sessionId, timeout = 10_000) {
  return new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out`)); }, timeout);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.error) rej(new Error(`${method}: ${message.error.message}`)); else res(message.result);
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function findExtensionId() {
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const id = targetInfos.map(t => t.url.match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1]).find(Boolean);
    if (id) return id;
    if (i === 10) {
      // Branded Chrome ignores --load-extension; CDP loading needs --enable-unsafe-extension-debugging.
      try { return (await send('Extensions.loadUnpacked', { path: extDir })).id; } catch {}
    }
    await sleep(100);
  }
  throw new Error('The extension did not load.');
}
const extId = await findExtensionId();

const blocked = [];
function serve(url) {
  const { hostname, pathname, searchParams } = new URL(url);
  const site = /(^|\.)x\.com$/.test(hostname) ? 'x' : hostname === 'linux.do' ? 'linux-do' : undefined;
  if (!site) return undefined;
  if (pathname === '/favicon.ico') return { status: 404, body: '' };
  return { status: 200, body: fixtures[site].replace('__LANG__', searchParams.get('lang') ?? 'en') };
}

async function openPage({ url, width = 1000, height = 700, scale = 1, dark = false, init }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = {
    targetId, sessionId,
    send: (method, params) => send(method, params, sessionId),
    async eval(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (exceptionDetails) throw new Error(`${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`);
      return result.value;
    },
    async waitFor(description, expression, timeout = 5000) {
      const start = Date.now();
      let last;
      while (Date.now() - start < timeout) {
        // Evaluation errors (e.g. a context destroyed by navigation) are retried, never success.
        let value;
        try { value = await page.eval(expression); } catch (error) { last = `error: ${error.message}`; await sleep(50); continue; }
        if (value) return value;
        last = value;
        await sleep(50);
      }
      throw new Error(`Timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
    },
    async key(key) {
      const keys = { Enter: ['Enter', 13, '\r'], ' ': ['Space', 32, ' '] };
      const [code, vk, text] = keys[key];
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    },
    async click(selector) {
      // Coordinates are taken right before the click and must hit the element.
      const point = await page.eval(`const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null; el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return hit && (el === hit || el.contains(hit)) ? { x, y } : { miss: hit?.outerHTML.slice(0, 120) ?? null };`);
      if (!point || point.miss !== undefined) throw new Error(`Cannot click ${selector}: ${JSON.stringify(point)}`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await page.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
      }
    },
    async shot(name, clip) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    },
    clipboard: () => page.eval(`return JSON.parse(document.documentElement.getAttribute('data-se-test-clipboard') || '[]');`),
    clearClipboard: () => page.eval(`document.documentElement.removeAttribute('data-se-test-clipboard');`),
    close: () => send('Target.closeTarget', { targetId }),
  };
  if (/^https?:/.test(url)) {
    listeners.add(message => {
      if (message.sessionId !== sessionId || message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params;
      const response = serve(request.url);
      if (!response) {
        blocked.push(request.url);
        void send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
        return;
      }
      void send('Fetch.fulfillRequest', {
        requestId, responseCode: response.status,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(response.body).toString('base64'),
      }, sessionId).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  }
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  if (init) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  await page.send('Page.navigate', { url });
  await page.waitFor('page load', `return document.readyState === 'complete' && location.href !== 'about:blank';`);
  return page;
}

async function step(name, fn) {
  log(`\n# ${name}`);
  try { await fn(); } catch (error) { check(`${name}: completed without error`, false, error.message); }
}

// ------------------------------------------------------------------- X ---

let xPage;
await step('X More menu (keyboard)', async () => {
  const page = xPage = await openPage({ url: 'https://x.com/home?lang=en' });
  const shimmed = await page.waitFor('content scripts', `return [...document.querySelectorAll('style')].some(s => s.textContent.includes('site-enhancer-menuitem'))
    && document.documentElement.getAttribute('data-se-test-shim');`);
  check('clipboard recorder installed in the X content script', String(shimmed).includes('x'), shimmed);

  const items = `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(i => i.textContent.trim())`;
  const expected = { link: 'First line\nSecond line 🎉', url: 'https://x.com/alice/status/1234567890' };
  const cases = [
    { key: 'Enter', item: 0, value: `${expected.link}\n${expected.url}\n#X`, toast: 'Copied!' },
    { key: ' ', item: 1, value: expected.link, toast: 'Copied!' },
    { key: 'Enter', item: 2, value: expected.url, toast: 'Copied!', mouse: true },
  ];
  for (const c of cases) {
    const label = c.key === 'Enter' ? 'Enter' : 'Space';
    await page.clearClipboard();
    await page.eval(`window.__fixture.caretClicks = 0; window.__fixture.opens = []; document.querySelector('#t1 [data-testid="caret"]').focus();`);
    await page.key(c.key);
    await page.waitFor(`${label} menu`, `return document.querySelectorAll('[role="menu"] .site-enhancer-menuitem').length === 3;`);
    await sleep(300); // Give the observer time to (wrongly) inject twice.
    equal(`${label}: copy items injected once, before native items`, await page.eval(`return ${items};`),
      ['Copy post with link', 'Copy post text only', 'Copy post link', 'Not interested', 'Follow']);
    equal(`${label}: menu opened from keydown without a click`, await page.eval(`return window.__fixture;`), { caretClicks: 0, opens: ['keydown'] });
    check(`${label}: native height lock released`, await page.eval(`return document.querySelector('.fixture-height').getBoundingClientRect().height > 88;`));
    if (c === cases[0]) await page.shot('x-menu-keyboard-en');
    if (c.mouse) {
      await page.click(`[role="menu"] .site-enhancer-menuitem:nth-child(${c.item + 1})`);
    } else {
      await page.eval(`document.querySelectorAll('[role="menu"] .site-enhancer-menuitem')[${c.item}].focus();`);
      await page.key(c.key);
    }
    await page.waitFor(`${label}: clipboard write`, `return document.documentElement.hasAttribute('data-se-test-clipboard');`);
    equal(`${label}: item ${c.item + 1} copies the outer post only`, await page.clipboard(), [{ text: c.value, via: 'clipboard' }]);
    check(`${label}: native menu closed after copying`, await page.eval(`return !document.querySelector('[role="menu"]');`));
    check(`${label}: focus returned to the caret`, await page.eval(`return document.activeElement === document.querySelector('#t1 [data-testid="caret"]');`));
    await page.waitFor(`${label}: toast`, `return [...document.querySelectorAll('[role="status"]')].some(t => t.textContent === ${JSON.stringify(c.toast)} && t.style.opacity === '1');`);
  }

  // Mouse-opened menus on another post copy that post.
  await page.clearClipboard();
  await page.click('#t2 [data-testid="caret"]');
  await page.waitFor('mouse menu', `return document.querySelectorAll('[role="menu"] .site-enhancer-menuitem').length === 3;`);
  await page.click('[role="menu"] .site-enhancer-menuitem:nth-child(1)');
  await page.waitFor('mouse copy', `return document.documentElement.hasAttribute('data-se-test-clipboard');`);
  equal('mouse: second post copied with its own link', await page.clipboard(), [{ text: 'Another post\nhttps://x.com/carol/status/42\n#X', via: 'clipboard' }]);
});

await step('X More menu (Chinese page)', async () => {
  const page = await openPage({ url: 'https://x.com/home?lang=zh-CN' });
  await page.waitFor('content scripts', `return [...document.querySelectorAll('style')].some(s => s.textContent.includes('site-enhancer-menuitem'));`);
  await page.eval(`document.querySelector('#t1 [data-testid="caret"]').focus();`);
  await page.key(' ');
  await page.waitFor('menu', `return document.querySelectorAll('[role="menu"] .site-enhancer-menuitem').length === 3;`);
  equal('zh: labels follow the page language', await page.eval(`return [...document.querySelectorAll('.site-enhancer-menuitem')].map(i => i.textContent);`),
    ['复制推文和链接', '仅复制推文文字', '复制推文链接']);
  await page.shot('x-menu-keyboard-zh');
  await page.close();
});

// ------------------------------------------------------------ linux.do ---

await step('linux.do copy buttons', async () => {
  const page = await openPage({ url: 'https://linux.do/t/topic/3149487?lang=en', width: 900, height: 900 });
  await page.waitFor('buttons on all four posts', `return [1, 2, 3, 4].every(n => document.querySelectorAll('#post_' + n + ' .linux-do-copy-btn').length === 2);`);
  await sleep(300);
  equal('two buttons per post, including a streamed post with late controls', await page.eval(
    `return [1, 2, 3, 4].map(n => document.querySelectorAll('#post_' + n + ' .linux-do-copy-btn').length);`), [2, 2, 2, 2]);
  equal('button labels (en)', await page.eval(`return [...document.querySelectorAll('#post_1 .linux-do-copy-btn')].map(b => b.title);`),
    ['Copy post text only', 'Copy post with link']);
  check('fixture: image captions are part of the rendered text', await page.eval(
    `return document.querySelector('#post_1 .cooked').innerText.includes('b733a3c9.png');`), 'fixture does not render captions');

  const posts = [
    { n: 1, text: 'Opening paragraph with a topic link.\n\nClosing paragraph', url: 'https://linux.do/t/topic/3149487/1' },
    { n: 2, text: 'Reply line one\nReply line two', url: 'https://linux.do/t/topic/3149487/2' },
    { n: 4, text: 'Streamed reply', url: 'https://linux.do/t/topic/3149487/4' },
  ];
  for (const post of posts) {
    await page.clearClipboard();
    await page.click(`#post_${post.n} .linux-do-copy-btn:nth-last-child(1)`);
    await page.waitFor('copy with link', `return document.documentElement.hasAttribute('data-se-test-clipboard');`);
    equal(`post ${post.n}: copy with link (text, post-date permalink, #Linuxdo)`, await page.clipboard(),
      [{ text: `${post.text}\n${post.url}\n#Linuxdo`, via: 'clipboard' }]);
    await page.clearClipboard();
    await page.click(`#post_${post.n} .linux-do-copy-btn:nth-last-child(2)`);
    await page.waitFor('copy text', `return document.documentElement.hasAttribute('data-se-test-clipboard');`);
    equal(`post ${post.n}: copy text only`, await page.clipboard(), [{ text: post.text, via: 'clipboard' }]);
  }
  await page.waitFor('toast', `return document.querySelector('.linux-do-tooltip.show')?.textContent === 'Copied text!';`);
  await page.shot('linux-do-copied-en');
  equal('caption style attributes restored', await page.eval(
    `return [...document.querySelectorAll('.meta')].map(m => m.getAttribute('style'));`), ['color: rgb(250, 250, 250);', null, null]);
  check('captions visible again', await page.eval(`return [...document.querySelectorAll('.meta')].every(m => getComputedStyle(m).display === 'flex');`));

  await page.clearClipboard();
  await page.click('#post_3 .linux-do-copy-btn:nth-last-child(1)');
  await page.waitFor('empty toast', `return document.querySelector('.linux-do-tooltip.show')?.textContent === 'No post text to copy';`);
  equal('image-only post: nothing copied', await page.clipboard(), []);

  // A rejected Clipboard API falls back to execCommand, which is also captured.
  await page.eval(`document.documentElement.setAttribute('data-se-test-clipboard-mode', 'reject');`);
  await page.click('#post_2 .linux-do-copy-btn:nth-last-child(2)');
  await page.waitFor('fallback copy', `return document.documentElement.hasAttribute('data-se-test-clipboard');`);
  equal('fallback: execCommand path copies the same text', await page.clipboard(), [{ text: 'Reply line one\nReply line two', via: 'execCommand' }]);
  await page.close();

  const zh = await openPage({ url: 'https://linux.do/t/topic/3149487?lang=zh-CN', width: 900, height: 900 });
  await zh.waitFor('buttons', `return document.querySelectorAll('#post_1 .linux-do-copy-btn').length === 2;`);
  equal('button labels (zh)', await zh.eval(`return [...document.querySelectorAll('#post_1 .linux-do-copy-btn')].map(b => b.title);`),
    ['仅复制帖子文字', '复制帖子和链接']);
  await zh.close();
});

// --------------------------------------------------------------- popup ---

const popupInit = ({ lang, url, text }) => `(() => {
  Object.defineProperty(Navigator.prototype, 'language', { get: () => ${JSON.stringify(lang)} });
  Object.defineProperty(Navigator.prototype, 'languages', { get: () => [${JSON.stringify(lang)}] });
  ${shim}
  const tab = { id: 4242, url: ${JSON.stringify(url)} };
  for (const api of [globalThis.chrome, globalThis.browser].filter(Boolean)) {
    api.tabs.query = async () => [tab];
    api.scripting.executeScript = async () => [{ result: ${text ? '{ url: tab.url, documentToken: 1, format: "text" }' : 'null'} }];
  }
})();`;

const popupCases = [
  { name: 'x-zh-light', lang: 'zh-CN', dark: false, url: 'https://x.com/home?utm_source=share&s=20' },
  { name: 'x-zh-dark', lang: 'zh-CN', dark: true, url: 'https://x.com/home?utm_source=share&s=20' },
  { name: 'x-en-light', lang: 'en-US', dark: false, url: 'https://x.com/home?utm_source=share&s=20', settings: true },
  { name: 'x-en-dark', lang: 'en-US', dark: true, url: 'https://x.com/home?utm_source=share&s=20' },
  { name: 'x-fr-light', lang: 'fr-FR', dark: false, url: 'https://x.com/home' },
  { name: 'link-en-light', lang: 'en-US', dark: false, url: 'https://example.com/a?id=42&utm_source=x&fbclid=abc&q=a%20b#frag', copy: true },
  { name: 'text-zh-dark', lang: 'zh-CN', dark: true, url: 'https://example.com/notes.txt', text: true, copy: true },
  { name: 'unavailable-en-light', lang: 'en-US', dark: false, url: 'chrome://settings/' },
  { name: 'unavailable-zh-dark', lang: 'zh-CN', dark: true, url: 'chrome://settings/' },
];
const copy = {
  zh: { title: '复制链接', clean: '干净链接', bare: '无参数链接', copied: '已复制', xPage: 'X 页面', layout: ['原版', '简洁', '三栏', '阅读'],
    unavailable: '当前页面无法复制', file: '纯文本文件', reload: '重新读取' },
  en: { title: 'Copy link', clean: 'Clean link', bare: 'Bare link', copied: 'Copied', xPage: 'X page', layout: ['Original', 'Clean', 'Columns', 'Reading'],
    unavailable: 'This page can’t be copied', file: 'Plain text file', reload: 'Reload' },
};

for (const c of popupCases) {
  await step(`popup ${c.name}`, async () => {
    const locale = c.lang.startsWith('zh') ? 'zh' : 'en';
    const t = copy[locale];
    const page = await openPage({ url: `chrome-extension://${extId}/popup.html`, width: 360, height: 600, scale: 2, dark: c.dark, init: popupInit(c) });
    await page.waitFor('popup render', `return document.querySelector('main') && !document.querySelector('.se-tile[disabled]') || document.querySelector('.se-empty');`);
    await sleep(150);
    equal('document language', await page.eval(`return document.documentElement.lang;`), locale === 'zh' ? 'zh-CN' : 'en');
    const bg = await page.eval(`return getComputedStyle(document.documentElement).backgroundColor;`);
    equal(`${c.dark ? 'dark' : 'light'} palette applied`, bg, c.dark ? 'rgb(19, 19, 18)' : 'rgb(242, 241, 237)');
    const body = await page.eval(`return document.body.innerText;`);
    if (c.url.startsWith('chrome:')) {
      check('unavailable state shown', body.includes(t.unavailable) && body.includes(t.reload), body);
    } else {
      check('copy section labels', [t.title, t.clean, t.bare].every(s => body.includes(s)), body);
      check(`no ${locale === 'zh' ? 'English' : 'Chinese'} labels`, locale === 'zh' ? !body.includes('Copy link') : !/[一-鿿]/.test(body), body);
    }
    const onX = c.url.startsWith('https://x.com');
    check(`X section ${onX ? 'shown' : 'hidden'}`, (await page.eval(`return !!document.querySelector('.se-x');`)) === onX);
    if (onX) {
      equal('layout labels', await page.eval(`return [...document.querySelectorAll('.se-seg label')].map(l => l.textContent.trim());`), t.layout);
      equal('X share parameters removed', await page.eval(`return document.querySelector('.se-url').textContent;`), 'https://x.com/home');
      // Every segment and its label must fit; English labels are the widest.
      const overflow = await page.eval(`const seg = document.querySelector('.se-seg'), box = document.querySelector('.se-x').getBoundingClientRect();
        const bad = [];
        if (seg.scrollWidth > seg.clientWidth) bad.push('segment control ' + seg.scrollWidth + '>' + seg.clientWidth);
        if (seg.getBoundingClientRect().right > box.right + 0.5) bad.push('segment control leaves the section');
        for (const label of seg.querySelectorAll('label')) {
          const r = label.getBoundingClientRect(), s = label.querySelector('span').getBoundingClientRect();
          if (label.scrollWidth > label.clientWidth) bad.push(label.textContent + ' scrollWidth ' + label.scrollWidth + '>' + label.clientWidth);
          if (s.left < r.left - 0.5 || s.right > r.right + 0.5) bad.push(label.textContent + ' text outside its segment');
        }
        for (const el of document.querySelectorAll('.se-tile-name, .se-tile-hint, .se-field-name, .se-label'))
          if (el.scrollWidth > el.clientWidth + 1) bad.push(el.textContent + ' overflows');
        if (document.documentElement.scrollWidth > innerWidth) bad.push('page scrolls horizontally');
        return bad;`);
      equal('no overflow in labels and segmented control', overflow, []);
    }
    if (c.text) check('text download row shown', body.includes(t.file) && body.includes('notes.txt'), body);
    const height = Math.ceil(await page.eval(`return document.querySelector('main').getBoundingClientRect().bottom;`));
    await page.shot(`popup-${c.name}`, { x: 0, y: 0, width: 360, height: Math.max(height, 120) });

    if (c.copy) {
      await page.click('.se-tile[data-kind="clean"]');
      await page.waitFor('clean copied', `return document.querySelector('.se-tile[data-kind="clean"]').dataset.state === 'done';`);
      await page.click('.se-tile[data-kind="bare"]');
      await page.waitFor('bare copied', `return document.querySelector('.se-tile[data-kind="bare"]').dataset.state === 'done';`);
      const expected = c.text ? ['https://example.com/notes.txt', 'https://example.com/notes.txt']
        : ['https://example.com/a?id=42&q=a%20b#frag', 'https://example.com/a#frag'];
      equal('clean and bare links copied', (await page.clipboard()).map(r => r.text), expected);
      check('copied state shown in the tile', (await page.eval(`return document.querySelector('.se-tile[data-kind="bare"] .se-tile-hint').textContent;`)) === t.copied);
    }

    if (c.settings && xPage) {
      await page.click('.se-seg label:has(input[value="clean"])');
      await page.click('.se-dots label:has(input[value="forest"])');
      equal('settings stored in the temporary profile', await page.eval(`return chrome.storage.local.get(['xStyle', 'xTheme']);`), { xStyle: 'clean', xTheme: 'forest' });
      equal('open X fixture tab follows the new layout and theme', await xPage.waitFor('X tab update',
        `const r = document.documentElement; return r.getAttribute('data-site-enhancer-x') === 'clean' && r.getAttribute('data-site-enhancer-x-theme') === 'forest'
          && [r.getAttribute('data-site-enhancer-x'), r.getAttribute('data-site-enhancer-x-theme')];`).catch(e => e.message), ['clean', 'forest']);
      await page.shot('popup-x-en-light-changed', { x: 0, y: 0, width: 360, height: Math.max(height, 120) });
      await xPage.shot('x-clean-forest');
    }
    await page.close();
  });
}

// -------------------------------------------------------------- report ---

const offline = blocked.filter(url => !url.startsWith('data:'));
log(`\n${offline.length ? `Blocked ${offline.length} non-fixture request(s): ${offline.slice(0, 5).join(', ')}` : 'No non-fixture requests.'}`);
const passed = results.filter(r => r.ok).length;
writeFileSync(join(outDir, 'report.json'), JSON.stringify({
  browser: browserPath, headless: !headed, extensionId: extId, passed, failed: failures, blocked: offline, results,
}, null, 2));
log(`${passed} passed, ${failures} failed. Screenshots and report.json: ${outDir}`);
clearTimeout(watchdog);
await cleanup();
process.exit(failures || !results.length ? 1 : 0);
