# site-enhancer

A browser extension that adds quick copy buttons to posts on X.com, Twitter, and linux.do.

## Features

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

# Run regression tests (Node.js 22.18+)
pnpm test

# Run local installer behavior tests only (Node.js 18+)
pnpm test:install-local

# Create zip package
pnpm zip
```

Project conventions are maintained in [AGENTS.md](AGENTS.md), with [CLAUDE.md](CLAUDE.md) referring to the same rules. Installer changes require behavior tests and a real build-and-sync check in a temporary directory outside the repository. Browser verification follows the macOS launch permissions documented there.

## Local installation

See the [local installation guide](docs/local-install.md).

## Releases

Use the project's Node.js and pnpm environment, Git, and the GitHub CLI (`gh`).
Install dependencies with `pnpm install` and sign in with `gh auth login` before
applying a release. Run releases on `main` with a clean working tree, including
untracked files. Commit the release scripts, configuration, and other intended
changes before the first preview.

```bash
# Preview a patch release without changing files or running checks
pnpm release patch

# Apply a patch release after reviewing the preview
pnpm release patch --apply

# Preview a feature release or a breaking release
pnpm release minor
pnpm release major

# Preview an explicit version
pnpm release 0.2.0

# Apply without creating a GitHub Release
pnpm release patch --apply --no-github-release

# Create only the local version commit and tag
pnpm release patch --apply --no-push --no-github-release
```

Choose `patch` for compatible fixes, `minor` for compatible new functionality,
and `major` for incompatible public API changes. Review compatibility explicitly
while this project is on `0.x`. The command defaults to preview; only `--apply`
performs a release.

[.release.json](.release.json) configures `package.json` as the single version
source, branch `main`, remote `origin`, tag prefix `v`, and GitHub Release creation
enabled by default. The release runs `pnpm compile` and `pnpm test:release` before
updating the version. It then commits the version as `chore(release): vX.Y.Z`,
creates an annotated tag, atomically pushes `main` and that tag, and creates the
GitHub Release. This push also includes any existing unpushed commits on `main`.
Release notes contain a Full Changelog link and commit titles with short hashes
since the previous reachable lower version tag. Keep full Git history and tags
available for generating these notes.

The preview reports the current and target versions, tag, checks, push setting,
GitHub repository, and release notes. For example, a patch preview from `0.1.4`
targets `0.1.5` and `v0.1.5`, with checks before the bump and GitHub Release enabled.
Preview reads remote refs but does not run checks or verify GitHub authentication.

If a `pnpm-workspace.yaml` is present for build permissions, the command uses
pnpm's package inventory to confirm this remains a single-package project.
It refuses multiple packages. The pnpm lockfile has no root package version
to update. Adapt the release workflow if the repository becomes a monorepo.

This command does not build or upload extension ZIPs, publish to a package
registry or extension store, or install a GitHub Actions workflow. Use the existing
`pnpm build` and `pnpm zip` commands when packaging is needed.

If checks fail or change repository files or Git state, the release stops before
changing the version and leaves the check's changes for inspection. Later
failures also leave their state intact. Inspect `git status`, commits, local tags,
and remote refs before retrying. When the expected release commit and annotated
tag already exist at HEAD, resume using the exact version instead of bumping again:

```bash
pnpm release 0.1.5 --resume        # Preview recovery
pnpm release 0.1.5 --resume --apply
```

Resume requires a clean working tree and skips version changes and checks. It
finishes the push and GitHub Release creation, preserving any existing Release.

## Tech Stack

- [WXT](https://wxt.dev) - Web Extension Tools framework
- [React](https://react.dev) - UI library
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## License

MIT
