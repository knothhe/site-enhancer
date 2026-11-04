import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailFrameRule } from '../utils/x-detail-rule.ts';
const token = ['a'.repeat(8), 'b'.repeat(4), 'c'.repeat(4), 'd'.repeat(4), 'e'.repeat(12)].join('-');
test('frame exception matches only the exact marked request in its originating X tab', () => {
  const { rule, url } = detailFrameRule(42, 'https://x.com/home', 'https://x.com/alice/status/123', token);
  assert.equal(url, `https://x.com/alice/status/123?__se_detail=${token}&lang=en`);
  assert.deepEqual(rule.condition, { urlFilter: `|${url}|`, initiatorDomains: ['x.com'], tabIds: [42], resourceTypes: ['sub_frame'] });
  assert.deepEqual(rule.action.responseHeaders, [{ header: 'x-frame-options', operation: 'set', value: 'SAMEORIGIN' }]);
});
test('rejects external origins, non-post routes, query injection and malformed senders', () => {
  for (const href of ['https://evil.test/alice/status/123', 'https://twitter.com/alice/status/123', 'https://x.com/home', 'https://x.com/alice/status/123?other=1', 'https://x.com/alice/status/123#foo']) {
    assert.throws(() => detailFrameRule(42, 'https://x.com/home', href, token));
  }
  for (const origin of ['https://notx.com/home', 'https://x.com.evil.test/home', 'http://x.com/home']) {
    assert.throws(() => detailFrameRule(42, origin, 'https://x.com/alice/status/123', token));
  }
  assert.throws(() => detailFrameRule(-1, 'https://x.com/home', 'https://x.com/alice/status/123', token));
  assert.throws(() => detailFrameRule(42, 'https://x.com/home', 'https://x.com/alice/status/123', '*'));
});
test('preserves the page language while bypassing the cached X service-worker shell', () => {
  assert.ok(detailFrameRule(42, 'https://x.com/home', 'https://x.com/alice/status/123', token, 'zh').url.endsWith('&lang=zh'));
  assert.throws(() => detailFrameRule(42, 'https://x.com/home', 'https://x.com/alice/status/123', token, 'zh&other=1'));
});
