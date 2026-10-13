import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const releaseScript = fileURLToPath(new URL('./release.mjs', import.meta.url));

function repository(t, { workspace = 'settings', checks = [], github = false } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'copy-enhancer-release-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  const hooks = path.join(directory, 'empty-hooks');
  fs.mkdirSync(root);
  fs.mkdirSync(hooks);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '7',
    GIT_CONFIG_KEY_0: 'user.name',
    GIT_CONFIG_VALUE_0: 'Release Tests',
    GIT_CONFIG_KEY_1: 'user.email',
    GIT_CONFIG_VALUE_1: 'release-tests@example.invalid',
    GIT_CONFIG_KEY_2: 'commit.gpgsign',
    GIT_CONFIG_VALUE_2: 'false',
    GIT_CONFIG_KEY_3: 'tag.gpgsign',
    GIT_CONFIG_VALUE_3: 'false',
    GIT_CONFIG_KEY_4: 'core.hooksPath',
    GIT_CONFIG_VALUE_4: hooks,
    GIT_CONFIG_KEY_5: 'protocol.allow',
    GIT_CONFIG_VALUE_5: 'never',
    GIT_CONFIG_KEY_6: 'protocol.file.allow',
    GIT_CONFIG_VALUE_6: 'always',
  });
  const execute = (command, args, check = true) => {
    const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    if (check) assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const git = (...args) => execute('git', args).stdout.trim();
  const write = (name, content) => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  };
  const commit = (message, files) => {
    git('add', '--', ...files);
    git('commit', '-m', message);
  };
  git('init', '--initial-branch=main', '--template=');
  write('package.json', { name: 'release-fixture', version: '1.2.3', private: true });
  write('.release.json', {
    version_file: 'package.json', branch: 'main', remote: 'origin', tag_prefix: 'v',
    checks, check_phase: 'before-bump', github_release: github,
  });
  write('.gitignore', 'check-ran\n');
  write('scripts/release.mjs', fs.readFileSync(releaseScript, 'utf8'));
  const initialFiles = ['package.json', '.release.json', '.gitignore', 'scripts/release.mjs'];
  if (workspace !== 'none') {
    write('pnpm-workspace.yaml', `${workspace === 'multiple' ? "packages:\n  - 'packages/*'\n" : ''}allowBuilds:\n  esbuild: true\n  spawn-sync: true\n`);
    initialFiles.push('pnpm-workspace.yaml');
  }
  if (workspace === 'multiple') {
    write('packages/child/package.json', { name: 'release-child', version: '1.2.3', private: true });
    initialFiles.push('packages/child/package.json');
  }
  commit('Initial fixture', initialFiles);
  git('tag', '-a', 'v1.2.3', '-m', 'Release v1.2.3');
  const release = (...args) => execute(process.execPath, ['scripts/release.mjs', ...args], false);
  const state = () => ({
    head: git('rev-parse', 'HEAD'),
    refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
    index: git('ls-files', '--stage'),
    status: git('status', '--porcelain', '--untracked-files=all'),
    diff: git('diff', '--binary'),
    package: fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  });
  const remote = () => {
    const bare = path.join(directory, 'remote.git');
    git('init', '--bare', '--initial-branch=main', '--template=', bare);
    git('remote', 'add', 'origin', bare);
    git('push', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.2.3:refs/tags/v1.2.3');
    return bare;
  };
  return { directory, root, env, execute, git, write, commit, release, state, remote };
}

function successful(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('allowBuilds-only pnpm settings permit a read-only preview without running checks', t => {
  const checks = [[process.execPath, '-e', "require('node:fs').writeFileSync('check-ran', 'ran')"]];
  const repo = repository(t, { checks });
  const before = repo.state();
  const result = repo.release('patch', '--no-push');
  successful(result);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'preview');
  assert.equal(plan.current, '1.2.3');
  assert.equal(plan.target, '1.2.4');
  assert.equal(plan.tag, 'v1.2.4');
  assert.equal(plan.check_phase, 'before-bump');
  assert.equal(plan.push, false);
  assert.deepEqual(plan.files, ['package.json']);
  assert.deepEqual(plan.checks, checks);
  assert.equal(fs.existsSync(path.join(repo.root, 'check-ran')), false);
  assert.deepEqual(repo.state(), before);
});

