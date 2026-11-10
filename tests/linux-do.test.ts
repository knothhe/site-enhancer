import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { getPostText, getPostUrl, linuxDoLabels } from '../utils/linux-do.ts';

let win: Window;
beforeEach(() => {
  win = new Window({ url: 'https://linux.do/t/topic/42?u=me' });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : (win as any)[name] });
  }
});
afterEach(async () => { await win.happyDOM.close(); });

function post(html: string) {
  const element = document.createElement('article');
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
}

test('skips image lightbox captions and restores their style', () => {
  const article = post(`<div class="cooked"><div class="lightbox-wrapper"><a class="lightbox"><img alt="x">
    <div class="meta" style="display: flex"><span class="filename">b733a3</span><span class="informations">1080×1474 202 KB</span></div></a></div>
    <p>Post body</p><div class="lightbox-wrapper"><div class="meta">photo.png 10 KB</div></div></div>`);
  assert.equal(getPostText(article), 'Post body');
  assert.equal(article.querySelector('.meta')!.getAttribute('style'), 'display: flex');
  assert.equal(article.querySelectorAll('.meta')[1].hasAttribute('style'), false);
});

test('uses the post date link instead of topic links in the body', () => {
  const article = post(`<div class="cooked"><p><a href="/t/topic/999">other topic</a></p></div>
    <div class="post-info post-date"><a class="post-date" href="/t/topic/42/3?u=me">1m</a></div>`);
  assert.equal(getPostUrl(article, win.location as any), 'https://linux.do/t/topic/42/3');
});

test('falls back to the current page without the referral parameter', () => {
  assert.equal(getPostUrl(post('<div class="cooked">x</div>'), win.location as any), 'https://linux.do/t/topic/42');
});

test('follows the page language and falls back to English', () => {
  assert.equal(linuxDoLabels('zh-CN').copiedText, '已复制文字');
  assert.equal(linuxDoLabels('en').copiedText, 'Copied text!');
  assert.equal(linuxDoLabels('fr').text, 'Copy post text only');
});
