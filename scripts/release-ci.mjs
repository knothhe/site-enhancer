#!/usr/bin/env node
// Helpers for .github/workflows/release.yml.
//   verify [tag]  Check that the tag, package.json and the built Chrome/Firefox manifests agree,
//                 then print the two ZIP paths (one per line). Without a tag only the build is checked.
//   notes <tag>   Print GitHub Release notes for a tag (same format as the release preview).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse, releaseNotes } from './release.mjs';

const readJSON = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const fail = message => { throw new Error(message); };
const prefix = () => (fs.existsSync('.release.json') ? readJSON('.release.json').tag_prefix : undefined) ?? 'v';

function tagVersion(tag) {
  const tagPrefix = prefix();
  if (!tag.startsWith(tagPrefix)) fail(`Tag ${tag} does not start with ${tagPrefix}.`);
  const version = tag.slice(tagPrefix.length);
  parse(version);
  return version;
}

export function verify(tag, output = '.output') {
  const pkg = readJSON('package.json');
  parse(pkg.version);
  if (tag && tagVersion(tag) !== pkg.version) fail(`Tag ${tag} does not match package.json version ${pkg.version}.`);
  const { pre } = parse(pkg.version);
  const core = pkg.version.split(/[-+]/)[0];
  const zips = [];
  for (const [browser, dir] of [['chrome', 'chrome-mv3'], ['firefox', 'firefox-mv2']]) {
    const manifestFile = path.join(output, dir, 'manifest.json');
    if (!fs.existsSync(manifestFile)) fail(`Missing ${manifestFile}; build ${browser} first.`);
    const manifest = readJSON(manifestFile);
    // WXT writes the numeric core to "version" and keeps a prerelease in "version_name" (Chrome only).
    const ok = pre === undefined ? manifest.version === pkg.version
      : manifest.version === core && [undefined, pkg.version].includes(manifest.version_name);
    if (!ok) fail(`${manifestFile} version ${manifest.version} does not match package.json ${pkg.version}.`);
    // WXT names ZIPs after the manifest version, so a Firefox prerelease ZIP carries only the core.
    const names = [...new Set([pkg.version, manifest.version_name, manifest.version].filter(Boolean))]
      .map(version => path.join(output, `${pkg.name}-${version}-${browser}.zip`));
    const zip = names.find(name => fs.existsSync(name));
    if (!zip) fail(`Missing ${names[0]}; run the ${browser} zip first.`);
    zips.push(zip);
  }
  return zips;
}

export function notes(tag, repo) {
  if (!repo) fail('Repository is required (owner/name or GITHUB_REPOSITORY).');
  const version = tagVersion(tag);
  const commit = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' });
  if (commit.status !== 0) fail(`Tag ${tag} not found; fetch tags with full history.`);
  return releaseNotes(repo, prefix(), version, commit.stdout.trim(), tag);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, tag, repo = process.env.GITHUB_REPOSITORY] = process.argv.slice(2);
  try {
    if (command === 'verify') console.log(verify(tag).join('\n'));
    else if (command === 'notes' && tag) process.stdout.write(notes(tag, repo));
    else fail('Usage: node scripts/release-ci.mjs verify [tag] | notes <tag> [owner/repo]');
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
