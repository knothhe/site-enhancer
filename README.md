# site-enhancer

A browser extension that adds quick copy buttons to posts on X.com, Twitter, and linux.do.

## Features

### Popup: copy the current webpage URL
- **复制干净链接** — Removes known tracking parameters such as `utm_*`, `fbclid`, and `gclid`, while preserving useful parameters and their original encoding. Also removes X/Twitter share parameters and YouTube's `si` share identifier on their respective domains.
- **复制无参数链接** — Removes the entire query string. Search, filter, or pagination state may be lost.
- Both actions preserve the full fragment (including hash routes) and work on HTTP/HTTPS pages. Fragment contents are not rewritten.
- Click the extension toolbar icon to open the two-button panel. Copy confirmation appears in the selected button; failures can be retried. Processing happens locally.
- The popup uses `activeTab` to read the page only when invoked and `clipboardWrite` to copy. It does not require permission to read every tab.

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
The extension adds two copy actions to the native **More (⋯)** menu on each tweet:

1. 🔗 **Copy post with link** - Copies with link
   - Format: `Tweet content` + `Tweet URL` + `#X`

2. 📄 **Copy post text only** - Copies text only
   - Format: Just the tweet text, preserving line breaks and emoji

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

Run `make version` to show the current version, `make release` to preview the next patch, and `make release VERSION_BUMP=minor RELEASE_FLAGS=--apply` to execute an upgrade with checks, an annotated tag, an atomic push and a GitHub Release. Commit the intended changes first; releases require a clean `main` branch. See [release workflow and recovery](docs/release.md).

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

# Create zip package
pnpm zip
```

Project conventions are maintained in [AGENTS.md](AGENTS.md), with [CLAUDE.md](CLAUDE.md) referring to the same rules. Installer changes require behavior tests and a real build-and-sync check in a temporary directory outside the repository. Browser verification follows the macOS launch permissions documented there.

## Tech Stack

- [WXT](https://wxt.dev) - Web Extension Tools framework
- [React](https://react.dev) - UI library
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## License

MIT
