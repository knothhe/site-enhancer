import { resolveLocale } from './i18n.ts';
import type { installXVideoPlayback } from './x-video-playback.ts';

export const SPEED_CSS = `
.se-speed{position:absolute;top:10px;left:10px;z-index:12;font:600 13px system-ui;font-variant-numeric:tabular-nums;color:white}
.se-speed button{border:0;border-radius:12px;padding:5px 8px;background:#252b32;color:inherit;cursor:pointer;font:inherit}
.se-speed [data-site-enhancer-video-speed]{display:inline-flex;align-items:center;gap:5px;border-radius:20px;opacity:0}
:hover>.se-speed button,:focus-within>.se-speed button,.se-speed:focus-within button{opacity:1}
.se-speed [data-site-enhancer-video-speed][data-changed],.se-speed button[aria-checked=true]{background:var(--se-x-accent,#1d9bf0);opacity:1}
.se-speed [data-site-enhancer-video-popover]{position:absolute;top:calc(100% + 4px);background:#20252c;z-index:1;border-radius:12px;padding:6px;box-shadow:0 4px 14px #0007;text-align:center}
.se-speed [role=radiogroup]{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}
.se-speed [role=radiogroup] button{width:100%;height:32px;padding:0;border-radius:8px}
.se-speed .se-speed-steps{display:flex;align-items:center;justify-content:center;border-top:1px solid #fff3;margin-top:6px;padding-top:6px}
.se-speed svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.se-video-bar .se-speed{position:relative;inset:auto;margin-left:auto}
.se-video-bar .se-speed [data-site-enhancer-video-speed]{opacity:1;width:auto;height:40px;padding:0 10px}
.se-video-bar .se-speed [data-site-enhancer-video-speed] svg{width:14px;height:14px}
.se-video-bar [data-site-enhancer-video-popover]{top:auto;bottom:calc(100% + 4px)}

.se-speed output{padding:0 10px}
[data-site-enhancer-video-hud]{pointer-events:none;position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);background:#111b;color:white;padding:8px 16px;border-radius:24px;z-index:11;font:600 18px system-ui}

`;

