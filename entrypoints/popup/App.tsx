import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { browser } from 'wxt/browser';
import { copyToClipboard } from '../../utils/clipboard';
import { getUrlVariants, type UrlVariants } from '../../utils/url';
import { getTextDownload, getTextFilename, readTextPage, type TextPage } from '../../utils/text-download';
import { isXHost, X_STYLE_OPTIONS, X_STYLES, type XStyle } from '../../utils/x-style';
import { X_THEME_NAMES, X_THEMES, xThemeLabel, type XTheme } from '../../utils/x-theme';
import { xStyleSetting, xThemeSetting } from '../../utils/x-settings';
import './App.css';

type CopyMode = 'clean' | 'bare';
type PageState =
  | { status: 'loading' | 'unavailable' | 'failed' }
  | { status: 'ready'; urls: UrlVariants; title: string; tabId?: number; textPage?: TextPage };
type CopyState = { status: 'idle' } | { status: 'copying' | 'copied' | 'failed'; mode: CopyMode };
type DownloadState = 'idle' | 'preparing' | 'started' | 'failed';

/** Loads a stored setting and saves changes optimistically, reverting on failure. */
function useSetting<T extends string>(setting: { get(): Promise<T>; set(value: T): Promise<void> }) {
  const [value, setValue] = useState<T>('original' as T);
  const [failed, setFailed] = useState(false);
  const current = useRef(value);
  const changed = useRef(false);
  useEffect(() => {
    setting.get().then(stored => {
      // Do not overwrite a choice made while the stored value was loading.
      if (changed.current) return;
      current.current = stored;
      setValue(stored);
    }, () => setFailed(true));
  }, [setting]);
  async function update(next: T) {
    changed.current = true;
    const previous = current.current;
    current.current = next;
    setValue(next);
    setFailed(false);
    try {
      await setting.set(next);
    } catch {
      current.current = previous;
      setValue(previous);
      setFailed(true);
    }
  }
  return [value, update, failed] as const;
}

const ORIGINAL_SWATCH = { light: { bg: '#ffffff', accent: '#1d9bf0' }, dark: { bg: '#000000', accent: '#1d9bf0' } };

function swatchStyle(theme: XTheme): CSSProperties {
  const colors = theme === 'original' ? ORIGINAL_SWATCH : X_THEMES[theme];
  return {
    '--swatch-light-bg': colors.light.bg, '--swatch-light-accent': colors.light.accent,
    '--swatch-dark-bg': colors.dark.bg, '--swatch-dark-accent': colors.dark.accent,
  } as CSSProperties;
}

