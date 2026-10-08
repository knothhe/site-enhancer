# Copy Enhancer

A browser extension that adds quick copy buttons to posts on X.com, Twitter, and linux.do.

## Features

### For X.com / Twitter
- **Copy with Link** - Copies tweet content, URL, and #X hashtag in one click
- **Copy Text Only** - Copies just the tweet text content
- **Visual Feedback** - Toast notification confirms successful copy
- **Auto-injection** - Buttons automatically appear on dynamically loaded tweets

### For linux.do
- **Copy with Link** - Copies post content and URL with #Linuxdo hashtag
- **Copy Text Only** - Copies just the post text content
- **Visual Feedback** - Toast notification confirms successful copy
- **Auto-injection** - Buttons automatically appear on dynamically loaded posts

## How It Works

### On X.com / Twitter
The extension adds two copy buttons to the action bar below each tweet:

1. 🔗 **Link Icon** - Copies with link
   - Format: `Tweet content` + `Tweet URL` + `#X`

2. 📄 **Document Icon** - Copies text only
   - Format: Just the tweet text

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
   - Chrome/Edge: Go to `chrome://extensions/` or `edge://extensions/`, enable Developer mode, and load the `.output/chrome-mv3` directory
   - Firefox: Run `pnpm build:firefox`, go to `about:debugging`, click "This Firefox", and load the temporary add-on from `.output/firefox-mv2/manifest.json`

### Local Installation Directory

To keep Chrome loading from a fixed directory, copy the example configuration and edit the installation parent directory:

```bash
cp .install-local.example.json .install-local.json
# Edit .install-local.json, then build and sync
pnpm install:local
```

The example uses Chrome and the stable plugin folder name `site-enhancer`. With `directories.chrome` set to `~/ChromeExtensions`, the actual target is `~/ChromeExtensions/site-enhancer`. Personal `.install-local.json` and `.install-local.<name>.json` files are Git-ignored; keep other personal `--config` files ignored too.

You can also install without a configuration file:

```bash
pnpm install:local chrome --dir "~/ChromeExtensions" --name site-enhancer
pnpm install:local --config .install-local.dev.json
pnpm install:local --help
```

CLI options override configuration. `--dir` and `directories` are **parent directories**, with the plugin name appended. Relative paths resolve from the repository root; `~/` is supported. The name comes from `--name`, then configuration `name`, then the project folder name, so pass `--name site-enhancer` when installing without configuration from a differently named worktree. The name must be a single valid folder name and does not change the manifest name or extension ID. Optional configuration fields `package_manager`, `build_scripts` and `output_directories` can select existing build scripts and MV3 output directories inside the project.

The command runs `pnpm build`, checks `.output/chrome-mv3/manifest.json`, then replaces only the named plugin directory. It preserves parent files and other plugins, removes obsolete plugin assets and retains the previous installation if the build or manifest validation fails. New, empty and same-project/same-browser managed directories update directly. Other nonempty plugin directories display the full target and request overwrite confirmation `[Y/n]`; declining, closing stdin or interrupting cancels before building. Managed plugin directories contain `.h2-ext-local.json` and must not contain personal files. Targets overlapping the repository or using a symlink are rejected. Failed replacement attempts restore the old directory or report its retained backup location.

After synchronization, open `chrome://extensions/`, enable Developer mode and load the **installed plugin directory**. Reload the extension after each update. Directory synchronization does not load or reload it in the browser. Edge can manually load the same Chrome build at `edge://extensions/`.

This project's configured local installation flow is Chrome MV3. The generic installer accepts Chrome, Firefox and Edge build mappings, but Firefox currently builds MV2 and no dedicated Edge build script exists. Do not use `install:local firefox` or `install:local edge` without first adapting and validating their MV3 build mappings. Use the existing Firefox manual installation instructions above.

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
pnpm install:local

# Check TypeScript
pnpm compile

# Run regression tests (Node.js 18+)
pnpm test

# Run local installer behavior tests only (Node.js 18+)
pnpm test:install-local

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
