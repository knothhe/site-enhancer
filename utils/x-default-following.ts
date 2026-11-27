import { PRIMARY } from './x-dom.ts';

/**
 * Automatically switches the X Home timeline from "For you" to "Following" when
 * navigating to /home, without fighting manual clicks back to "For you" during
 * the same visit.
 */
export function installXDefaultFollowing() {
  let enabled = false;
  let switchedForVisit = false;
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function findFollowingTab(): HTMLElement | undefined {
    const primary = document.querySelector(PRIMARY);
    const tablist = primary?.querySelector('[role="tablist"]');
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (tabs.length < 2) return;
    // On /home, the first two tabs are always "For you" and "Following" regardless of language.
    return tabs[1];
  }

  function trySwitch() {
    if (!enabled || switchedForVisit || location.pathname !== '/home') return;
    const following = findFollowingTab();
    if (!following) return;
    switchedForVisit = true;
    stopObserving();
    if (following.getAttribute('aria-selected') !== 'true') {
      following.click();
    }
  }

  function stopObserving() {
    observer?.disconnect();
    observer = undefined;
    clearTimeout(timer);
    timer = undefined;
  }

  function arm() {
    stopObserving();
    if (!enabled || switchedForVisit || location.pathname !== '/home') return;
    trySwitch();
    if (switchedForVisit || !document.documentElement) return;
    observer = new MutationObserver(trySwitch);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Stop waiting after 10 seconds if the tablist never appears.
    timer = setTimeout(stopObserving, 10_000);
  }

  return {
    setEnabled(value: boolean) {
      enabled = value;
      if (enabled) {
        switchedForVisit = false;
        arm();
      } else {
        stopObserving();
      }
    },
    onNavigate(pathname: string) {
      if (pathname === '/home') {
        switchedForVisit = false;
        arm();
      } else {
        stopObserving();
      }
    },
    remove() {
      enabled = false;
      stopObserving();
    },
  };
}
