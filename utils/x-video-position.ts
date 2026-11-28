// One explicit subtitle navigation per tab. Blob/MediaSource URLs change on reload,
// so identify the video by X's post ID and attachment number.
const KEY = 'site-enhancer:x-subtitle-video-position';
const TTL = 2 * 60_000;

function target(url: string) {
  if (!URL.canParse(url, window.location.href)) return;
  const parsed = new URL(url, window.location.href);
  if (parsed.origin !== window.location.origin) return;
  const match = /^\/(?:[\w]+|i\/web)\/status\/(\d+)(?:\/video\/(\d+))?\/?$/.exec(parsed.pathname);
  if (match) return { post: match[1], attachment: match[2] };
}

export function saveVideoPosition(url: string, time: number) {
  try {
    if (target(url) && Number.isFinite(time) && time >= 0) {
      window.sessionStorage.setItem(KEY, JSON.stringify({ url, time, expires: Date.now() + TTL }));
    }
  } catch { /* The subtitle navigation still works if storage is disabled. */ }
}

export function restoreVideoPosition(videoUrl: (video: HTMLVideoElement) => string | undefined) {
  let raw: string | null;
  let saved: { url: string; time: number; expires: number };
  try {
    raw = window.sessionStorage.getItem(KEY);
    if (!raw) return;
    saved = JSON.parse(raw);
    if (!saved || typeof saved.url !== 'string' || !Number.isFinite(saved.time) || saved.time < 0 ||
      !Number.isFinite(saved.expires) || saved.expires <= Date.now()) {
      window.sessionStorage.removeItem(KEY);
      return;
    }
  } catch { return; }

  const wanted = target(saved.url);
  function onDestination() {
    const page = target(window.location.href);
    return wanted && page?.post === wanted.post &&
      (!page.attachment || page.attachment === (wanted.attachment ?? '1'));
  }
  if (!wanted || !onDestination()) return;
  const attachment = wanted.attachment ?? '1';
  const matches = (video: HTMLVideoElement) => {
    const url = videoUrl(video);
    const item = url && target(url);
    if (item) return item.post === wanted.post && (item.attachment ?? '1') === attachment;
    // X can also mount the explicitly addressed attachment in its media dialog.
    return !video.closest('article') && !!video.closest('[role="dialog"],dialog') &&
      target(window.location.href)?.attachment === attachment;
  };
  // Only the destination with a pending seek observes hydration. Metadata and
  // post permalinks can arrive in either order.
  const observer = new MutationObserver(check);
  const timer = window.setTimeout(clear, saved.expires - Date.now());
  function stop() {
    window.clearTimeout(timer);
    observer.disconnect();
    document.removeEventListener('loadedmetadata', check, true);
    document.removeEventListener('canplay', check, true);
  }
  function clear() {
    stop();
    try {
      if (window.sessionStorage.getItem(KEY) === raw) window.sessionStorage.removeItem(KEY);
    } catch { /* Optional storage. */ }
  }
  function check() {
    if (Date.now() >= saved.expires || !onDestination()) return clear();
    // On /video/N the visible dialog can have its own copy of the inline video.
    const dialog = document.querySelector('[role="dialog"]:has(video),dialog[open]:has(video)');
    for (const video of (dialog ?? document).querySelectorAll('video')) {
      if (video.readyState < 1 || !matches(video)) continue;
      try { video.currentTime = Math.min(saved.time, Number.isFinite(video.duration) ? video.duration : saved.time); }
      catch { continue; }
      clear();
      return;
    }
  }
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-href'],
  });
  document.addEventListener('loadedmetadata', check, true);
  document.addEventListener('canplay', check, true);
  check();
  return stop;
}
