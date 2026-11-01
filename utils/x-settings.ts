import { storage } from 'wxt/utils/storage';
import { isXStyle, type XStyle } from './x-style';
import { isXTheme, type XTheme } from './x-theme';

function setting<T extends string>(key: `local:${string}`, isValid: (value: unknown) => value is T) {
  const item = storage.defineItem<string>(key, { fallback: 'original' });
  const parse = (value: unknown) => (isValid(value) ? value : 'original' as T);
  return {
    get: async () => parse(await item.getValue()),
    set: (value: T) => item.setValue(value),
    watch: (callback: (value: T) => void) => item.watch(value => callback(parse(value))),
  };
}

/** Page layout and typography: original, clean or reading. */
export const xStyleSetting = setting<XStyle>('local:xStyle', isXStyle);
/** Page colors, independent of the layout. */
export const xThemeSetting = setting<XTheme>('local:xTheme', isXTheme);
