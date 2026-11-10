import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  installXStyle, isXHost, isXStyle, readCachedXStyle,
  X_PAGE_ATTR, X_STYLE_ATTR, X_STYLE_CACHE_KEY, X_STYLE_CSS, X_STYLE_OPTIONS, X_STYLES,
} from '../utils/x-style.ts';

let win: Window;

beforeEach(() => {
  win = new Window({ url: 'https://x.com/home' });
  for (const name of ['window', 'document', 'location', 'localStorage', 'Element', 'getComputedStyle']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : name === 'getComputedStyle' ? win.getComputedStyle.bind(win) : (win as any)[name] });
  }
});
afterEach(async () => { await win.happyDOM.close(); });

const root = () => document.documentElement;

test('recognizes X hosts and style values', () => {
  for (const host of ['x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com']) assert.ok(isXHost(host), host);
  for (const host of ['notx.com', 'x.com.evil.test', 'example.com', undefined]) assert.ok(!isXHost(host), String(host));
  assert.deepEqual(X_STYLES.map(value => X_STYLE_OPTIONS.zh[value].label), ['原版', '简洁', '三栏', '阅读']);
  assert.deepEqual(X_STYLES.map(value => X_STYLE_OPTIONS.en[value].label), ['Original', 'Clean', 'Columns', 'Reading']);
  assert.ok(isXStyle('reading'));
  assert.ok(!isXStyle('style3'));
});

test('applies the cached style once and switches without duplicating the stylesheet', () => {
  localStorage.setItem(X_STYLE_CACHE_KEY, 'reading');
  assert.equal(readCachedXStyle(), 'reading');
  const xStyle = installXStyle();
  assert.equal(root().getAttribute(X_STYLE_ATTR), 'reading');
  assert.equal(root().getAttribute(X_PAGE_ATTR), 'home');
  const second = installXStyle('clean');
  assert.equal(document.querySelectorAll('#site-enhancer-x-style').length, 1);
  assert.equal(root().getAttribute(X_STYLE_ATTR), 'clean');

  xStyle.setStyle('original');
  assert.equal(root().hasAttribute(X_STYLE_ATTR), false);
  assert.equal(localStorage.getItem(X_STYLE_CACHE_KEY), 'original');

  xStyle.setPage('/someone/status/1');
  assert.equal(root().hasAttribute(X_PAGE_ATTR), false);
  // The superseded instance must not undo the state owned by the newer one.
  xStyle.remove();
  assert.ok(document.getElementById('site-enhancer-x-style'));
  second.setStyle('clean');
  assert.equal(root().getAttribute(X_STYLE_ATTR), 'clean');
  second.remove();
  assert.equal(document.getElementById('site-enhancer-x-style'), null);
});

test('ignores an invalid cached value', () => {
  localStorage.setItem(X_STYLE_CACHE_KEY, 'bogus');
  assert.equal(readCachedXStyle(), 'original');
});

test('layout styles leave the original page untouched, set no colors and scope home-only rules', () => {
  assert.ok(!X_STYLE_CSS.includes('"original"'));
  assert.ok(!/(?:^|[;{\s])(?:color|background(?:-color)?)\s*:/m.test(X_STYLE_CSS), 'colors belong to themes');
  for (const line of X_STYLE_CSS.split('\n').filter(line => line.includes('UserCell'))) {
    assert.ok(line.includes(`[${X_PAGE_ATTR}="home"]`), line);
  }
  // Every selector in the shared block must be valid CSS for the browser to apply the rule.
  const sheet = new win.CSSStyleSheet();
  assert.doesNotThrow(() => sheet.replaceSync(X_STYLE_CSS));
});
