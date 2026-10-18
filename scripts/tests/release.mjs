import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { nextVersion, parse, githubRepo } from '../release.mjs';

const project = new URL('../../', import.meta.url);

// All commits, tags, pushes and GitHub CLI calls stay in temporary fixtures.
function fixture(t, { github = false, checks } = {}) {
  const folder = fs.mkdtempSync(path.join(tmpdir(), 'site-enhancer-release-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const root = path.join(folder, 'work');
  const remote = path.join(folder, 'remote.git');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Release Test', GIT_AUTHOR_EMAIL: 'release@example.invalid',
    GIT_COMMITTER_NAME: 'Release Test', GIT_COMMITTER_EMAIL: 'release@example.invalid',
  };
  const call = (command, args, overrides = {}) => spawnSync(command, args, {
    cwd: root, env, encoding: 'utf8', timeout: 20000, ...overrides,
  });
  const ok = (command, args, overrides) => {
    const result = call(command, args, overrides);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  };
  const git = (...args) => ok('git', args);
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  for (const file of ['Makefile', 'scripts/release.mjs', 'scripts/install-local.mjs'])
    fs.copyFileSync(new URL(file, project), path.join(root, file));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '0.1.4', scripts: { 'install:local': 'node scripts/install-local.mjs' },
  }, null, 2) + '\n');
  const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), lock);
  const config = JSON.parse(fs.readFileSync(new URL('.release.json', project), 'utf8'));
  config.github_release = github;
  config.checks = checks ?? [[process.execPath, '-e',
    "require('node:fs').writeFileSync('.git/checked-version', JSON.parse(require('node:fs').readFileSync('package.json')).version)"]];
  fs.writeFileSync(path.join(root, '.release.json'), JSON.stringify(config));
  git('add', '--', 'Makefile', 'scripts', 'package.json', 'pnpm-lock.yaml', '.release.json');
  git('commit', '-m', 'feat: fixture extension');
  git('tag', '-a', 'v0.1.3', '-m', 'Previous release');
  git('commit', '--allow-empty', '-m', 'feat: release workflow');
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main', 'refs/tags/v0.1.3');
  const head = git('rev-parse', 'HEAD');
  const version = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const make = (...args) => call('make', ['--silent', ...args]);
  if (github) {
    const url = 'https://github.com/example/fixture.git';
    const realGit = ok('which', ['git']);
    git('remote', 'set-url', 'origin', url);
    const bin = path.join(folder, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (['ls-remote', 'push'].includes(args[0])) args.unshift('-c', ${JSON.stringify(`url.${remote}.insteadOf=${url}`)});
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('.git/gh-calls', JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  if (process.env.RELEASE_TEST_API_ERROR) process.exit(1);
  console.log(process.env.RELEASE_TEST_EXISTING_TAG ?? '');
} else if (args[0] === 'auth' && args[1] === 'status') {
  process.exit(0);
} else if (args[0] === 'release' && args[1] === 'view') {
  if (!fs.existsSync('.git/github-release')) process.exit(1);
  console.log(fs.readFileSync('.git/github-release', 'utf8'));
} else if (args[0] === 'release' && args[1] === 'create') {
  if (process.env.RELEASE_TEST_CREATE_ERROR) process.exit(1);
  fs.writeFileSync('.git/release-notes', fs.readFileSync(0, 'utf8'));
  const url = 'https://github.com/example/fixture/releases/tag/' + args[2];
  fs.writeFileSync('.git/github-release', JSON.stringify({ url }));
  console.log(url);
} else {
  console.error('Unexpected gh call', args);
  process.exit(1);
}
`, { mode: 0o755 });
    env.PATH = bin + path.delimiter + env.PATH;
  }
  return { root, remote, head, lock, env, call, ok, git, make, version };
}

test('SemVer bumps, prereleases and validation', () => {
  for (const [bump, expected] of [['major', '2.0.0'], ['minor', '1.3.0'], ['patch', '1.2.4']])
    assert.equal(nextVersion('1.2.3', bump), expected);
  const sequence = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 1; i < sequence.length; i++) assert.equal(nextVersion(sequence[i - 1], sequence[i]), sequence[i]);
  for (const value of ['01.2.3', '1.2', 'v1.2.3', '1.2.3-01', '1.2.3-a..b', '1.2.3+', '1.2.3\n', null])
    assert.throws(() => parse(value));
  for (const [current, target] of [['1.2.3', '1.2.3+build'], ['1.2.3', '1.2.2'], ['1.2.3-rc.1', 'patch']])
    assert.throws(() => nextVersion(current, target));
  assert.equal(githubRepo('git@github.com:knothhe/site-enhancer.git'), 'knothhe/site-enhancer');
  assert.throws(() => githubRepo('https://example.com/fixture'));
});

test('Make previews without changing files, running checks or publishing', t => {
  const f = fixture(t, { github: true });
  const result = f.make('release');
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'preview');
  assert.equal(plan.target, '0.1.5');
  assert.equal(plan.check_phase, 'after-bump');
  assert.equal(plan.github_release, true);
  assert.match(plan.release_notes, /compare\/v0.1.3\.\.\.v0.1.5/);
  assert.match(plan.release_notes, /feat: release workflow/);
  assert.equal(f.version(), '0.1.4');
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(f.root, '.git/checked-version')), false);
  assert.equal(fs.existsSync(path.join(f.root, '.git/gh-calls')), false);
});

test('Make upgrades, checks the target version, atomically pushes and creates a GitHub Release', t => {
  const f = fixture(t, { github: true });
  const result = f.make('release', 'VERSION_BUMP=minor', 'RELEASE_FLAGS=--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.version(), '0.2.0');
  assert.equal(fs.readFileSync(path.join(f.root, '.git/checked-version'), 'utf8'), '0.2.0');
  assert.equal(fs.readFileSync(path.join(f.root, 'pnpm-lock.yaml'), 'utf8'), f.lock);
  assert.equal(f.git('log', '-1', '--format=%s'), 'chore(release): v0.2.0');
  assert.equal(f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'package.json');
  assert.equal(f.git('cat-file', '-t', 'v0.2.0'), 'tag');
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), f.git('rev-parse', 'HEAD'));
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'v0.2.0'), f.git('rev-parse', 'v0.2.0'));
  assert.match(fs.readFileSync(path.join(f.root, '.git/github-release'), 'utf8'), /releases\/tag\/v0.2.0/);
  const notes = fs.readFileSync(path.join(f.root, '.git/release-notes'), 'utf8');
  assert.match(notes, /Full Changelog/);
  assert.match(notes, /feat: release workflow/);
  assert.doesNotMatch(notes, /chore\(release\)/);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('failed checks keep the version edit but create no commit, tag or remote changes', t => {
  const f = fixture(t, { checks: [[process.execPath, '-e', 'process.exit(1)']] });
  const result = f.make('release', 'RELEASE_FLAGS=--apply');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Check failed/);
  assert.equal(f.version(), '0.1.5');
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal(f.git('tag', '--list', 'v0.1.5'), '');
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), f.head);
  assert.equal(f.git('diff', '--name-only'), 'package.json');
});

test('a check changing tracked source stops before committing or tagging', t => {
  const f = fixture(t, { checks: [[process.execPath, '-e', "require('node:fs').appendFileSync('Makefile', '\\n# side effect\\n')"]] });
  const result = f.make('release', 'RELEASE_FLAGS=--apply');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Checks changed the working tree/);
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal(f.git('tag', '--list', 'v0.1.5'), '');
});

test('dirty worktrees, wrong branches and existing tags are rejected', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'untracked.txt'), 'keep');
  assert.match(f.make('release', 'RELEASE_FLAGS=--apply').stderr, /Working tree must be clean/);
  assert.equal(f.version(), '0.1.4');
  fs.rmSync(path.join(f.root, 'untracked.txt'));
  f.git('switch', '-c', 'feature');
  assert.match(f.make('release').stderr, /Release must run on branch main/);
  f.git('switch', 'main');
  f.git('tag', 'v0.1.5');
  assert.match(f.make('release').stderr, /Tag already exists/);
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
});

test('initial release preserves version and HEAD, and rejects an existing release', t => {
  const f = fixture(t, { github: true });
  const before = fs.readFileSync(path.join(f.root, 'package.json'), 'utf8');
  f.env.RELEASE_TEST_EXISTING_TAG = 'v0.1.4';
  assert.match(f.make('release-initial').stderr, /GitHub Release already exists/);
  delete f.env.RELEASE_TEST_EXISTING_TAG;
  f.env.RELEASE_TEST_API_ERROR = '1';
  assert.notEqual(f.make('release-initial').status, 0);
  assert.equal(f.git('tag', '--list', 'v0.1.4'), '');
  delete f.env.RELEASE_TEST_API_ERROR;
  const result = f.make('release-initial', 'RELEASE_FLAGS=--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(f.root, 'package.json'), 'utf8'), before);
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal(f.git('cat-file', '-t', 'v0.1.4'), 'tag');
  assert.match(f.git('for-each-ref', '--format=%(contents)', 'refs/tags/v0.1.4'), /Release-Type: initial/);
  assert.match(f.make('release-initial').stderr, /Tag already exists/);
});

test('rejected atomic push leaves the remote untouched and resumes without bumping again', t => {
  const f = fixture(t);
  const hook = path.join(f.remote, 'hooks/pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.notEqual(f.make('release', 'RELEASE_FLAGS=--apply').status, 0);
  const released = f.git('rev-parse', 'HEAD');
  assert.notEqual(released, f.head);
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'main'), f.head);
  assert.equal(f.git('--git-dir', f.remote, 'tag', '--list', 'v0.1.5'), '');
  fs.rmSync(hook);
  fs.rmSync(path.join(f.root, '.git/checked-version'));
  const result = f.make('release', 'VERSION_BUMP=0.1.5', 'RELEASE_FLAGS=--resume --apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.git('rev-parse', 'HEAD'), released);
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'v0.1.5^{commit}'), released);
  assert.equal(fs.existsSync(path.join(f.root, '.git/checked-version')), false);
});

test('GitHub Release creation failure can resume and an existing Release is preserved', t => {
  const f = fixture(t, { github: true });
  f.env.RELEASE_TEST_CREATE_ERROR = '1';
  assert.notEqual(f.make('release', 'RELEASE_FLAGS=--apply').status, 0);
  const released = f.git('rev-parse', 'HEAD');
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'v0.1.5^{commit}'), released);
  delete f.env.RELEASE_TEST_CREATE_ERROR;
  const resume = () => f.make('release', 'VERSION_BUMP=0.1.5', 'RELEASE_FLAGS=--resume --apply');
  assert.equal(resume().status, 0);
  const notes = fs.readFileSync(path.join(f.root, '.git/release-notes'), 'utf8');
  assert.equal(resume().status, 0);
  assert.equal(fs.readFileSync(path.join(f.root, '.git/release-notes'), 'utf8'), notes);
  assert.equal(f.git('rev-parse', 'HEAD'), released);
  const calls = fs.readFileSync(path.join(f.root, '.git/gh-calls'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(args => args[0] === 'release' && args[1] === 'create').length, 2);
});

test('Make install passes flags to the existing pnpm installer without changing version or Git state', t => {
  const f = fixture(t);
  const result = f.make('install', 'INSTALL_FLAGS=--help');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Builds MV3 and installs into/);
  assert.equal(f.version(), '0.1.4');
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal(f.git('status', '--porcelain'), '');
});
