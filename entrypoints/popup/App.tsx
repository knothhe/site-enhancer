import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { browser } from 'wxt/browser';
import { copyToClipboard } from '../../utils/clipboard';
import { getUrlVariants, type UrlVariants } from '../../utils/url';
import { getTextDownload, getTextFilename, readTextPage, type TextPage } from '../../utils/text-download';
import { isXHost, X_STYLE_OPTIONS, X_STYLES, type XStyle } from '../../utils/x-style';
import { X_THEME_NAMES, X_THEMES, xThemeLabel, type XTheme } from '../../utils/x-theme';
import { xStyleSetting, xThemeSetting } from '../../utils/x-settings';
import { browserLocale, type Locale } from '../../utils/i18n';
import { MESSAGES } from './messages';
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

function App({ locale = browserLocale() }: { locale?: Locale }) {
  const t = MESSAGES[locale];
  const styleOptions = X_STYLE_OPTIONS[locale];
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
    ? t.copiedNotice(t[copy.mode].name)
    : copy.status === 'failed' ? t.copyFailed : copy.status === 'copying' ? t.copyingNotice : '';
  const downloadFeedback = download === 'failed' ? t.downloadFailed
    : download === 'started' ? t.downloadStarted
      : download === 'preparing' ? t.downloadPreparing : '';
  const settingsFailed = xStyleFailed || xThemeFailed;
  const notice = copy.status === 'failed' ? feedback : download === 'failed' ? downloadFeedback : '';

  return (
    <main className="se">
      {showActions ? <>
        <section className="se-block" aria-labelledby="copy-title">
          <h2 className="se-label" id="copy-title">{t.copyTitle}</h2>
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
                  aria-label={t[mode].action}
                  aria-busy={busy}
                  title={t[mode].title}
                  onClick={() => void handleCopy(mode)}
                >
                  <span className="se-tile-icon" aria-hidden="true">{copied ? <IconCheck /> : primary ? <IconSpark /> : <IconLink />}</span>
                  <span className="se-tile-name">{t[mode].name}</span>
                  <span className="se-tile-hint">{busy ? t.copying : copied ? t.copied : failed ? t.copyFailedShort : t[mode].hint}</span>
                </button>
              );
            })}
          </div>
          {ready && <p className="se-url" title={page.urls.cleanUrl}>{page.urls.cleanUrl}</p>}
        </section>

        {ready && page.textPage && <section className="se-block" aria-labelledby="download-title">
          <h2 className="se-label" id="download-title">{isJson ? t.jsonFile : t.textFile}</h2>
          <button
            type="button"
            className="se-file"
            data-state={download === 'started' ? 'done' : download === 'preparing' ? 'busy' : download === 'failed' ? 'error' : undefined}
            disabled={download === 'preparing'}
            aria-label={isJson ? t.downloadJson : t.downloadText}
            aria-describedby="download-description"
            aria-busy={download === 'preparing'}
            title={isJson ? t.downloadJsonTitle : t.downloadTextTitle}
            onClick={() => void handleDownload()}
          >
            <span className="se-file-badge" aria-hidden="true">{isJson ? '{ }' : 'TXT'}</span>
            <span id="download-description" className="se-file-name">{downloadFilename}</span>
            <span className="se-file-action">
              {download === 'preparing' ? t.preparing : download === 'started' ? t.started : download === 'failed' ? t.retry : t.download}
              <IconArrowDown />
            </span>
          </button>
        </section>}
      </> : (
        <div className="se-empty">
          <span className="se-empty-art" aria-hidden="true"><IconSlash /></span>
          <h1>{page.status === 'failed' ? t.readFailedTitle : t.unavailableTitle}</h1>
          <p>{page.status === 'failed' ? t.readFailed : t.unavailable}</p>
          <button className="se-retry" type="button" onClick={() => void loadPage()}>{t.reload}</button>
        </div>
      )}

      {onX && <section className="se-block se-x" aria-labelledby="x-page-title">
        <h2 className="se-label" id="x-page-title">{t.xPage}</h2>
        <div className="se-field">
          <span className="se-field-name" id="x-style-label">{t.layout}</span>
          <div className="se-seg" role="radiogroup" aria-labelledby="x-style-label">
            {X_STYLES.map(value => (
              <label key={value} className={xStyle === value ? 'on' : undefined} title={styleOptions[value].description}>
                <input
                  type="radio"
                  name="x-style"
                  value={value}
                  checked={xStyle === value}
                  aria-description={styleOptions[value].description}
                  onChange={() => void setXStyle(value)}
                />
                <span>{styleOptions[value].label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="se-field se-field-stack">
          <span className="se-field-name" id="x-theme-label">{t.theme}<em>{xThemeLabel(xTheme, locale)}</em></span>
          <div className="se-dots" role="radiogroup" aria-labelledby="x-theme-label">
            {X_THEME_NAMES.map(value => (
              <label key={value} className={xTheme === value ? 'on' : undefined} title={xThemeLabel(value, locale)} style={swatchStyle(value)}>
                <input
                  type="radio"
                  name="x-theme"
                  value={value}
                  checked={xTheme === value}
                  aria-label={xThemeLabel(value, locale)}
                  onChange={() => void setXTheme(value)}
                />
              </label>
            ))}
          </div>
        </div>
        <p className={settingsFailed ? 'se-alert' : 'sr-only'} role="status" aria-live="polite">
          {settingsFailed ? t.settingsFailed : ''}
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
