# Version management and releases

`package.json` is the single version source. WXT derives the extension manifest version from it; do not add a second version in `wxt.config.ts`. The existing `pnpm-lock.yaml` does not store the project's own version and remains unchanged when bumping it.

`pnpm-workspace.yaml` stores dependency build permissions. The release command uses pnpm's package inventory to verify that this is still a single-package project and rejects additional workspace packages.

## Commands

Run these commands from the repository root. Development checks require Node.js 22.18+, pnpm and installed dependencies. Publishing also requires Git, Make, access to `origin`, and an authenticated GitHub CLI (`gh auth status`).

```bash
make help
make version

# Preview only: no checks, file changes, commits, tags or publication
make release
make release VERSION_BUMP=minor
make release VERSION_BUMP=major
make release VERSION_BUMP=0.2.0

# Execute the selected release, including GitHub Release creation
make release VERSION_BUMP=patch RELEASE_FLAGS=--apply
```

Use patch for compatible fixes, minor for compatible features, and major for incompatible public changes. `VERSION_BUMP` also accepts an exact higher SemVer. Prereleases require an exact version, for example `0.2.0-rc.1`; moving from a prerelease to stable also requires the exact version. Build metadata alone is not a version upgrade. WXT may normalize a prerelease into a numeric browser manifest version; check its browser version ordering before distributing prerelease builds.

The repository currently uses `0.1.4` and already has `v0.1.4`. The next patch is `0.1.5`. Adding this workflow does not bump or publish the current version.

## Release behavior

[.release.json](../.release.json) configures `package.json`, branch `main`, remote `origin`, tag prefix `v`, and GitHub Release creation. No CI workflow is required; run the commands locally.

Before releasing, review and commit the intended changes, including this workflow. The working tree must be clean, including untracked files. The target branch must already exist on the remote and be an ancestor of the local HEAD. Fetch and reconcile remote changes if necessary. A preview reads remote refs; it does not fetch or modify them. Existing local commits on `main` will be pushed along with the release commit.

With `--apply`, an upgrade:

1. Checks branch, working tree, version and local/remote tag conflicts.
2. Writes the target version to `package.json`.
3. Runs `pnpm test`, `pnpm compile` and `pnpm build` in order, against the target version (`check_phase: "after-bump"`). Each check must leave source files, version files, index, HEAD, branches and tags unchanged. Ignored build outputs are allowed.
4. Commits only the version file with `chore(release): v<version>` and creates an annotated tag.
5. Atomically pushes `main` and that one tag to `origin`. A rejected push does not fall back to separate pushes or force-push.
6. Creates a GitHub Release with a Full Changelog link and non-merge commit titles and short hashes since the previous reachable lower version tag, excluding release commits. Prereleases receive GitHub's prerelease flag. Existing Releases are preserved during resume.

Release notes require complete local Git history and tags; shallow clones are rejected. Review commit titles and the notes printed in the preview. GitHub Release creation does not upload extension ZIPs or publish to a browser store. Use `pnpm zip` separately when a package is needed. Installation is independent; see [local installation](install-local.md).

To override GitHub Release creation for one run:

```bash
make release RELEASE_FLAGS="--apply --no-github-release"

# Local commit and tag only; no remote availability/conflict checks
make release RELEASE_FLAGS="--apply --no-push --no-github-release"
```

## First release of an unpublished version

```bash
make release-initial
make release-initial RELEASE_FLAGS=--apply
```

This publishes the existing version without modifying `package.json`, the lockfile or HEAD. It checks that the version is absent from local and remote tags and from GitHub Releases, including visible drafts, then runs checks and creates an annotated tag with `Release-Type: initial`. Failed GitHub queries stop the process rather than being treated as absence. GitHub targets require `gh` for this check even with `--no-github-release`.

`release-initial` cannot be used for this project's already tagged `0.1.4`. Use `make release` for the next version; do not move or delete an existing tag to reuse it.

## Failure recovery

The script stops without automatic rollback, tag movement or force-push. Inspect `git status`, `git log -1` and the local/remote tags before continuing.

- If a check fails, the target version edit remains, but no release commit or tag has been created. Resolve the failure and review any check side effects. Restore only the release's version edit to the previous value, then commit the fixes and rerun the normal release from a clean tree.
- If a commit or hook fails, inspect the index and HEAD before retrying. A completed release commit without a tag requires manual verification before creating its annotated tag; do not bump again blindly.
- If the release tag exists at HEAD but a push or GitHub Release creation failed, fix the external problem and resume with the exact current version:

  ```bash
  make release VERSION_BUMP=0.1.5 RELEASE_FLAGS="--resume --apply"
  ```

Resume requires a clean tree and the matching annotated tag at HEAD. It neither bumps nor reruns checks. Upgrade tags require the expected release commit; initial tags require the initial-release marker. Older tags without that marker cannot be retrofitted through this command. If HEAD has advanced, investigate separately instead of moving the tag.

## Verification

`pnpm test:release` exercises previews, version changes, guard failures, atomic pushes, GitHub Release calls and resume using temporary Git repositories, local bare remotes and a simulated `gh`. It does not publish to GitHub. These tests also run as part of `pnpm test`.
