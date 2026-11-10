import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXThemeCss, detectXTone, installXTheme, isXTheme, readCachedXTheme, xThemeLabel,
  X_PALETTE_CSS, X_THEME_ATTR, X_THEME_CACHE_KEY, X_THEME_NAMES, X_THEMES, X_TONE_ATTR,
} from '../utils/x-theme.ts';

const rule = (selectorText: string, declarations: Record<string, string>) => ({
  selectorText, style: { getPropertyValue: (property: string) => declarations[property] ?? '' },
});
const scope = ':root[s]';

test('detects X themes from the body background', () => {
  assert.equal(detectXTone('rgb(0, 0, 0)'), 'dark');
  assert.equal(detectXTone('rgb(21,32,43)'), 'dim');
  assert.equal(detectXTone('rgb(255, 255, 255)'), 'light');
  assert.equal(detectXTone('rgb(1, 2, 3)'), undefined);
});

test('maps atomic theme classes to palette variables by property', () => {
  const css = buildXThemeCss([
    rule('.r-kemksi', { 'background-color': 'rgb(0, 0, 0)' }),
    rule('.r-1bwzh9t', { color: 'rgb(113, 118, 123)' }),
    rule('.r-1igl3o0', { 'border-bottom-color': 'rgb(47, 51, 54)' }),
    rule('.r-cb91bn', { 'background-image': 'linear-gradient(transparent, rgb(0, 0, 0))' }),
    rule('.r-1sw30gj', { 'background-color': 'rgb(239, 243, 244)' }),
    rule('.foo .r-kemksi', { 'background-color': 'rgb(0, 0, 0)' }),
  ], 'dark', scope);
  assert.match(css, /:root\[s\] \.r-kemksi\{background-color:var\(--se-x-bg\)!important\}/);
  assert.match(css, /\.r-1bwzh9t\{color:var\(--se-x-muted\)!important\}/);
  assert.match(css, /\.r-1igl3o0\{border-bottom-color:var\(--se-x-border\)!important\}/);
  assert.match(css, /\.r-cb91bn\{background-image:linear-gradient\(transparent, var\(--se-x-bg\)\)!important\}/);
  // The dark theme's light "Post" button and compound selectors stay untouched.
  assert.ok(!css.includes('.r-1sw30gj'));
  assert.ok(!css.includes('.foo'));
});

test('covers inline colors without confusing background-color with color', () => {
  const css = buildXThemeCss([], 'light', scope);
  assert.ok(css.includes(`${scope} [style^="color: rgb(83, 100, 113)"],${scope} [style*=" color: rgb(83, 100, 113)"]{color:var(--se-x-muted)!important}`));
  assert.ok(css.includes(`${scope} [style*="background-color: rgb(255, 255, 255)"]{background-color:var(--se-x-bg)!important}`));
  assert.ok(!css.includes('[style*="background-color: rgb(15, 20, 25)"]'));
});

test('every theme defines all palette tokens for light and dark', () => {
  const tokens = ['bg', 'raised', 'input', 'border', 'text', 'muted', 'veil', 'accent'];
  assert.ok(Object.keys(X_THEMES).length >= 6);
  for (const [name, theme] of Object.entries(X_THEMES)) {
    for (const tone of ['light', 'dark'] as const) {
      assert.deepEqual(Object.keys(theme[tone]).sort(), [...tokens].sort(), `${name} ${tone}`);
      assert.ok(X_PALETTE_CSS.includes(`[${X_THEME_ATTR}="${name}"][${X_TONE_ATTR}="${tone}"]`));
    }
  }
  assert.equal(X_THEME_NAMES[0], 'original');
  assert.ok(isXTheme('forest') && !isXTheme('neon'));
  assert.equal(xThemeLabel('original', 'zh'), '原版');
  assert.equal(xThemeLabel('original', 'en'), 'Original');
  assert.equal(xThemeLabel('dusk', 'en'), 'Dusk');
});

test('applies themes independently of layout and restores the original page', async () => {
  const { Window } = await import('happy-dom');
  const win = new Window({ url: 'https://x.com/home' });
  for (const name of ['window', 'document', 'localStorage', 'Element', 'HTMLStyleElement']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : (win as any)[name] });
  }
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: win.getComputedStyle.bind(win) });
  try {
    const root = document.documentElement;
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    localStorage.setItem(X_THEME_CACHE_KEY, 'ocean');
    assert.equal(readCachedXTheme(), 'ocean');
    const theme = installXTheme();
    assert.equal(root.getAttribute(X_THEME_ATTR), 'ocean');
    assert.equal(root.getAttribute(X_TONE_ATTR), 'light');
    assert.equal(root.hasAttribute('data-site-enhancer-x'), false);
    assert.ok(document.getElementById('site-enhancer-x-palette')?.textContent?.includes('--se-x-accent:#0b7bbf'));
    theme.setTheme('original');
    assert.equal(root.hasAttribute(X_THEME_ATTR), false);
    assert.equal(document.getElementById('site-enhancer-x-theme')?.textContent, '');
    // A newer instance replaces the stylesheets; the old one's cleanup must not undo it.
    const newer = installXTheme('rose');
    theme.remove();
    assert.equal(root.getAttribute(X_THEME_ATTR), 'rose');
    assert.equal(document.querySelectorAll('#site-enhancer-x-palette').length, 1);
    newer.remove();
    assert.equal(document.getElementById('site-enhancer-x-palette'), null);
    assert.equal(root.hasAttribute(X_THEME_ATTR), false);
  } finally {
    await win.happyDOM.close();
  }
});
