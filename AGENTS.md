# Project conventions

- Use pnpm for dependencies and project commands. Keep `pnpm-lock.yaml`; do not introduce npm or Yarn lockfiles.
- Follow the existing WXT, React and TypeScript architecture. Preserve unrelated working tree changes.
- Run `pnpm test`, `pnpm compile` and the relevant browser build after code changes. Installation changes also require a real build-and-sync check in a temporary directory outside the repository.

## Local installation

- Entry point: `pnpm install:local`, implemented in `scripts/install-local.mjs`. See README for configuration and browser loading instructions.
- Commit `.install-local.example.json` with the stable name `site-enhancer`. Keep personal paths in ignored `.install-local.json` or `.install-local.<name>.json` files. Any other personal `--config` file must also be Git-ignored.
- `directories` and `--dir` specify the installation parent directory; the target is `<parent>/<name>`. CLI options override configuration. Different browser installations need separate parents or names.
- The current installation flow uses `pnpm build` and `.output/chrome-mv3`. The installer requires MV3. Preserve the existing Firefox MV2 build; do not claim Firefox or a dedicated Edge installation is supported without adapting and validating its build mapping.
- Replace only the named plugin directory. Preserve parent files and other plugins. Never use the repository, build output or a symlink as the installation target.
- New, empty and same-project/same-browser schema 2 managed directories can be updated directly. Other nonempty targets require the user's explicit overwrite choice; do not automate confirmation or remove ownership markers to bypass it.
- Preserve `.h2-ext-local.json`, `installer: "h2-ext-local"` and schema 2 compatibility. A failed build or invalid manifest must preserve the old installation; replacement failures must restore it or report the retained backup.
- Verify argument/configuration handling, cancellation, ownership, path protection and failed-update recovery with `pnpm test:install-local`. Verify actual manifest/resources and obsolete-file removal in the temporary installation.
- Report directory synchronization and browser loading separately. Adding the command does not authorize installation to a personal directory, browser profile changes, publication or a Git commit.

## macOS browser verification

- Prefer the built-in Browser or connected Chrome tools.
- When shell-launching Chrome, Chromium or Chrome for Testing, or running Playwright/Puppeteer tests that create a browser, request `sandbox_permissions="require_escalated"` on the first attempt.
- If Sandbox restriction or SIGABRT occurs during RegisterApplication / TransformProcessType, stop retrying the same launch method. Do not concurrently restart failed browsers.
