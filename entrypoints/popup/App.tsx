import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { copyToClipboard } from '../../utils/clipboard';
import { getUrlVariants, type UrlVariants } from '../../utils/url';
import './App.css';

type CopyMode = 'clean' | 'bare';
type PageState =
  | { status: 'loading' | 'unavailable' | 'failed' }
  | { status: 'ready'; urls: UrlVariants; title: string };
type CopyState = { status: 'idle' } | { status: 'copying' | 'copied' | 'failed'; mode: CopyMode };

function App() {
  const [page, setPage] = useState<PageState>({ status: 'loading' });
  const [copy, setCopy] = useState<CopyState>({ status: 'idle' });
  const requestId = useRef(0);
  const copying = useRef(false);

  const loadPage = useCallback(async () => {
    const id = ++requestId.current;
    setPage({ status: 'loading' });
    setCopy({ status: 'idle' });
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (id !== requestId.current) return;
      const urls = getUrlVariants(tab?.url);
      setPage(urls ? { status: 'ready', urls, title: tab?.title || urls.hostname } : { status: 'unavailable' });
    } catch {
      if (id === requestId.current) setPage({ status: 'failed' });
    }
  }, []);

  useEffect(() => {
    void loadPage();
    return () => { requestId.current += 1; };
  }, [loadPage]);

  async function handleCopy(mode: CopyMode) {
    if (page.status !== 'ready' || copying.current) return;
    copying.current = true;
    const id = requestId.current;
    setCopy({ status: 'copying', mode });
    try {
      const success = await copyToClipboard(mode === 'clean' ? page.urls.cleanUrl : page.urls.bareUrl);
      if (id === requestId.current) setCopy({ status: success ? 'copied' : 'failed', mode });
    } catch {
      if (id === requestId.current) setCopy({ status: 'failed', mode });
    } finally {
      copying.current = false;
    }
  }

  const ready = page.status === 'ready';
  const showActions = ready || page.status === 'loading';
  const feedback = copy.status === 'copied'
    ? `${copy.mode === 'clean' ? '干净链接' : '无参数链接'}已复制到剪贴板`
    : copy.status === 'failed' ? '复制失败，请重试。' : copy.status === 'copying' ? '正在复制…' : '';

  return (
    <main className="popup">
      <header className="popup-header">
        <h1>复制链接</h1>
        <p className="page-domain" title={ready ? page.title : undefined}>
          {ready ? page.urls.hostname : page.status === 'loading' ? '正在读取当前页面…'
            : page.status === 'failed' ? '暂时无法读取页面' : '当前页面无法复制'}
        </p>
      </header>

      {showActions ? <>
        <div className="copy-actions">
          {(['clean', 'bare'] as const).map(mode => {
            const primary = mode === 'clean';
            const copied = copy.status === 'copied' && copy.mode === mode;
            const busy = copy.status === 'copying' && copy.mode === mode;
            const label = primary ? '复制干净链接' : '复制无参数链接';
            return (
              <section className="copy-row" key={mode} aria-labelledby={`${mode}-title`}>
                <div className="copy-description">
                  <h2 id={`${mode}-title`}>{primary ? '干净链接' : '无参数链接'}</h2>
                  <p id={`${mode}-description`}>{primary ? '去除 UTM 等追踪参数' : '移除全部查询参数'}</p>
                </div>
                <button
                  type="button"
                  className={`copy-button ${primary ? 'primary' : ''} ${copied ? 'is-copied' : ''}`}
                  disabled={!ready || copy.status === 'copying'}
                  aria-label={label}
                  aria-describedby={`${mode}-description`}
                  aria-busy={busy}
                  title={primary ? '清除已知追踪项，保留其他参数与锚点' : '移除全部查询参数，保留锚点；搜索、筛选条件可能丢失'}
                  onClick={() => void handleCopy(mode)}
                >
                  {busy ? '复制中…' : copied ? '已复制' : '复制'}
                </button>
              </section>
            );
          })}
        </div>
        <div className="feedback">
          <span className={copy.status === 'failed' ? undefined : 'sr-only'} role="status" aria-live="polite" aria-atomic="true">{feedback}</span>
        </div>
      </> : <>
        <p className="empty-message">{page.status === 'failed' ? '请重试，或重新打开此面板。' : '请在普通网页中打开此面板。'}</p>
        <button className="retry-button" type="button" onClick={() => void loadPage()}>重新读取</button>
      </>}
    </main>
  );
}

export default App;
