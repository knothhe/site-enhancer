export type Locale = 'zh' | 'en';

/** Chinese for any zh-* language tag, otherwise English. */
export function resolveLocale(language: string | undefined): Locale {
  return language?.trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** The browser UI language; English when it is unavailable. */
export function browserLocale(): Locale {
  return resolveLocale(globalThis.navigator?.language);
}
