# site-enhancer

A browser extension that adds quick copy buttons to posts on X.com, Twitter, and linux.do, and offers simplified X page styles.

## Features

### Popup: copy the current webpage URL
- **复制干净链接** — Removes known tracking parameters such as `utm_*`, `fbclid`, and `gclid`, while preserving useful parameters and their original encoding. Also removes X/Twitter share parameters and YouTube's `si` share identifier on their respective domains.
- **复制无参数链接** — Removes the entire query string. Search, filter, or pagination state may be lost.
- Both actions preserve the full fragment (including hash routes) and work on HTTP/HTTPS pages. Fragment contents are not rewritten.
- Click the extension toolbar icon to open the two-button panel. Copy confirmation appears in the selected button; failures can be retried. Processing happens locally.
- The popup uses `activeTab` to read the page only when invoked and `clipboardWrite` to copy. It does not require permission to read every tab.

### Popup: download text and JSON
- HTTP/HTTPS responses reported by the browser as `text/plain`, `application/json`, `text/json`, or an `application/*+json` type show an additional **下载** button. HTML pages, including pages containing code blocks or ending in `.txt` or `.json`, do not qualify based on their URL or content alone.
- The button saves the currently loaded text as UTF-8 through the browser's download manager, preserving whitespace and line breaks. It does not request the website again or parse and reformat JSON. The URL's last path segment supplies the filename; JSON responses always use `.json`, while plain text keeps its existing extension or gets `.txt`.
- Files use the browser's download location and duplicate names receive a unique suffix. Browser settings may still prompt for a location. **已开始** means the download was handed to the browser; check the browser's download list for completion. Reopen the popup if the page has navigated or refreshed.
- `scripting` and the temporary `activeTab` grant detect and read the current document. `downloads` starts the local download. No additional access to all websites is requested.

### Popup: X page layout and theme
- On x.com and twitter.com the popup shows an **X 页面** section above the link actions. Layout and theme are set separately, apply immediately to open X tabs and are remembered.
- **布局** changes only structure and typography:
  - **原版** leaves X unchanged.
  - **简洁** keeps the main features (Home, Explore, Notifications, Chat, Profile, More, Post and search) and hides ads, Grok, Premium/verification upsells, Creator Studio, Calls, Jobs, Communities, the sidebar's trends/sports/who-to-follow/footer modules, the post analytics upsell, and who-to-follow suggestions in the Home timeline. Post text gets slightly more line spacing.
  - **三栏** builds on the clean style with navigation, the original timeline, and a same-origin detail pane with native replies and interactions. Click a post body or timestamp to open it on the right; profile links, media, action buttons and modified clicks retain their normal behavior. Drag either divider to resize, use arrow keys for 10px steps (Shift for 40px), or double-click / press Home / choose 恢复栏宽 to reset. Widths are remembered per X origin. The detail toolbar follows the actual timeline header height so borders stay aligned. Back/forward buttons and browser Back/Forward revisit detail selections during the current page session without navigating the main timeline; selecting a new post after going back replaces the forward branch. Below 1080px, the clean layout and native detail navigation are used. Loading failures offer retry and a new-tab link. The detail pane requires X/Twitter host access and `declarativeNetRequestWithHostAccess`: a temporary, tab-specific rule changes only the exact marked detail request’s `X-Frame-Options` to `SAMEORIGIN`, leaving CSP intact. The request includes the current UI language to avoid X’s cached service-worker shell. Closing details or leaving the mode removes the rule; closing the tab also cleans it up. Search remains available via 搜索 in the detail toolbar.
  - **阅读** also removes the right sidebar, view counts, History, Lists and the chat drawer, widens the timeline and uses larger serif post text.
- **主题** changes only colors: **原版** plus 石墨, 纸墨, 森林, 海洋, 薄荷, 暮紫 and 玫瑰. Each swatch shows the theme's background and accent. Every theme has a light and a dark palette and follows X's display setting (Dim and Lights out use the dark palette). Colors are remapped from X's live stylesheet, so newly loaded content is recolored as well.
- Rules match X's link targets and `data-testid` attributes, so they work in any interface language. Ads are detected as posts without a timestamp. The settings use the `storage` permission.
- Link and download rows show only their title and action; detailed explanations are available as tooltips.

The popup design and its loading, success, and failure states can be reviewed at [design/index.html](design/index.html).

### For X.com / Twitter
- **Copy with Link** - Copies tweet content, URL, and #X hashtag in one click
- **Copy Text Only** - Copies just the tweet text content
- **Visual Feedback** - Toast notification confirms successful copy
- **Native menu integration** - Copy actions appear in the More menu, including dynamically loaded tweets

### For linux.do
- **Copy with Link** - Copies post content and URL with #Linuxdo hashtag
- **Copy Text Only** - Copies just the post text content
- **Visual Feedback** - Toast notification confirms successful copy
- **Auto-injection** - Buttons automatically appear on dynamically loaded posts

## How It Works

### On X.com / Twitter
The extension adds three copy actions to the native **More (⋯)** menu on each tweet:

