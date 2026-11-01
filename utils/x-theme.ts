/**
 * Color themes for X, independent of the layout styles in x-style.ts.
 *
 * X renders atomic React Native Web classes (e.g. `.r-kemksi { background-color: rgb(0, 0, 0) }`)
 * plus some inline colors. Class names differ per X display mode and appear lazily, so matching
 * rules are generated from the live stylesheets and remapped to --se-x-* variables.
 */
export type XTone = 'dark' | 'dim' | 'light';
type Token = 'bg' | 'raised' | 'input' | 'border' | 'text' | 'muted' | 'veil' | 'accent';
type Palette = Record<Token, string>;

export const X_THEME_ATTR = 'data-site-enhancer-x-theme';
export const X_TONE_ATTR = 'data-site-enhancer-x-tone';
export const X_THEME_CACHE_KEY = 'site-enhancer:x-theme';
const TONE_CACHE_KEY = 'site-enhancer:x-tone';

const palette = (bg: string, raised: string, input: string, border: string, text: string, muted: string, veil: string, accent: string): Palette =>
  ({ bg, raised, input, border, text, muted, veil, accent });

/** Each theme has a light and a dark palette; X's Dim and Lights out modes use the dark one. */
export const X_THEMES = {
  graphite: {
    label: '石墨',
    light: palette('#f5f6f8', '#eceef1', '#e8ebef', '#e0e3e8', '#1c2024', '#69717a', 'rgba(245, 246, 248, .86)', '#2f6fdb'),
    dark: palette('#16181c', '#1e2126', '#23272d', '#2b3036', '#e4e6e9', '#8a929b', 'rgba(22, 24, 28, .84)', '#6ea8fe'),
  },
  paper: {
    label: '纸墨',
    light: palette('#f4efe4', '#ece5d6', '#e8e0cf', '#e0d6c3', '#2d2823', '#7d7262', 'rgba(244, 239, 228, .88)', '#a3532a'),
    dark: palette('#1c1a17', '#25221e', '#2b2823', '#36322b', '#e9e3d7', '#a09581', 'rgba(28, 26, 23, .86)', '#d9915f'),
  },
  forest: {
    label: '森林',
    light: palette('#f1f5f0', '#e7eee5', '#e2eadf', '#d6e1d3', '#1f2a22', '#5f7064', 'rgba(241, 245, 240, .88)', '#2e7d4f'),
    dark: palette('#121a15', '#19231c', '#1e2a22', '#27352b', '#dfe8e1', '#8aa091', 'rgba(18, 26, 21, .86)', '#5fbf86'),
  },
  ocean: {
    label: '海洋',
    light: palette('#f0f6fa', '#e4eef5', '#dde9f2', '#d2e1ec', '#142433', '#587184', 'rgba(240, 246, 250, .88)', '#0b7bbf'),
    dark: palette('#0d1821', '#13212c', '#182936', '#22394a', '#dce9f2', '#86a0b3', 'rgba(13, 24, 33, .86)', '#4fb3ee'),
  },
  mint: {
    label: '薄荷',
    light: palette('#eff7f6', '#e2f0ee', '#dcebe9', '#cfe3e0', '#15302d', '#557471', 'rgba(239, 247, 246, .88)', '#0f8f84'),
    dark: palette('#0f1c1b', '#152523', '#1a2c2a', '#233a37', '#d9ecea', '#82a5a1', 'rgba(15, 28, 27, .86)', '#3fc7b8'),
  },
  dusk: {
    label: '暮紫',
    light: palette('#f6f3fa', '#ede7f5', '#e8e1f2', '#ddd4ea', '#241d30', '#6d6280', 'rgba(246, 243, 250, .88)', '#7048c8'),
    dark: palette('#17141f', '#1f1b29', '#252031', '#322b40', '#e7e1f0', '#9b90ad', 'rgba(23, 20, 31, .86)', '#a88bf0'),
  },
  rose: {
    label: '玫瑰',
    light: palette('#fbf3f4', '#f4e7e9', '#f0e1e4', '#e8d4d8', '#2e1c20', '#80636a', 'rgba(251, 243, 244, .88)', '#c2416b'),
    dark: palette('#1d1416', '#261b1e', '#2c2023', '#3a2a2e', '#f0e2e5', '#ad9298', 'rgba(29, 20, 22, .86)', '#f07a9c'),
  },
} satisfies Record<string, { label: string; light: Palette; dark: Palette }>;

export type XThemeName = keyof typeof X_THEMES;
export type XTheme = 'original' | XThemeName;
export const X_THEME_NAMES = ['original', ...Object.keys(X_THEMES)] as XTheme[];

