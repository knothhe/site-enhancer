import { detailFrameRule } from '../utils/x-detail-rule';

export default defineBackground(() => {
  // Serialize per-tab updates so a close or a newer selection always wins.
  const pending = new Map<number, Promise<unknown>>();
  function enqueue(tabId: number, work: () => Promise<unknown>) {
    const next = (pending.get(tabId) ?? Promise.resolve()).catch(() => {}).then(work);
    pending.set(tabId, next);
    void next.finally(() => { if (pending.get(tabId) === next) pending.delete(tabId); }).catch(() => {});
    return next;
  }
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'x-detail-prepare' && message?.type !== 'x-detail-release') return;
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId !== 0 || !sender.url || !/^https:\/\/([\w-]+\.)*(x|twitter)\.com\//.test(sender.url)) return;
    const senderUrl = sender.url;
    void enqueue(tabId, async () => {
      if (message.type === 'x-detail-release') {
        await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId + 1] });
        return { ok: true };
      }
      const { url, rule } = detailFrameRule(tabId, senderUrl, message.url, message.token, message.language);
      await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
      return { ok: true, url };
    }).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  });
  browser.tabs.onRemoved.addListener(tabId => {
    void enqueue(tabId, () => browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId + 1] })).catch(() => {});
  });
});