1. 🔗 **Copy post with link** - Copies with link
   - Format: `Tweet content` + `Tweet URL` + `#X`

2. 📄 **Copy post text only** - Copies text only
   - Format: Just the tweet text, preserving line breaks and emoji

**Copy post link** copies only the canonical post URL, without text or tracking parameters. These actions are also available inside the three-column detail pane. Quote cards in the timeline and detail pane open the quoted post in the detail pane and participate in back/forward history.

Menu labels follow the page language (Chinese or English) and colors follow the native menu. Media-only posts can be copied with their link. For long posts, expand **Show more** before copying; the extension copies the currently rendered text.

### On linux.do
The extension adds two copy buttons below each forum post:

1. 🔗 **Copy with Link** - Copies with link
   - Format: `Post content` + `Post URL` + `#Linuxdo`

2. 📄 **Copy Text** - Copies text only
   - Format: Just the post text

## Installation

### Development Build

1. Clone this repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Build the extension:
   ```bash
   pnpm build
   ```
4. Load the extension in your browser:
   - Chrome: Go to `chrome://extensions/`, enable Developer mode, and load the `.output/chrome-mv3` directory
   - Edge: Run `pnpm build:edge`, then load `.output/edge-mv3` from `edge://extensions/`
   - Firefox: Run `pnpm build:firefox` and load `.output/firefox-mv2/manifest.json` from `about:debugging`. For MV3, run `pnpm build:firefox:mv3` and load `.output/firefox-mv3/manifest.json`.

### Local Installation Directory

Run `make install` to build and sync Chrome MV3 to the configured plugin directory. The existing `pnpm install:local` command remains available. See [local installation](docs/install-local.md) for setup, flags, overwrite rules and browser loading instructions.

## Version Management

`make release` previews the next patch; `make release RELEASE_FLAGS=--apply` runs the checks, bumps `package.json`, commits, tags and pushes. The pushed `v*` tag triggers GitHub Actions, which builds the Chrome and Firefox ZIPs and publishes the GitHub Release. See [release workflow and recovery](docs/release.md).

## Development

```bash
# Install dependencies
pnpm install

# Development mode (Chrome)
pnpm dev

# Development mode (Firefox)
pnpm dev:firefox

# Build for production
pnpm build

# Build for Firefox
pnpm build:firefox

# Build and sync Chrome to the configured local plugin directory
make install

# Check TypeScript
pnpm compile

# Run regression tests (Node.js 22.18+)
pnpm test

# Run local installer behavior tests only (Node.js 18+)
pnpm test:install-local

# Run isolated release workflow tests
pnpm test:release

# Build Chrome MV3 and run the isolated browser regression (local, Node.js 22+)
pnpm test:browser

# Create zip package
pnpm zip
```

Project conventions are maintained in [AGENTS.md](AGENTS.md), with [CLAUDE.md](CLAUDE.md) referring to the same rules. Installer changes require behavior tests and a real build-and-sync check in a temporary directory outside the repository. Browser verification follows the macOS launch permissions documented there.

### Browser regression

`pnpm test:browser` builds `.output/chrome-mv3` and drives the built extension in a Chromium browser started with a new temporary profile and a random DevTools port. It never uses an existing browser session, the system clipboard or your extension settings:

- X and linux.do pages come from offline fixtures in `scripts/browser-regression/fixtures`, served through DevTools request interception. Every other request is blocked and listed in the report.
- The regression runs on a temporary copy of the build in which the X and linux.do content scripts get an in-memory clipboard recorder prepended (`clipboard-shim.js`); the popup page gets the same recorder. Both the Clipboard API and the `execCommand` fallback are captured.
- Covered: X More menu opened with Enter and Space (copy items injected once before the native items, opened from keydown without a click, copied text and permalink, menu closes and focus returns), mouse-opened menus, Chinese labels; linux.do buttons on initial and streamed posts, copied text without image captions, post-date permalinks, caption styles restored, image-only posts, the fallback copy path and Chinese labels; the popup in Chinese and English (plus a non-Chinese fallback), light and dark, X layout/theme changes applied to an open X tab, clean/bare link copies, the text download row, the unavailable state, and English label overflow in the segmented control.
- Output: screenshots and `report.json` in `.output/browser-regression` (`--out <dir>` to change). Exit code 0 when every assertion passes, 1 on any failure or timeout, 2 when no browser is found. The browser and the temporary profile are removed on exit, including Ctrl-C.
- Options: `--skip-build` reuses the current build, `--headed` shows the window. `SE_BROWSER` selects the executable (default: the first of ego lite, Chrome for Testing or Chromium in their standard locations); `SE_BROWSER_TIMEOUT_MS` changes the 120-second limit. Branded Google Chrome may ignore `--load-extension`.

Limits: fixtures imitate the structure the content scripts rely on, not live X or linux.do. Downloads, Firefox, the toolbar popup window and CI are not covered; the command has been verified with ego lite (Chromium 156, headless) on macOS.

## Tech Stack

- [WXT](https://wxt.dev) - Web Extension Tools framework
- [React](https://react.dev) - UI library
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## License

MIT
