import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLocale, resolveLocale } from '../utils/i18n.ts';
import { MESSAGES } from '../entrypoints/popup/messages.ts';
import { X_STYLE_OPTIONS, X_STYLES } from '../utils/x-style.ts';
import { X_THEME_LABELS, X_THEME_NAMES } from '../utils/x-theme.ts';

const CJK = /[㐀-鿿]/;

test('follows the browser language and falls back to English', () => {
  for (const tag of ['zh', 'zh-CN', 'zh-TW', 'zh-Hant-HK', 'ZH-cn']) assert.equal(resolveLocale(tag), 'zh', tag);
  for (const tag of ['en', 'en-US', 'ja', 'fr-FR', '', undefined]) assert.equal(resolveLocale(tag), 'en', String(tag));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    for (const [language, locale] of [['zh-CN', 'zh'], ['de-DE', 'en']] as const) {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language } });
      assert.equal(browserLocale(), locale);
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    assert.equal(browserLocale(), 'en');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
  }
});

/** Flattens string values (and function results) so both dictionaries can be compared. */
function strings(value: unknown, path = ''): Record<string, string> {
  if (typeof value === 'string') return { [path]: value };
  if (typeof value === 'function') return { [path]: value('X') };
  return Object.assign({}, ...Object.entries(value as object).map(([key, item]) => strings(item, path ? `${path}.${key}` : key)));
}

test('popup, layout and theme copy is complete in both languages', () => {
  const zh = strings(MESSAGES.zh);
  const en = strings(MESSAGES.en);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const [key, text] of Object.entries(en)) {
    assert.ok(text.trim() && !CJK.test(text), `en ${key}: ${text}`);
    assert.ok(zh[key].trim() && CJK.test(zh[key]) || /^[A-Z ]+$/i.test(zh[key].replace(/X|JSON/g, '')), `zh ${key}: ${zh[key]}`);
  }
  assert.equal(MESSAGES.zh.copiedNotice(MESSAGES.zh.clean.name), '干净链接已复制到剪贴板');
  assert.equal(MESSAGES.en.copiedNotice(MESSAGES.en.bare.name), 'Bare link copied to clipboard');
  for (const value of X_STYLES) {
    for (const field of ['label', 'description'] as const) {
      assert.ok(CJK.test(X_STYLE_OPTIONS.zh[value][field]), `zh ${value} ${field}`);
      assert.ok(!CJK.test(X_STYLE_OPTIONS.en[value][field]), `en ${value} ${field}`);
    }
  }
  for (const value of X_THEME_NAMES) {
    assert.ok(CJK.test(X_THEME_LABELS.zh[value]), `zh ${value}`);
    assert.ok(/^[A-Z][a-z]+$/.test(X_THEME_LABELS.en[value]), `en ${value}`);
  }
});
