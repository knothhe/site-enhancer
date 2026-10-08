export function createToast() {
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#0f1419;color:white;padding:12px 24px;border-radius:12px;
    font:600 15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    max-width:calc(100vw - 32px);box-sizing:border-box;z-index:2147483647;
    pointer-events:none;opacity:0;transition:opacity .2s;box-shadow:0 4px 12px #0003;`;
  document.body.appendChild(toast);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(message: string) {
      clearTimeout(timer);
      toast.textContent = message;
      toast.style.opacity = '1';
      timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    },
    remove() {
      clearTimeout(timer);
      toast.remove();
    },
  };
}
