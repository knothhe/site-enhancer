# Local installation

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

Production builds and ZIP commands share a process lock to prevent overlapping WXT builds from deleting each other's output. A concurrent build waits for up to two minutes. Locks are released when the build process exits; a lock left by a forced kill expires after two minutes.

After synchronization, open `chrome://extensions/`, enable Developer mode and load the **installed plugin directory**. Reload the extension after each update. Directory synchronization does not load or reload it in the browser. Edge can manually load the same Chrome build at `edge://extensions/`.

The example configures Chrome MV3. Other browsers need their own installation parent directory or plugin name. Their build mappings are:

| Browser | Build command | Output directory |
| --- | --- | --- |
| Chrome | `pnpm build` | `.output/chrome-mv3` |
| Firefox | `pnpm build:firefox:mv3` | `.output/firefox-mv3` |
| Edge | `pnpm build:edge` | `.output/edge-mv3` |

For example, `pnpm install:local firefox --dir "~/FirefoxExtensions" --name site-enhancer` builds and synchronizes Firefox MV3. Load its `manifest.json` from `about:debugging`. For Edge, use `pnpm install:local edge --dir "~/EdgeExtensions" --name site-enhancer`, then load the installed directory from `edge://extensions/`. The existing `pnpm build:firefox` and `pnpm zip:firefox` commands still produce Firefox MV2 output.