export function createSpeedControl(player: HTMLElement, playback: ReturnType<typeof installXVideoPlayback>) {
  const doc = player.ownerDocument, view = doc.defaultView!;
  const zh = resolveLocale(doc.documentElement.lang || view.navigator.language) === 'zh';
  const label = zh ? '播放倍速' : 'Playback speed';
  const root = doc.createElement('div'); root.className = 'se-speed';
  const button = (title: string) => {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = title; return b;
  };
  const pill = button('');
  pill.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18a10 10 0 1 1 18 0zM12 14l5-6"/></svg>';
  const rateLabel = doc.createElement('span');
  pill.append(rateLabel);
  pill.setAttribute('data-site-enhancer-video-speed','');
  pill.setAttribute('aria-expanded','false');
  const panel = doc.createElement('div'); panel.setAttribute('data-site-enhancer-video-popover',''); panel.hidden = true;
  const presets = doc.createElement('div'); presets.setAttribute('role','radiogroup'); presets.setAttribute('aria-label',label);
  const output = doc.createElement('output');
  const down = button('−'), up = button('+');
  const hud = doc.createElement('span'); hud.setAttribute('data-site-enhancer-video-hud',''); hud.hidden = true;
  let timer = 0, holdTimer = 0, suppressClick = false;
  let held: HTMLVideoElement | undefined;
  const video = () => player.querySelector('video');
  function sync() {
    const rate = video()?.playbackRate || 1;
    output.textContent = rate + '×';
    rateLabel.textContent = output.textContent;
    pill.title = label + ' · ' + output.textContent;
    pill.setAttribute('aria-label',pill.title); pill.toggleAttribute('data-changed', rate !== 1);
    for (const b of presets.querySelectorAll('button')) b.setAttribute('aria-checked',String(Number(b.value) === rate));
  }
  function feedback() {
    sync(); hud.textContent = output.textContent; hud.hidden = false;
    hud.animate?.([{ opacity:1,offset:0 },{opacity:1,offset:.65},{opacity:0}],600);
    view.clearTimeout(timer); timer = view.setTimeout(() => { hud.hidden = true; },600);
  }
  function set(value: number) { const v = video(); if (v) { playback.setRate(v,value); feedback(); } }
  function step(delta: number) { set(playback.rate() + delta); }
  function hold(active: boolean) {
    view.clearTimeout(holdTimer);
    const target = active ? video() : held;
    if (!target || Boolean(held) === active) return;
    held = active ? target : undefined;
    playback.holdRate(target, active);
    feedback();
  }
  function close(focus = false) {
    boundsObserver.disconnect();
    panel.hidden = true; pill.setAttribute('aria-expanded','false');
    view.removeEventListener('click',outside,true);
    view.removeEventListener('keydown',keys,true);
    if (focus) pill.focus({preventScroll:true});
  }
  function outside(e: MouseEvent) { if (!root.contains(e.target as Node)) { e.preventDefault(); e.stopImmediatePropagation(); close(); } }
  function keys(e: KeyboardEvent) {
    if (panel.hidden) return false;
    const all = [...presets.querySelectorAll('button')];
    const i = all.indexOf(doc.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') close(true);
    else if (['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(e.key)) {
      const delta = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-4, ArrowDown:4 }[e.key]!;
      all[(i + delta + all.length) % all.length].focus();
    } else if (e.key === 'Enter' && i >= 0) all[i].click();
    else return false;
    e.preventDefault(); e.stopImmediatePropagation(); return true;
  }
  for (const rate of [.5,.75,1,1.25,1.5,1.75,2,3]) {
    const b = button(String(rate)); b.value = String(rate); b.setAttribute('role','radio');
    b.onclick = () => { set(rate); close(true); }; presets.append(b);
  }
  down.setAttribute('aria-label',zh ? '减慢 0.25×' : 'Decrease speed by 0.25×');
  up.setAttribute('aria-label',zh ? '加快 0.25×' : 'Increase speed by 0.25×');
  down.onclick = () => step(-.25); up.onclick = () => step(.25);
  function positionPanel() {
    const bounds = player.getBoundingClientRect(), anchor = root.getBoundingClientRect();
    const width = Math.min(232, Math.max(0, bounds.width - 16));
    const edge = root.closest('.se-video-bar') ? anchor.right - width : anchor.left;
    panel.style.boxSizing = 'border-box';
    panel.style.width = width + 'px';
    panel.style.left = Math.max(bounds.left + 8, Math.min(edge, bounds.right - 8 - width)) - anchor.left + 'px';
  }
  const boundsObserver = new view.ResizeObserver(positionPanel);
  pill.onclick = () => {
    if (suppressClick) { suppressClick = false; return; }
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; pill.setAttribute('aria-expanded','true'); sync();
    positionPanel();
    boundsObserver.observe(player);
    (presets.querySelector<HTMLButtonElement>('[aria-checked=true]') ?? presets.querySelector('button'))?.focus();
    view.addEventListener('click',outside,true); view.addEventListener('keydown',keys,true);
  };
  pill.onwheel = e => { e.preventDefault(); e.stopPropagation(); if (e.deltaY) step(e.deltaY < 0 ? .25 : -.25); };
  pill.onpointerdown = e => {
    if (e.button !== 0) return;
    suppressClick = false; pill.setPointerCapture?.(e.pointerId);
    holdTimer = view.setTimeout(() => { suppressClick = true; hold(true); },400);
  };
  const release = () => hold(false);
  pill.onpointerup = pill.onpointercancel = pill.onlostpointercapture = release;
  view.addEventListener('blur',release);
  player.addEventListener('ratechange',sync,true);
  root.addEventListener('click', e => e.stopPropagation());
  const steps = doc.createElement('div'); steps.className = 'se-speed-steps';
  steps.append(down,output,up); panel.append(presets,steps); root.append(pill,panel); player.append(root,hud); sync();
  return { root, step, hold, keys, close, sync, remove() {
    close(); release(); view.clearTimeout(timer);
    view.removeEventListener('blur',release); player.removeEventListener('ratechange',sync,true);
    root.remove(); hud.remove();
  } };
}
export type SpeedControl = ReturnType<typeof createSpeedControl>;
