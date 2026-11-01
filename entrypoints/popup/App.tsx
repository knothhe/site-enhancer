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
  | { status: 'ready'; urls: UrlVariants; tabId?: number; textPage?: TextPage };
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
      setPage(urls ? { status: 'ready', urls } : { status: 'unavailable' });
      if (urls && tab?.id !== undefined) {
        // A restricted page may allow URL copying but reject script injection.
        // Keep both existing copy actions available if detection is unavailable.
        try {
          const [result] = await browser.scripting.executeScript({
            target: { tabId: tab.id }, func: readTextPage,
          });
          if (id !== requestId.current) return;
          if (result?.result && result.result.url === tab.url) {
            setPage({ status: 'ready', urls, tabId: tab.id, textPage: result.result });
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
  const downloadFeedback = download === 'failed' ? '下载失败，请重试或重新打开面板。'
    : download === 'started' ? '已开始下载，请在浏览器下载列表中查看。'
      : download === 'preparing' ? '正在准备下载…' : '';
  const settingsFailed = xStyleFailed || xThemeFailed;
  const notice = copy.status === 'failed' ? feedback : download === 'failed' ? downloadFeedback : '';

  return (
    <main className="se">
      {showActions ? <>
        <section className="se-block" aria-labelledby="copy-title">
          <h2 className="se-label" id="copy-title">复制链接</h2>
          <div className="se-copy">
            {(['clean', 'bare'] as const).map(mode => {
              const primary = mode === 'clean';
              const copied = copy.status === 'copied' && copy.mode === mode;
              const busy = copy.status === 'copying' && copy.mode === mode;
              const failed = copy.status === 'failed' && copy.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  className="se-tile"
                  data-kind={mode}
                  data-state={copied ? 'done' : busy ? 'busy' : failed ? 'error' : undefined}
                  disabled={!ready || copy.status === 'copying'}
                  aria-label={primary ? '复制干净链接' : '复制无参数链接'}
                  aria-busy={busy}
                  title={primary ? '清除已知追踪项，保留其他参数与锚点' : '移除全部查询参数，保留锚点；搜索、筛选条件可能丢失'}
                  onClick={() => void handleCopy(mode)}
                >
                  <span className="se-tile-icon" aria-hidden="true">{copied ? <IconCheck /> : primary ? <IconSpark /> : <IconLink />}</span>
                  <span className="se-tile-name">{primary ? '干净链接' : '无参数链接'}</span>
                  <span className="se-tile-hint">{busy ? '复制中…' : copied ? '已复制' : failed ? '复制失败' : primary ? '去除追踪项' : '去除全部参数'}</span>
                </button>
              );
            })}
          </div>
          {ready && <p className="se-url" title={page.urls.cleanUrl}>{page.urls.cleanUrl}</p>}
        </section>

        {ready && page.textPage && <section className="se-block" aria-labelledby="download-title">
          <h2 className="se-label" id="download-title">{isJson ? 'JSON 文件' : '纯文本文件'}</h2>
          <button
            type="button"
            className="se-file"
            data-state={download === 'started' ? 'done' : download === 'preparing' ? 'busy' : download === 'failed' ? 'error' : undefined}
            disabled={download === 'preparing'}
            aria-label={isJson ? '下载 JSON' : '下载文本'}
            aria-describedby="download-description"
            aria-busy={download === 'preparing'}
            title={`将当前${isJson ? ' JSON ' : '纯文本'}内容保存到浏览器的下载目录`}
            onClick={() => void handleDownload()}
          >
            <span className="se-file-badge" aria-hidden="true">{isJson ? '{ }' : 'TXT'}</span>
            <span id="download-description" className="se-file-name">{downloadFilename}</span>
            <span className="se-file-action">
              {download === 'preparing' ? '准备中…' : download === 'started' ? '已开始' : download === 'failed' ? '重试' : '下载'}
              <IconArrowDown />
            </span>
          </button>
        </section>}
      </> : (
        <div className="se-empty">
          <span className="se-empty-art" aria-hidden="true"><IconSlash /></span>
          <h1>{page.status === 'failed' ? '暂时无法读取页面' : '当前页面无法复制'}</h1>
          <p>{page.status === 'failed' ? '读取标签页信息时出错。' : '浏览器内部页面、本地文件等地址不支持复制。'}</p>
          <button className="se-retry" type="button" onClick={() => void loadPage()}>重新读取</button>
        </div>
      )}

      {onX && <section className="se-block se-x" aria-labelledby="x-page-title">
        <h2 className="se-label" id="x-page-title">X 页面</h2>
        <div className="se-field">
          <span className="se-field-name" id="x-style-label">布局</span>
          <div className="se-seg" role="radiogroup" aria-labelledby="x-style-label">
            {X_STYLES.map(value => (
              <label key={value} className={xStyle === value ? 'on' : undefined} title={X_STYLE_OPTIONS[value].description}>
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
        <div className="se-field se-field-stack">
          <span className="se-field-name" id="x-theme-label">主题<em>{xThemeLabel(xTheme)}</em></span>
          <div className="se-dots" role="radiogroup" aria-labelledby="x-theme-label">
            {X_THEME_NAMES.map(value => (
              <label key={value} className={xTheme === value ? 'on' : undefined} title={xThemeLabel(value)} style={swatchStyle(value)}>
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
        <p className={settingsFailed ? 'se-alert' : 'sr-only'} role="status" aria-live="polite">
          {settingsFailed ? '设置保存失败，请重试。' : ''}
        </p>
      </section>}

      {showActions && <footer className={notice ? 'se-alert' : 'sr-only'}>
        <span className={copy.status === 'failed' ? undefined : 'sr-only'} role="status" aria-live="polite" aria-atomic="true">{feedback}</span>
        <span className={download === 'failed' ? undefined : 'sr-only'} role="status" aria-live="polite" aria-atomic="true">{downloadFeedback}</span>
      </footer>}
    </main>
  );
}

const svg = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const IconSpark = () => <svg {...svg}><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2 2M10.6 10.6l2 2M12.6 3.4l-2 2M5.4 10.6l-2 2" /></svg>;
const IconLink = () => <svg {...svg}><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" /></svg>;
const IconCheck = () => <svg {...svg} strokeWidth={2}><path d="M3 8.5l3 3 7-7" /></svg>;
const IconArrowDown = () => <svg {...svg} width={14} height={14}><path d="M8 2.5v10M3.5 8L8 12.5 12.5 8" /></svg>;
const IconSlash = () => <svg {...svg} width={28} height={28} strokeWidth={1.4}><circle cx="8" cy="8" r="6" /><path d="M3.8 12.2l8.4-8.4" /></svg>;

export default App;
