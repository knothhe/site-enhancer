import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { getTextDownload, getTextFilename, readTextPage } from '../utils/text-download.ts';

let win: Window | undefined;

function page(contentType: string, text: string, url = 'https://example.com/notes.txt') {
  void win?.happyDOM.close();
  win = new Window({ url });
  Object.defineProperty(win.document, 'contentType', { configurable: true, value: contentType });
  const pre = win.document.createElement('pre');
  pre.textContent = text;
  win.document.body.append(pre);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: win.location });
}

afterEach(async () => {
  await win?.happyDOM.close();
  win = undefined;
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'location');
});

test('detects the document MIME type without relying on the URL extension or a pre element', () => {
  page('text/plain', 'hello', 'https://example.com/api/export?token=abc');
  assert.deepEqual(readTextPage(), { url: 'https://example.com/api/export?token=abc', documentToken: performance.timeOrigin, format: 'text' });
  Object.defineProperty(win!.document, 'contentType', { configurable: true, value: 'text/html' });
  win!.location.href = 'https://example.com/fake.txt';
  assert.equal(readTextPage(true), null);
});

test('does not offer text downloads on HTML, XML, SVG, or browser-internal documents', () => {
  for (const contentType of ['text/html', 'application/xhtml+xml', 'application/notjson', 'text/xml', 'image/svg+xml']) {
    page(contentType, 'text');
    assert.equal(readTextPage(), null);
  }
  page('text/plain', 'secret', 'file:///tmp/notes.txt');
  assert.equal(readTextPage(), null);
});

test('preserves Unicode, whitespace, literal markup and URL-sensitive characters through a UTF-8 download', async () => {
  const text = '  中文 😀\n\n\t<script>literal</script> & ? # % +\n';
  page('text/plain', text);
  const detected = readTextPage()!;
  const download = getTextDownload(readTextPage(true), detected);
  assert.equal(await (await fetch(download.url)).text(), text);
  assert.equal(download.filename, 'notes.txt');
  assert.equal(download.saveAs, false);
  assert.equal(download.conflictAction, 'uniquify');
});

test('downloads empty text and plain-text documents with no browser pre wrapper', async () => {
  page('text/plain', '');
  const detected = readTextPage()!;
  assert.equal(await (await fetch(getTextDownload(readTextPage(true), detected).url)).text(), '');
  win!.document.body.textContent = 'no wrapper\n';
  assert.equal(readTextPage(true)?.text, 'no wrapper\n');
});

test('refuses downloads when the document reloads, navigates, becomes HTML or cannot be read', () => {
  const expected = { url: 'https://example.com/notes.txt', documentToken: 42, format: 'text' as const };
  for (const current of [
    null, undefined, expected,
    { ...expected, documentToken: 43, text: 'refreshed' },
    { ...expected, format: 'json' as const, text: '{}' },
    { ...expected, url: 'https://example.com/other.txt', text: 'other' },
  ]) assert.throws(() => getTextDownload(current, expected), /document changed/);
  page('text/html', 'not plain text');
  assert.throws(() => getTextDownload(readTextPage(true), expected));
});

test('uses decoded path filenames, preserves existing extensions and ignores query strings and fragments', () => {
  assert.equal(getTextFilename('https://example.com/%E8%AF%B4%E6%98%8E.md?token=secret#part'), '说明.md');
  assert.equal(getTextFilename('https://example.com/export?filename=other.txt'), 'export.txt');
  assert.equal(getTextFilename('https://example.com/'), 'example.com.txt');
  assert.equal(getTextFilename('https://example.com/%ZZ'), '%ZZ.txt');
});

test('makes URL-derived filenames safe for local download directories', () => {
  assert.equal(getTextFilename('https://example.com/..%2F..%5Cevil%3Aname%00'), '_.._evil_name_.txt');
  assert.equal(getTextFilename('https://example.com/CON.txt'), '_CON.txt');
  assert.equal(getTextFilename('https://example.com/%20.%20'), 'download.txt');
  assert.ok(getTextFilename(`https://example.com/${'长'.repeat(200)}`).length < 100);
});

test('recognizes JSON document types including structured suffixes without reading their content on detection', () => {
  for (const mime of ['application/json', 'text/json', 'application/ld+json', 'application/problem+json', 'application/vnd.api+json', 'APPLICATION/JSON']) {
    page(mime, '{"data":[]}', 'https://example.com/runs?limit=100');
    assert.deepEqual(readTextPage(), {
      url: 'https://example.com/runs?limit=100', documentToken: performance.timeOrigin, format: 'json',
    });
  }
});

test('does not mistake similarly named or executable MIME types for JSON', () => {
  for (const mime of ['application/jsonp', 'application/json-seq', 'application/notjson', 'text/javascript', 'text/html', 'image/json']) {
    page(mime, '{"data":[]}', 'https://example.com/result.json');
    assert.equal(readTextPage(), null);
  }
});

test('exports JSON source verbatim without losing large integers or reformatting whitespace', async () => {
  const source = '{\n  "id": 9007199254740993, "text": "中文 😀", "escaped": "\\u4e2d"\n}\n';
  page('application/json', source, 'https://example.com/runs?limit=100&sort=asc');
  const detected = readTextPage()!;
  const download = getTextDownload(readTextPage(true), detected);
  const response = await fetch(download.url);
  assert.equal(response.headers.get('content-type'), 'application/json;charset=utf-8');
  assert.equal(await response.text(), source);
  assert.equal(download.filename, 'runs.json');
});

test('JSON responses always get a .json filename regardless of path extension', () => {
  for (const [url, filename] of [
    ['https://example.com/runs?limit=100&sort=asc', 'runs.json'],
    ['https://example.com/data.json', 'data.json'],
    ['https://example.com/data.JSON', 'data.json'],
    ['https://example.com/data.txt', 'data.json'],
    ['https://example.com/api.php?secret=not-in-filename', 'api.json'],
    ['https://example.com/%E6%95%B0%E6%8D%AE', '数据.json'],
    ['https://example.com/', 'example.com.json'],
    ['https://example.com/CON.txt', '_CON.json'],
  ]) assert.equal(getTextFilename(url, 'json'), filename);
});
