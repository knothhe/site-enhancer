const KEY = '__siteEnhancerDetail';
type Entry = { session: string; group: number; index: number; page: string };
type Group = { page: string; entries: Array<string | undefined> };

/** Keeps X's route/state intact while making detail selections browser history entries. */
export function installDetailHistory(apply: (url: string | undefined) => void, changed: () => void, active: () => boolean) {
  const session = crypto.randomUUID();
  // Keep each native route visit separate, including repeated visits to the same URL.
  const groups = new Map<number, Group>();
  let nextGroup = 0;
  let routeChanged = false;
  let lastPage = location.href;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  const routeChange = (event: Event) => {
    const from = (event as Event & { from?: { url?: string } }).from?.url;
    routeChanged = !!from && from !== location.href;
  };
  navigation?.addEventListener('currententrychange', routeChange);
  const state = () => window.history.state;
  const own = (): Entry | undefined => {
    const marker = state()?.[KEY];
    const group = groups.get(marker?.group);
    return marker?.session === session && marker.page === location.href && !!group && group.page === marker.page && Number.isInteger(marker.index) && marker.index >= 0 && marker.index < group.entries.length ? marker : undefined;
  };
  function select(url: string | undefined) {
    lastPage = location.href;
    let marker = own();
    if (!marker) {
      marker = { session, group: nextGroup++, index: 0, page: location.href };
      groups.set(marker.group, { page: location.href, entries: [undefined] });
      window.history.replaceState({ ...state(), [KEY]: marker }, '');
    }
    const group = groups.get(marker.group)!;
    if (group.entries[marker.index] !== url) {
      group.entries = group.entries.slice(0, marker.index + 1);
      group.entries.push(url);
      marker = { ...marker, index: marker.index + 1 };
      window.history.pushState({ ...state(), [KEY]: marker }, '');
    }
    apply(url);
    changed();
  }
  function restore(event?: PopStateEvent) {
    // Location-change notifications also track routes in browsers without Navigation API.
    const pageChanged = lastPage !== location.href;
    lastPage = location.href;
    if (!active()) return false;
    const marker = own();
    if (!marker) return false;
    if (event && (routeChanged || pageChanged)) {
      // Let X render a real route transition first (e.g. Explore -> Home).
      routeChanged = false;
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => restore(), 0);
      return false;
    }
    // This is a detail selection, not an X route change. Don't ask X to reset its feed.
    event?.stopImmediatePropagation();
    apply(groups.get(marker.group)!.entries[marker.index]);
    changed();
    return true;
  }
  window.addEventListener('popstate', restore, true);
  return {
    select,
    restore,
    canBack: () => (own()?.index ?? 0) > 0,
    canForward: () => {
      const marker = own();
      return !!marker && marker.index < groups.get(marker.group)!.entries.length - 1;
    },
    back() { if (this.canBack()) window.history.back(); },
    forward() { if (this.canForward()) window.history.forward(); },
    remove() {
      window.removeEventListener('popstate', restore, true);
      navigation?.removeEventListener('currententrychange', routeChange);
      clearTimeout(restoreTimer);
      if (state()?.[KEY]?.session === session) {
        const next = { ...state() };
        delete next[KEY];
        window.history.replaceState(Object.keys(next).length ? next : null, '');
      }
    },
  };
}
