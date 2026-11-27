import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { installXDefaultFollowing } from '../utils/x-default-following.ts';

let win: Window;

beforeEach(() => {
  win = new Window({ url: 'https://x.com/home' });
  for (const name of ['window', 'document', 'location', 'MutationObserver']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : (win as any)[name] });
  }
});

afterEach(async () => { await win.happyDOM.close(); });

function renderHomeTabs(followingSelected = false) {
  document.body.innerHTML = `<div data-testid="primaryColumn"><div role="tablist">
    <a role="tab" aria-selected="${!followingSelected}">For you</a>
    <a role="tab" aria-selected="${followingSelected}">Following</a>
  </div></div>`;
  const tabs = document.querySelectorAll<HTMLElement>('[role="tab"]');
  let clicks = 0;
  tabs[1].addEventListener('click', () => {
    clicks++;
    tabs[0].setAttribute('aria-selected', 'false');
    tabs[1].setAttribute('aria-selected', 'true');
  });
  return { forYou: tabs[0], following: tabs[1], getClicks: () => clicks };
}

test('switches to Following once per /home visit without fighting manual switches back', () => {
  const { forYou, following, getClicks } = renderHomeTabs(false);
  const ctrl = installXDefaultFollowing();
  ctrl.setEnabled(true);
  assert.equal(getClicks(), 1);
  assert.equal(following.getAttribute('aria-selected'), 'true');
  // User manually switches back to For you; should not re-click during the same visit.
  forYou.setAttribute('aria-selected', 'true');
  following.setAttribute('aria-selected', 'false');
  assert.equal(getClicks(), 1);
  // Navigating away and returning to /home re-arms the switch.
  ctrl.onNavigate('/explore');
  ctrl.onNavigate('/home');
  assert.equal(getClicks(), 2);
  ctrl.remove();
});

test('does nothing when disabled or already on Following', () => {
  const { getClicks } = renderHomeTabs(true);
  const ctrl = installXDefaultFollowing();
  ctrl.setEnabled(true);
  assert.equal(getClicks(), 0);
  ctrl.remove();
});
