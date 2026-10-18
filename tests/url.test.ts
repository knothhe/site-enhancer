import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUrlVariants } from '../utils/url.ts';

test('removes UTM and known click identifiers, retaining useful parameters and the anchor', () => {
  assert.deepEqual(getUrlVariants('https://example.com/article?utm_source=mail&page=2&fbclid=abc&utm_medium=email#tips'), {
    hostname: 'example.com',
    cleanUrl: 'https://example.com/article?page=2#tips',
    bareUrl: 'https://example.com/article#tips',
    removedCount: 3,
  });
});

test('handles encoded, mixed-case and repeated tracking keys', () => {
  const result = getUrlVariants('https://example.com/?%75tm_Source=a&UTM_campaign=b&gclid=1&gclid=2&q=hello');
  assert.equal(result?.cleanUrl, 'https://example.com/?q=hello');
  assert.equal(result?.removedCount, 4);
});

test('preserves retained encodings, duplicate keys, empty values, and parameter order', () => {
  const result = getUrlVariants('https://example.com/a?tag=a%20b&tag=c+d&empty=&flag&sig=%2f%7e%2B&utm_source=x#part%202');
  assert.equal(result?.cleanUrl, 'https://example.com/a?tag=a%20b&tag=c+d&empty=&flag&sig=%2f%7e%2B#part%202');
  assert.equal(result?.bareUrl, 'https://example.com/a#part%202');
});

test('does not modify URLs without known tracking parameters', () => {
  for (const source of [
    'https://example.com/',
    'https://example.com/a?q=a%20b&ref=guide&source=docs&s=search&t=42&si=units',
    'https://example.com/a?',
    'https://example.com/a?signature=abc%2fdef&expires=123#anchor',
  ]) {
    assert.equal(getUrlVariants(source)?.cleanUrl, source);
    assert.equal(getUrlVariants(source)?.removedCount, 0);
  }
});

test('does not mistake parameter values or path segments for tracking keys', () => {
  assert.equal(getUrlVariants('https://example.com/utm_source?q=utm_source%3Dtest&next=https%3A%2F%2Fx.com%2F%3Fs%3D20')?.cleanUrl,
    'https://example.com/utm_source?q=utm_source%3Dtest&next=https%3A%2F%2Fx.com%2F%3Fs%3D20');
});

test('removes a query consisting entirely of tracking parameters without a dangling question mark', () => {
  assert.equal(getUrlVariants('https://example.com/a?utm_source=x&fbclid=y#section')?.cleanUrl, 'https://example.com/a#section');
  assert.equal(getUrlVariants('https://example.com/a?utm_source=x&&')?.cleanUrl, 'https://example.com/a');
});

test('bare links remove every query parameter and keep the full fragment, including hash routes', () => {
  assert.equal(getUrlVariants('https://example.com/search?q=test&page=2#results')?.bareUrl, 'https://example.com/search#results');
  assert.equal(getUrlVariants('https://example.com/?utm_source=x#/article/42?view=full')?.bareUrl, 'https://example.com/#/article/42?view=full');
  assert.equal(getUrlVariants('https://example.com/#anchor?not-a-query')?.cleanUrl, 'https://example.com/#anchor?not-a-query');
});

test('removes short tracking names only on X and Twitter domains', () => {
  for (const host of ['x.com', 'www.x.com', 'twitter.com', 'mobile.twitter.com']) {
    assert.equal(getUrlVariants(`https://${host}/author/status/123?s=20&t=token&ref_src=share&lang=zh`)?.cleanUrl,
      `https://${host}/author/status/123?lang=zh`);
  }
  assert.equal(getUrlVariants('https://notx.com/?s=20&t=token')?.cleanUrl, 'https://notx.com/?s=20&t=token');
});

test('clears YouTube share identifiers while keeping video and playback position', () => {
  for (const source of ['https://www.youtube.com/watch?v=abc&si=share&t=42', 'https://youtu.be/abc?si=share&t=42']) {
    assert.equal(getUrlVariants(source)?.cleanUrl, source.replace(/si=share&/, ''));
  }
});

test('rejects unavailable, malformed, local and browser-internal URLs', () => {
  for (const source of [undefined, '', 'not a URL', '/relative', 'file:///tmp/a.html', 'chrome://settings/', 'about:blank', 'javascript:alert(1)', 'data:text/plain,hello', 'chrome-extension://abc/popup.html']) {
    assert.equal(getUrlVariants(source), null);
  }
});

test('supports plain HTTP and retains custom ports', () => {
  assert.deepEqual(getUrlVariants('http://localhost:4321/a?utm_source=local&debug=1#test'), {
    hostname: 'localhost:4321', cleanUrl: 'http://localhost:4321/a?debug=1#test',
    bareUrl: 'http://localhost:4321/a#test', removedCount: 1,
  });
});
