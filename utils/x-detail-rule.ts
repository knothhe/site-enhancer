/** A per-tab exception only for the exact extension-created detail request. */
export function detailFrameRule(tabId: number, senderUrl: string, href: unknown, token: unknown, language: unknown = 'en') {
  if (!Number.isInteger(tabId) || tabId < 0 || typeof href !== 'string' || typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid detail request');
  const sender = new URL(senderUrl);
  const url = new URL(href);
  if (sender.protocol !== 'https:' || !/(^|\.)(x|twitter)\.com$/.test(sender.hostname) || url.origin !== sender.origin ||
    !/^\/(?:\w+\/status|i\/web\/status)\/\d+\/?$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid detail origin or route');
  if (typeof language !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) || language.length > 35) throw new Error('Invalid language');
  url.searchParams.set('__se_detail', token);
  // X's service worker bypasses its cached app shell for an explicit language.
  // Preserve the current UI language so the request reaches the network/DNR rule.
  url.searchParams.set('lang', language);
  return {
    url: url.href,
    rule: {
      id: tabId + 1,
      priority: 1,
      action: { type: 'modifyHeaders' as const, responseHeaders: [{ header: 'x-frame-options', operation: 'set' as const, value: 'SAMEORIGIN' }] },
      condition: { urlFilter: `|${url.href}|`, initiatorDomains: [sender.hostname], tabIds: [tabId], resourceTypes: ['sub_frame' as const] },
    },
  };
}
