# Local installation

`make install` builds Chrome MV3 and syncs it into a fixed plugin directory. It calls the existing `pnpm install:local` entry point and `scripts/install-local.mjs`. It does not install development dependencies, change the project version, commit, tag, push or publish a Release.

## Setup

Install dependencies first with `pnpm install`. Run the following from the repository root:

```bash
cp .install-local.example.json .install-local.json
# Edit the installation parent directory, then build and sync
make install
```

Example configuration:

```json
{
  "browser": "chrome",
  "name": "site-enhancer",
  "package_manager": "pnpm",
  "directories": {
    "chrome": "~/ChromeExtensions"
  }
}
```

The actual target is `~/ChromeExtensions/site-enhancer`. `directories` and `--dir` specify **parent directories**; the plugin name is appended. Personal `.install-local.json` and `.install-local.<name>.json` files are Git-ignored. Keep any other personal `--config` files ignored too. Use separate parents or names for different browser installations.

## Common commands

```bash
make install
make install INSTALL_FLAGS='chrome --dir "~/ChromeExtensions" --name site-enhancer'
make install INSTALL_FLAGS='--config .install-local.dev.json'
make install INSTALL_FLAGS=--help

# The project's existing pnpm entry point remains available
pnpm install:local
pnpm install:local chrome --dir "~/ChromeExtensions" --name site-enhancer
pnpm install:local --config .install-local.dev.json
pnpm install:local --help
```

CLI options override configuration. Relative parent directories resolve from the repository root and `~/` is supported. The name comes from `--name`, then configuration `name`, then the project folder name. Pass `--name site-enhancer` when installing without configuration from a differently named worktree. The name must be a single valid folder name; it does not change the manifest name or extension ID. Optional configuration fields `package_manager`, `build_scripts` and `output_directories` can select existing build scripts and MV3 output directories inside the project.

## Replacement and recovery

The command validates arguments and the destination, runs `pnpm build`, checks `.output/chrome-mv3/manifest.json`, stages the output beside the destination, then replaces only the named plugin directory. It preserves parent files and other plugins, removes obsolete plugin assets, and retains the previous installation when the build or manifest validation fails.

New, empty and same-project/same-browser schema 2 managed directories update directly. Other nonempty plugin directories display the full target and request overwrite confirmation `[Y/n]`. Declining, closing stdin or interrupting cancels before building. Do not automate confirmation. Managed plugin directories contain `.h2-ext-local.json` (`installer: "h2-ext-local"`, schema 2) and must not contain personal files.

Targets overlapping the repository or using a symlink are rejected. If ownership changes during building or staging, the installer stops and requires a new explicit confirmation. Failed replacement attempts restore the old directory or report its retained backup location. Old flat installations in the parent directory are preserved; this command does not migrate or delete them.

Production builds and ZIP commands share a process lock to prevent overlapping WXT builds from deleting each other's output. A concurrent build waits for up to two minutes. Locks are released when the build process exits; a lock left by a forced kill expires after two minutes.

## Load and reload in the browser

After synchronization, open `chrome://extensions/`, enable Developer mode and load the **installed plugin directory**, such as `~/ChromeExtensions/site-enhancer`. Click **Reload** on that extension after every update. Directory synchronization does not load or reload it in the browser or change browser profiles. Edge can manually load the same Chrome build at `edge://extensions/`.

The example configures Chrome MV3. Other browsers need separate installation parent directories or plugin names. Their installation build mappings are:

| Browser | Build command | Output directory |
| --- | --- | --- |
| Chrome | `pnpm build` | `.output/chrome-mv3` |
| Firefox | `pnpm build:firefox:mv3` | `.output/firefox-mv3` |
| Edge | `pnpm build:edge` | `.output/edge-mv3` |

Use `make install INSTALL_FLAGS='firefox --dir "~/FirefoxExtensions" --name site-enhancer'` or `make install INSTALL_FLAGS='edge --dir "~/EdgeExtensions" --name site-enhancer'` for these MV3 builds. Load Firefox's installed `manifest.json` through `about:debugging` and Edge's installed directory through `edge://extensions/`. Firefox temporary add-ons need to be loaded again after restarting the browser. The existing `pnpm build:firefox` and `pnpm zip:firefox` commands continue to produce Firefox MV2 output.

## Automation and verification

Adding the command does not authorize installation into a personal directory. This project requires explicit installation scope; the presence of personal configuration alone is not permission for this setup task to write there. No Codex Stop hook is installed. An optional project hook can be configured separately with explicit consent to remind Codex to finish installation when a real `.install-local.json` exists; it must preserve the same ownership, overwrite and filesystem permission rules.

Run `pnpm test:install-local` for argument/configuration handling, cancellation, ownership, path protection and failed-update recovery. Changes to this flow also require a real build-and-sync check in a temporary directory outside the repository, including manifest/resources, preservation of sibling files and removal of obsolete assets. Report synchronization separately from browser loading.