export function isXTheme(value: unknown): value is XTheme {
  return typeof value === 'string' && (X_THEME_NAMES as string[]).includes(value);
}

export function xThemeLabel(theme: XTheme): string {
  return theme === 'original' ? '原版' : X_THEMES[theme].label;
}

/** X's own colors per display mode. */
const X_COLORS: Record<XTone, Partial<Record<Token, string[]>>> = {
  dark: {
    bg: ['rgb(0, 0, 0)'], raised: ['rgb(22, 24, 28)'], input: ['rgb(32, 35, 39)'],
    border: ['rgb(47, 51, 54)'], text: ['rgb(231, 233, 234)'], muted: ['rgb(113, 118, 123)'],
    veil: ['rgba(0, 0, 0, 0.65)'], accent: ['rgb(29, 155, 240)'],
  },
  dim: {
    bg: ['rgb(21, 32, 43)'], raised: ['rgb(30, 39, 50)'], input: ['rgb(39, 51, 64)'],
    border: ['rgb(56, 68, 77)'], text: ['rgb(247, 249, 249)'], muted: ['rgb(139, 152, 165)'],
    veil: ['rgba(21, 32, 43, 0.75)'], accent: ['rgb(29, 155, 240)'],
  },
  light: {
    bg: ['rgb(255, 255, 255)'], raised: ['rgb(247, 249, 249)'], input: ['rgb(239, 243, 244)'],
    border: ['rgb(239, 243, 244)', 'rgb(207, 217, 222)'], text: ['rgb(15, 20, 25)'], muted: ['rgb(83, 100, 113)'],
    veil: ['rgba(255, 255, 255, 0.85)'], accent: ['rgb(29, 155, 240)'],
  },
};

// Which tokens may replace a color for each kind of property. Restricting this avoids, for
// example, recoloring X's light "Post" button, whose background equals the light border color.
const PROPERTY_TOKENS: Record<string, Token[]> = {
  'background-color': ['bg', 'raised', 'input', 'veil', 'accent', 'border'],
  'color': ['text', 'muted', 'accent'],
  'fill': ['text', 'muted', 'accent'],
  'border-color': ['border', 'bg', 'raised', 'input', 'accent'],
  'border-top-color': ['border', 'bg'],
  'border-right-color': ['border', 'bg'],
  'border-bottom-color': ['border', 'bg'],
  'border-left-color': ['border', 'bg'],
};

export function detectXTone(background: string): XTone | undefined {
  const normalized = background.replace(/\s+/g, '');
  return (Object.keys(X_COLORS) as XTone[])
    .find(tone => X_COLORS[tone].bg!.some(value => value.replace(/\s+/g, '') === normalized));
}

const cssVar = (token: Token) => `var(--se-x-${token})`;

export type RuleLike = { selectorText?: string; style: { getPropertyValue(property: string): string } };

export function buildXThemeCss(rules: Iterable<RuleLike>, tone: XTone, scope: string): string {
  const colors = X_COLORS[tone];
  const tokenFor = (property: string, value: string) =>
    PROPERTY_TOKENS[property]?.find(token => colors[token]?.includes(value));
  const out: string[] = [];
  for (const rule of rules) {
    // Only single atomic classes; descendant or third-party rules are left alone.
    if (!rule.selectorText || !/^\.(?:r|css)-[\w-]+$/.test(rule.selectorText)) continue;
    const declarations: string[] = [];
    for (const property of Object.keys(PROPERTY_TOKENS)) {
      const token = tokenFor(property, rule.style.getPropertyValue(property).trim());
      if (token) declarations.push(`${property}:${cssVar(token)}!important`);
    }
    const image = rule.style.getPropertyValue('background-image');
    if (image && colors.bg!.some(value => image.includes(value))) {
      declarations.push(`background-image:${colors.bg!.reduce((acc, value) => acc.split(value).join(cssVar('bg')), image)}!important`);
    }
    if (declarations.length) out.push(`${scope} ${rule.selectorText}{${declarations.join(';')}}`);
  }
  // Inline colors. " color:" (after "; ") excludes background-color/border-color matches.
  for (const [token, values] of Object.entries(colors) as [Token, string[]][]) {
    for (const value of values) {
      const selectors: Record<string, string[]> = {
        color: [`[style^="color: ${value}"]`, `[style*=" color: ${value}"]`],
        'background-color': [`[style*="background-color: ${value}"]`],
        'border-color': [`[style*="border-color: ${value}"]`],
      };
      for (const [property, list] of Object.entries(selectors)) {
        if (!PROPERTY_TOKENS[property].includes(token)) continue;
        out.push(`${list.map(selector => `${scope} ${selector}`).join(',')}{${property}:${cssVar(token)}!important}`);
      }
    }
  }
  return out.join('\n');
}

