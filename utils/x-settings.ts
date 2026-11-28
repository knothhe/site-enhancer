import { storage } from 'wxt/utils/storage';
import { isXStyle, type XStyle } from './x-style';
import { isXTheme, type XTheme } from './x-theme';

export const X_COPY_FORMATS = ['default', 'plain', 'markdown'] as const;
export type XCopyFormat = typeof X_COPY_FORMATS[number];

export function isXCopyFormat(value: unknown): value is XCopyFormat {
  return typeof value === 'string' && (X_COPY_FORMATS as readonly string[]).includes(value);
}

export const X_COPY_FORMAT_KEY = 'site-enhancer:x-copy-format';

function setting<T extends string>(key: `local:${string}`, isValid: (value: unknown) => value is T, fallback: T) {
  const item = storage.defineItem<string>(key, { fallback });
  const parse = (value: unknown) => (isValid(value) ? value : fallback);
  return {
    get: async () => parse(await item.getValue()),
    set: (value: T) => item.setValue(value),
    watch: (callback: (value: T) => void) => item.watch(value => callback(parse(value))),
  };
}

function booleanSetting(key: `local:${string}`, fallback: boolean) {
  const item = storage.defineItem<boolean>(key, { fallback });
  const parse = (value: unknown) => (typeof value === 'boolean' ? value : fallback);
  return {
    get: async () => parse(await item.getValue()),
    set: (value: boolean) => item.setValue(value),
    watch: (callback: (value: boolean) => void) => item.watch(value => callback(parse(value))),
  };
}

/** Page layout and typography: original, clean, columns or reading. */
export const xStyleSetting = setting<XStyle>('local:xStyle', isXStyle, 'original');
/** Page colors, independent of the layout. */
export const xThemeSetting = setting<XTheme>('local:xTheme', isXTheme, 'original');
/** Copy-with-link output template: default (#X), plain (text + URL), or markdown quote. */
export const xCopyFormatSetting = setting<XCopyFormat>('local:xCopyFormat', isXCopyFormat, 'default');
/** Automatically switch the Home timeline to the Following tab when entering /home. */
export const xDefaultFollowingSetting = booleanSetting('local:xDefaultFollowing', false);
export const xScreenshotRoundedSetting = booleanSetting('local:xScreenshotRounded', false);