test('a pnpm workspace with a second package is rejected before changing anything', t => {
  const repo = repository(t, { workspace: 'multiple' });
  const before = repo.state();
  const result = repo.release('patch', '--no-push');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Workspace\/monorepo detected/);
  assert.deepEqual(repo.state(), before);
});

test('untracked work prevents both preview and execution', t => {
  const repo = repository(t);
  repo.write('unfinished.txt', 'Keep this work.\n');
  const before = repo.state();
  for (const flags of [[], ['--apply']]) {
    const result = repo.release('patch', '--no-push', ...flags);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Working tree must be clean/);
    assert.deepEqual(repo.state(), before);
  }
});

test('a failed before-bump check leaves the version and Git state unchanged', t => {
  const repo = repository(t, { checks: [[process.execPath, '-e', 'process.exit(7)']] });
  const before = repo.state();
  const result = repo.release('patch', '--apply', '--no-push');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Check failed/);
  assert.match(result.stderr, /Stopped before updating the version/);
  assert.deepEqual(repo.state(), before);
});

test('publishing to a local bare remote commits only the version, tags, and supports exact resume', t => {
  const repo = repository(t, {
    checks: [[process.execPath, '-e', "require('node:fs').appendFileSync('check-ran', 'ran\\n')"]],
  });
  const bare = repo.remote();
  const originalHead = repo.git('rev-parse', 'HEAD');
  successful(repo.release('patch', '--apply'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo.root, 'package.json'), 'utf8')).version, '1.2.4');
  assert.equal(repo.git('log', '-1', '--format=%s'), 'chore(release): v1.2.4');
  assert.equal(repo.git('rev-parse', 'HEAD^'), originalHead);
  assert.equal(repo.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'package.json');
  assert.equal(repo.git('cat-file', '-t', 'refs/tags/v1.2.4'), 'tag');
  assert.equal(repo.git('rev-parse', 'v1.2.4^{commit}'), repo.git('rev-parse', 'HEAD'));
  assert.equal(repo.git('--git-dir=' + bare, 'rev-parse', 'refs/heads/main'), repo.git('rev-parse', 'HEAD'));
  assert.equal(repo.git('--git-dir=' + bare, 'rev-parse', 'refs/tags/v1.2.4'), repo.git('rev-parse', 'refs/tags/v1.2.4'));
  assert.equal(repo.git('status', '--porcelain'), '');
  const released = repo.state();
  const resumePlan = repo.release('1.2.4', '--resume');
  successful(resumePlan);
  assert.deepEqual(JSON.parse(resumePlan.stdout).checks, []);
  assert.equal(JSON.parse(resumePlan.stdout).check_phase, null);
  successful(repo.release('1.2.4', '--resume', '--apply'));
  assert.deepEqual(repo.state(), released);
  assert.equal(fs.readFileSync(path.join(repo.root, 'check-ran'), 'utf8'), 'ran\n');
});

test('a remote without atomic push support receives neither the new commit nor tag', t => {
  const repo = repository(t);
  const bare = repo.remote();
  const remoteHead = repo.git('--git-dir=' + bare, 'rev-parse', 'refs/heads/main');
  repo.git('--git-dir=' + bare, 'config', 'receive.advertiseAtomic', 'false');
  const result = repo.release('patch', '--apply');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /atomic/i);
  assert.equal(repo.git('--git-dir=' + bare, 'rev-parse', 'refs/heads/main'), remoteHead);
  assert.equal(repo.git('--git-dir=' + bare, 'tag', '--list', 'v1.2.4'), '');
  assert.equal(repo.git('cat-file', '-t', 'refs/tags/v1.2.4'), 'tag');
  repo.git('--git-dir=' + bare, 'config', 'receive.advertiseAtomic', 'true');
  successful(repo.release('1.2.4', '--resume', '--apply'));
  assert.equal(repo.git('--git-dir=' + bare, 'rev-parse', 'refs/tags/v1.2.4'), repo.git('rev-parse', 'refs/tags/v1.2.4'));
});