function App() {
  const [page, setPage] = useState<PageState>({ status: 'loading' });
  const [copy, setCopy] = useState<CopyState>({ status: 'idle' });
  const [download, setDownload] = useState<DownloadState>('idle');
  const [xStyle, setXStyle, xStyleFailed] = useSetting<XStyle>(xStyleSetting);
  const [xTheme, setXTheme, xThemeFailed] = useSetting<XTheme>(xThemeSetting);
  const requestId = useRef(0);
  const copying = useRef(false);
  const downloading = useRef(false);

  const loadPage = useCallback(async () => {
    const id = ++requestId.current;
    setPage({ status: 'loading' });
    setCopy({ status: 'idle' });
    setDownload('idle');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (id !== requestId.current) return;
      const urls = getUrlVariants(tab?.url);
      setPage(urls ? { status: 'ready', urls, title: tab?.title || urls.hostname } : { status: 'unavailable' });
      if (urls && tab?.id !== undefined) {
        // A restricted page may allow URL copying but reject script injection.
        // Keep both existing copy actions available if detection is unavailable.
        try {
          const [result] = await browser.scripting.executeScript({
            target: { tabId: tab.id }, func: readTextPage,
          });
          if (id !== requestId.current) return;
          if (result?.result && result.result.url === tab.url) {
            setPage({ status: 'ready', urls, title: tab.title || urls.hostname, tabId: tab.id, textPage: result.result });
          }
        } catch { /* Text detection is optional for the copy actions. */ }
      }
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

  async function handleDownload() {
    if (page.status !== 'ready' || !page.textPage || page.tabId === undefined || downloading.current) return;
    downloading.current = true;
    const id = requestId.current;
    setDownload('preparing');
    try {
      const [result] = await browser.scripting.executeScript({
        target: { tabId: page.tabId }, func: readTextPage, args: [true],
      });
      if (id !== requestId.current) return;
      await browser.downloads.download(getTextDownload(result?.result, page.textPage));
      if (id === requestId.current) setDownload('started');
    } catch {
      if (id === requestId.current) setDownload('failed');
    } finally {
      downloading.current = false;
    }
  }

  const ready = page.status === 'ready';
  const isJson = ready && page.textPage?.format === 'json';
  const downloadFilename = ready && page.textPage ? getTextFilename(page.textPage.url, page.textPage.format) : '';
  const showActions = ready || page.status === 'loading';
  const onX = ready && isXHost(page.urls.hostname);
  const feedback = copy.status === 'copied'
    ? `${copy.mode === 'clean' ? '干净链接' : '无参数链接'}已复制到剪贴板`
    : copy.status === 'failed' ? '复制失败，请重试。' : copy.status === 'copying' ? '正在复制…' : '';

  return (
    <main className="popup">
      <header className="popup-header">
        <h1 title={ready ? page.title : undefined}>{ready ? page.urls.hostname : 'site-enhancer'}</h1>
        {!ready && <p className="page-domain">
          {page.status === 'loading' ? '正在读取当前页面…' : page.status === 'failed' ? '暂时无法读取页面' : '当前页面无法复制'}
        </p>}
      </header>

      {onX && <section className="panel-section" aria-labelledby="x-page-title">
        <h2 className="section-title" id="x-page-title">X 页面</h2>
        <div className="setting-row">
          <span className="setting-label" id="x-style-label">布局</span>
          <div className="segmented" role="radiogroup" aria-labelledby="x-style-label">
            {X_STYLES.map(value => (
              <label key={value} className={xStyle === value ? 'is-selected' : undefined} title={X_STYLE_OPTIONS[value].description}>
                <input
                  type="radio"
                  name="x-style"
                  value={value}
                  checked={xStyle === value}
                  aria-description={X_STYLE_OPTIONS[value].description}
                  onChange={() => void setXStyle(value)}
                />
                <span>{X_STYLE_OPTIONS[value].label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label" id="x-theme-label">主题<b>{xThemeLabel(xTheme)}</b></span>
          <div className="swatches" role="radiogroup" aria-labelledby="x-theme-label">
            {X_THEME_NAMES.map(value => (
              <label key={value} className={`swatch ${xTheme === value ? 'is-selected' : ''}`} title={xThemeLabel(value)} style={swatchStyle(value)}>
                <input
                  type="radio"
                  name="x-theme"
                  value={value}
                  checked={xTheme === value}
                  aria-label={xThemeLabel(value)}
                  onChange={() => void setXTheme(value)}
                />
              </label>
            ))}
          </div>
        </div>
        <p className={xStyleFailed || xThemeFailed ? 'section-error' : 'sr-only'} role="status" aria-live="polite">
          {xStyleFailed || xThemeFailed ? '设置保存失败，请重试。' : ''}
        </p>
      </section>}

      {showActions ? <>
        <h2 className="section-title">复制链接</h2>
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
                </div>
                <button
                  type="button"
                  className={`copy-button ${primary ? 'primary' : ''} ${copied ? 'is-copied' : ''}`}
                  disabled={!ready || copy.status === 'copying'}
                  aria-label={label}
                  aria-busy={busy}
                  title={primary ? '清除已知追踪项，保留其他参数与锚点' : '移除全部查询参数，保留锚点；搜索、筛选条件可能丢失'}
                  onClick={() => void handleCopy(mode)}
                >
                  {busy ? '复制中…' : copied ? '已复制' : '复制'}
                </button>
              </section>
            );
          })}
          {ready && page.textPage && <section className="copy-row" aria-labelledby="download-title">
            <div className="copy-description">
              <h2 id="download-title">{isJson ? 'JSON 文件' : '纯文本文件'}</h2>
              <p id="download-description" className="download-filename" title={downloadFilename}>
                {downloadFilename}
              </p>
            </div>
            <button
              type="button"
              className={`copy-button ${download === 'started' ? 'is-copied' : ''}`}
              disabled={download === 'preparing'}
              aria-label={isJson ? '下载 JSON' : '下载文本'}
              aria-describedby="download-description"
              aria-busy={download === 'preparing'}
              title={`将当前${isJson ? ' JSON ' : '纯文本'}内容保存到浏览器的下载目录`}
              onClick={() => void handleDownload()}
            >
              {download === 'preparing' ? '准备中…' : download === 'started' ? '已开始' : download === 'failed' ? '重试' : '下载'}
            </button>
          </section>}
        </div>
        <div className="feedback">
          <span className={copy.status === 'failed' ? undefined : 'sr-only'} role="status" aria-live="polite" aria-atomic="true">{feedback}</span>
          <span className={download === 'failed' ? undefined : 'sr-only'} role="status" aria-live="polite" aria-atomic="true">
            {download === 'failed' ? '下载失败，请重试或重新打开面板。' : download === 'started' ? '已开始下载，请在浏览器下载列表中查看。' : download === 'preparing' ? '正在准备下载…' : ''}
          </span>
        </div>
      </> : <>
        <button className="retry-button" type="button" onClick={() => void loadPage()}>重新读取</button>
      </>}
    </main>
  );
}

export default App;
