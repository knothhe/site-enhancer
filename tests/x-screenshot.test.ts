import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { screenshotPosts, screenshotBackground } from '../utils/x-screenshot.ts';

for (const [path, selected, expected] of [
  ['/home', 'reply', ['reply']],
  ['/author/status/1', 'reply', ['root', 'reply']],
  ['/author/status/1', 'root', ['root']],
  ['/author/status/3', 'reply', ['reply']],
  ['/author/status/9', 'reply', ['reply']],
] as const) {
  test(`screenshot selection ${path} ${selected}`, async () => {
    const win = new Window({ url: `https://x.com${path}` });
    const doc = win.document;
    doc.body.innerHTML = '<main data-testid="primaryColumn"><article data-testid="tweet" id="root" data-url="https://x.com/author/status/1"></article><article data-testid="tweet" id="other" data-url="https://x.com/author/status/2"></article><article data-testid="tweet" id="reply" data-url="https://x.com/author/status/3"></article></main>';
    const result = screenshotPosts(doc.getElementById(selected) as unknown as HTMLElement, node => node.getAttribute('data-url')!);
    assert.deepEqual(result.map(node => node.id), expected);
    await win.happyDOM.close();
  });
}

test('screenshot background follows the nearest opaque host background', async () => {
  const win = new Window();
  win.document.body.style.backgroundColor = 'rgb(16, 19, 24)';
  const post = win.document.createElement('article'); win.document.body.append(post);
  assert.equal(screenshotBackground(post as unknown as HTMLElement), 'rgb(16, 19, 24)');
  await win.happyDOM.close();
});

test('transparent hover backgrounds cannot make the screenshot transparent', async () => {
  const win = new Window();
  win.document.body.style.backgroundColor = 'rgb(21, 32, 43)';
  const post = win.document.createElement('article');
  post.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
  win.document.body.append(post);
  assert.equal(screenshotBackground(post as unknown as HTMLElement), 'rgb(21, 32, 43)');
  win.document.body.style.backgroundColor = 'transparent';
  assert.equal(screenshotBackground(post as unknown as HTMLElement), '#ffffff');
  await win.happyDOM.close();
});
