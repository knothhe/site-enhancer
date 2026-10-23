export type TextFormat = 'text' | 'json';

export interface TextPage {
  url: string;
  documentToken: number;
  format: TextFormat;
  text?: string;
}

// This function is serialized into the active tab, so keep it self-contained.
export function readTextPage(includeText = false): TextPage | null {
  const contentType = document.contentType.toLowerCase();
  const format = contentType === 'text/plain' ? 'text'
    : contentType === 'application/json' || contentType === 'text/json'
      || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(contentType) ? 'json' : null;
  if (!format || !document.body
    || !['http:', 'https:'].includes(location.protocol)) return null;

  return {
    url: location.href,
    documentToken: performance.timeOrigin,
    format,
    // Browsers wrap text and JSON responses in a pre element. Read textContent
    // rather than innerText so whitespace and literal markup remain intact.
    ...(includeText ? { text: (document.body.querySelector('pre') ?? document.body).textContent ?? '' } : {}),
  };
}

export function getTextFilename(rawUrl: string, format: TextFormat = 'text'): string {
  const url = new URL(rawUrl);
  const extension = format === 'json' ? '.json' : '.txt';
  let name = url.pathname.split('/').pop() || `${url.hostname}${extension}`;
  try { name = decodeURIComponent(name); } catch { /* Keep malformed escapes literal. */ }
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name) name = 'download';
  // Leave room for an extension within common filesystem filename limits.
  name = Array.from(name).slice(0, 60).join('');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  if (format === 'json') return name.replace(/\.[\p{L}\p{N}]{1,16}$/u, '') + extension;
  return /\.[\p{L}\p{N}]{1,16}$/u.test(name) ? name : `${name}${extension}`;
}

export function getTextDownload(current: TextPage | null | undefined, expected: TextPage) {
  if (!current || current.url !== expected.url || current.documentToken !== expected.documentToken
    || current.format !== expected.format
    || typeof current.text !== 'string') {
    throw new Error('The text document changed or is no longer accessible');
  }

  // A data URL remains valid after the popup closes and never re-fetches a
  // possibly authenticated, one-time, or POST-generated document.
  return {
    url: `data:${current.format === 'json' ? 'application/json' : 'text/plain'};charset=utf-8,${encodeURIComponent(current.text)}`,
    filename: getTextFilename(current.url, current.format),
    saveAs: false,
    conflictAction: 'uniquify' as const,
  };
}