test('GitHub Release uses local history and passes previewed notes to gh, with idempotent resume', t => {
  const repo = repository(t, { github: true });
  repo.write('feature.txt', 'Preview support\n');
  repo.commit('feat: add [preview] buttons', ['feature.txt']);
  const featureHash = repo.git('rev-parse', '--short', 'HEAD');
  repo.git('commit', '--allow-empty', '-m', 'chore(release): older release bookkeeping');
  const bare = repo.remote();
  const githubUrl = 'https://github.com/release-tests/fixture.git';
  repo.git('remote', 'set-url', '--push', 'origin', githubUrl);
  const realGit = repo.execute('sh', ['-c', 'command -v git']).stdout.trim();
  const bin = path.join(repo.directory, 'bin');
  fs.mkdirSync(bin);
  const mockScript = path.join(repo.directory, 'mock-gh.mjs');
  const log = path.join(repo.directory, 'gh-calls.jsonl');
  const marker = path.join(repo.directory, 'github-release-created');
  const mockGitScript = path.join(repo.directory, 'local-git.mjs');
  // Preserve a GitHub push URL for the release plan while directing every
  // remote operation to the fixture. Git's protocol policy also blocks HTTPS.
  fs.writeFileSync(mockGitScript, `
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === 'ls-remote') {
  if (args[1] !== process.env.RELEASE_TEST_GITHUB_URL) process.exit(99);
  args[1] = process.env.RELEASE_TEST_REMOTE;
} else if (args[0] === 'push') {
  if (args[1] !== '--atomic' || args[2] !== 'origin') process.exit(99);
  args[2] = process.env.RELEASE_TEST_REMOTE;
}
const result = spawnSync(process.env.RELEASE_TEST_GIT_BIN, args, { stdio: 'inherit' });
process.exit(result.status ?? 99);
`);
  fs.writeFileSync(mockScript, `
import fs from 'node:fs';
const args = process.argv.slice(2);
const notes = args[0] === 'release' && args[1] === 'create' ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(process.env.RELEASE_TEST_GH_LOG, JSON.stringify({ args, notes }) + '\\n');
if (args[0] === 'auth' && args[1] === 'status') process.exit(0);
if (args[0] === 'release' && args[1] === 'view') {
  if (!fs.existsSync(process.env.RELEASE_TEST_GH_MARKER)) process.exit(1);
  console.log(JSON.stringify({ url: 'https://github.com/release-tests/fixture/releases/tag/v1.2.4' }));
} else if (args[0] === 'release' && args[1] === 'create') {
  fs.writeFileSync(process.env.RELEASE_TEST_GH_MARKER, 'created');
  console.log('https://github.com/release-tests/fixture/releases/tag/v1.2.4');
} else process.exit(99);
`);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(mockScript)} "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(mockGitScript)} "$@"\n`, { mode: 0o755 });
  Object.assign(repo.env, {
    PATH: bin + path.delimiter + process.env.PATH,
    RELEASE_TEST_GH_LOG: log,
    RELEASE_TEST_GH_MARKER: marker,
    RELEASE_TEST_GIT_BIN: realGit,
    RELEASE_TEST_REMOTE: bare,
    RELEASE_TEST_GITHUB_URL: githubUrl,
  });
  const before = repo.state();
  const preview = repo.release('patch');
  successful(preview);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.github_release, true);
  assert.equal(plan.github_repo, 'release-tests/fixture');
  assert.match(plan.release_notes, /https:\/\/github\.com\/release-tests\/fixture\/compare\/v1\.2\.3\.\.\.v1\.2\.4/);
  assert.ok(plan.release_notes.includes(`- feat: add \\[preview\\] buttons (\`${featureHash}\`)`));
  assert.equal(plan.release_notes.includes('Initial fixture'), false);
  assert.equal(plan.release_notes.includes('older release bookkeeping'), false);
  assert.equal(fs.existsSync(log), false);
  assert.deepEqual(repo.state(), before);
  successful(repo.release('patch', '--apply'));
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const create = calls().find(call => call.args[1] === 'create');
  assert.deepEqual(create.args, ['release', 'create', 'v1.2.4', '--repo', 'release-tests/fixture', '--verify-tag', '--notes-file', '-', '--title', 'v1.2.4']);
  assert.equal(create.notes, plan.release_notes);
  successful(repo.release('1.2.4', '--resume', '--apply'));
  assert.equal(calls().filter(call => call.args[1] === 'create').length, 1);
});
