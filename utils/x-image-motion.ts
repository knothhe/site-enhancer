/** A clipped compositor layer. Move decoded nodes, rather than copying pixels or rebuilding images. */
export function createImageMotion(viewport: HTMLElement, stage: HTMLElement, canvas: HTMLElement) {
  type Motion = {
    from: HTMLImageElement; to?: HTMLImageElement; fromStyle: string; toStyle?: string;
    layer: HTMLElement; outgoing: HTMLElement; incoming: HTMLElement;
    direction: number; width: number; offset: number; animations: Animation[]; done?: () => void;
  };
  let motion: Motion | undefined;
  const enabled = () => typeof stage.animate === 'function' && !stage.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cancel(complete = false) {
    const previous = motion;
    if (!previous) return;
    motion = undefined;
    previous.animations.forEach(animation => animation.cancel());
    previous.from.style.cssText = previous.fromStyle;
    previous.from.hidden = false;
    canvas.replaceChildren(previous.from);
    if (previous.to) {
      previous.to.style.cssText = previous.toStyle ?? '';
      previous.to.hidden = true;
      previous.to.remove();
    }
    previous.layer.remove();
    if (complete) previous.done?.();
  }
  function begin(from: HTMLImageElement, to: HTMLImageElement | undefined, direction: number) {
    if (motion?.from === from && motion.to === to && motion.direction === direction) return motion;
    cancel();
    if (!enabled() || from === to) return;
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    const stageRect = stage.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const doc = stage.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'se-image-motion';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = `left:${stage.offsetLeft}px;top:${stage.offsetTop}px;width:${width}px;height:${height}px`;
    const outgoing = doc.createElement('div'), incoming = doc.createElement('div');
    outgoing.className = incoming.className = 'se-image-slide';
    motion = { from, to, fromStyle: from.style.cssText, toStyle: to?.style.cssText, layer, outgoing, incoming, direction, width, offset: 0, animations: [] };
    from.style.position = 'absolute';
    from.style.left = `${fromRect.left - stageRect.left}px`;
    from.style.top = `${fromRect.top - stageRect.top}px`;
    outgoing.append(from);
    if (to) {
      const fit = Math.min(1, width / to.naturalWidth, height / to.naturalHeight);
      const w = to.naturalWidth * fit, h = to.naturalHeight * fit;
      to.style.cssText = `position:absolute;width:${w}px;height:${h}px;left:${(width - w) / 2}px;top:${(height - h) / 2}px`;
      to.hidden = false;
      incoming.append(to);
    }
    layer.append(outgoing, incoming); viewport.append(layer);
    paint(motion, 0);
    return motion;
  }
  function paint(value: Motion, offset: number) {
    value.offset = offset;
    value.outgoing.style.transform = `translate3d(${offset}px,0,0)`;
    value.incoming.style.transform = `translate3d(${offset + value.direction * (value.width + 24)}px,0,0)`;
  }
  function settle(offset: number, done?: () => void) {
    const value = motion;
    if (!value) { done?.(); return; }
    value.done = done;
    if (!enabled()) { cancel(true); return; }
    const remaining = Math.abs(offset - value.offset) / (value.width + 24);
    const duration = offset === 0 ? 140 : Math.max(120, Math.min(240, remaining * 240));
    const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' };
    const animate = (node: HTMLElement, from: number, to: number) => node.animate([
      { transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` },
    ], options);
    value.animations = [animate(value.outgoing, value.offset, offset), animate(value.incoming, value.offset + value.direction * (value.width + 24), offset + value.direction * (value.width + 24))];
    void Promise.all(value.animations.map(animation => animation.finished)).then(() => {
      if (motion === value) cancel(true);
    }).catch(() => { /* Superseded by navigation, resize or closing. */ });
  }
  return {
    get active() { return !!motion; },
    get settling() { return !!motion?.animations.length; },
    follow(from: HTMLImageElement, to: HTMLImageElement | undefined, direction: number, distance: number) {
      const value = begin(from, to, direction);
      if (!value) return;
      // Resistance at gallery boundaries and while the neighboring image is not decoded yet.
      const limit = to ? value.width * .9 : 80;
      paint(value, Math.max(-limit, Math.min(limit, -distance * (to ? 1 : .2))));
    },
    transition(from: HTMLImageElement, to: HTMLImageElement, direction: number, done: () => void) {
      const value = begin(from, to, direction);
      if (!value) { done(); return; }
      settle(-direction * (value.width + 24), done);
    },
    rebound(done?: () => void) { settle(0, done); },
    cancel,
  };
}