const SCOPE = `:root[${X_THEME_ATTR}][${X_TONE_ATTR}]`;

/** Static palette variables plus page background/text for every theme and tone. */
export const X_PALETTE_CSS = Object.entries(X_THEMES).flatMap(([name, theme]) =>
  (['light', 'dark'] as const).map(tone => `:root[${X_THEME_ATTR}="${name}"][${X_TONE_ATTR}="${tone}"]{${
    Object.entries(theme[tone]).map(([token, value]) => `--se-x-${token}:${value}`).join(';')}}`),
).concat(`${SCOPE},${SCOPE} body{background-color:var(--se-x-bg)!important;color:var(--se-x-text)!important}`).join('\n');

export function readCachedXTheme(): XTheme {
  try {
    const value = localStorage.getItem(X_THEME_CACHE_KEY);
    return isXTheme(value) ? value : 'original';
  } catch {
    return 'original';
  }
}

function liveRules(): RuleLike[] {
  return Array.from(document.styleSheets).flatMap(sheet => {
    if (sheet.ownerNode instanceof Element && sheet.ownerNode.id.startsWith('site-enhancer-')) return [];
    try { return Array.from(sheet.cssRules) as CSSStyleRule[]; } catch { return []; }
  });
}

function replaceStyle(id: string): HTMLStyleElement {
  // Replace any element left by a previous extension instance; see remove().
  document.getElementById(id)?.remove();
  const style = document.createElement('style');
  style.id = id;
  // At document_start <head> may not exist yet.
  (document.head ?? document.documentElement).appendChild(style);
  return style;
}

/** Applies a theme and keeps the generated rules in sync with X's lazily inserted rules. */
export function installXTheme(initial: XTheme = readCachedXTheme()) {
  const root = document.documentElement;
  const paletteStyle = replaceStyle('site-enhancer-x-palette');
  paletteStyle.textContent = X_PALETTE_CSS;
  const rulesStyle = replaceStyle('site-enhancer-x-theme');
  let signature = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = 0;

  function setTone(tone: 'light' | 'dark' | undefined) {
    if (tone) root.setAttribute(X_TONE_ATTR, tone);
    else root.removeAttribute(X_TONE_ATTR);
  }

  // React Native Web inserts rules with insertRule, which mutation observers cannot see.
  // Poll quickly while the page boots, then settle to a cheap once-per-second check.
  function schedule() {
    timer = setTimeout(() => { refresh(); schedule(); }, Date.now() - startedAt < 5000 ? 200 : 1000);
  }

  function refresh() {
    if (!document.body) return;
    const sheets = Array.from(document.styleSheets);
    const next = `${document.body.style.backgroundColor}|${sheets.length}|${sheets.reduce((sum, sheet) => {
      try { return sum + sheet.cssRules.length; } catch { return sum; }
    }, 0)}`;
    if (next === signature) return;
    signature = next;
    const tone = detectXTone(document.body.style.backgroundColor || getComputedStyle(document.body).backgroundColor);
    const mode = tone && (tone === 'light' ? 'light' : 'dark');
    setTone(mode);
    if (mode) {
      try { localStorage.setItem(TONE_CACHE_KEY, mode); } catch { /* Optional cache. */ }
    }
    rulesStyle.textContent = tone ? buildXThemeCss(liveRules(), tone, SCOPE) : '';
  }

  function setTheme(theme: XTheme) {
    clearTimeout(timer);
    timer = undefined;
    signature = '';
    try {
      localStorage.setItem(X_THEME_CACHE_KEY, theme);
    } catch { /* Storage may be blocked; the extension setting remains the source of truth. */ }
    if (theme === 'original') {
      root.removeAttribute(X_THEME_ATTR);
      root.removeAttribute(X_TONE_ATTR);
      rulesStyle.textContent = '';
      return;
    }
    root.setAttribute(X_THEME_ATTR, theme);
    if (!root.hasAttribute(X_TONE_ATTR)) {
      // Before <body> exists, reuse the last detected mode to avoid a flash of X's colors.
      try {
        const cached = localStorage.getItem(TONE_CACHE_KEY);
        if (cached === 'light' || cached === 'dark') setTone(cached);
      } catch { /* Optional cache. */ }
    }
    refresh();
    startedAt = Date.now();
    schedule();
  }

  setTheme(initial);
  return {
    setTheme,
    remove() {
      clearTimeout(timer);
      // A newer instance that replaced these stylesheets now owns the page state.
      if (!paletteStyle.isConnected) return;
      paletteStyle.remove();
      rulesStyle.remove();
      root.removeAttribute(X_THEME_ATTR);
      root.removeAttribute(X_TONE_ATTR);
    },
  };
}
