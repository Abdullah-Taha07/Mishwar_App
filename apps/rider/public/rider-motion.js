/* Small, interruptible feedback. This module never submits or retries an action. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set(), scrollPositions = new Map();
  let lastStage = typeof state === 'object' ? state.stage : null;
  let modalKey = null, routeKey = null;
  const owner = () => window.MishwarAccountContext?.snapshot().accountKey || 'guest';
  let scrollOwner = owner();
  function verifyScrollOwner() {
    const current = owner();
    if (current !== scrollOwner) { scrollPositions.clear(); modalKey = null; scrollOwner = current; return true; }
    return false;
  }
  const motionReduced = () => preference.matches || document.body?.classList?.contains('no-animation') === true;
  const visible = () => !document.hidden && !motionReduced();
  function animate(element, frames, duration = 180) {
    if (!visible() || !element?.isConnected || typeof element.animate !== 'function') return;
    try {
      const animation = element.animate(frames, {duration, easing: 'cubic-bezier(.2,.75,.25,1)'});
      animations.add(animation);
      const remove = () => animations.delete(animation);
      if (animation.finished?.then) animation.finished.then(remove, remove);
      else animation.onfinish = remove;
    } catch { /* Optional feedback cannot interrupt booking or navigation. */ }
  }
  function stop() { for (const animation of animations) animation.cancel(); animations.clear(); }
  function remember(key, element) {
    if (!key || !element) return;
    scrollPositions.delete(key); scrollPositions.set(key, element.scrollTop);
    if (scrollPositions.size > 24) scrollPositions.delete(scrollPositions.keys().next().value);
  }
  function restore(key, element) {
    if (element && scrollPositions.has(key)) element.scrollTop = scrollPositions.get(key);
  }
  document.addEventListener('pointerup', event => {
    if (event.button !== 0) return;
    const button = event.target.closest?.('button');
    if (!button || button.disabled || button.closest('.sheet-dragging,.ride-sheet-dragging')) return;
    animate(button, [{transform: 'scale(.98)'}, {transform: 'scale(1)'}], 140);
  }, {passive: true});
  document.addEventListener('keydown', event => {
    if (event.repeat || !['Enter', ' '].includes(event.key)) return;
    const button = event.target.closest?.('button');
    if (button && !button.disabled) animate(button, [{opacity: .72}, {opacity: 1}], 140);
  });
  if (typeof render === 'function') {
    const renderBeforeMotion = render;
    render = function (...args) {
      const changedOwner = verifyScrollOwner();
      const priorStage = lastStage;
      if (!changedOwner) remember('panel:' + priorStage, document.querySelector('.panel-content'));
      const result = renderBeforeMotion.apply(this, args);
      const stage = typeof state === 'object' ? state.stage : null;
      restore('panel:' + stage, document.querySelector('.panel-content'));
      if (stage !== priorStage) {
        animate(document.querySelector('#panel'), [{opacity: .65, transform: 'translateY(8px)'}, {opacity: 1, transform: 'translateY(0)'}], 220);
        lastStage = stage;
      }
      return result;
    };
  }
  if (typeof modal === 'function') {
    const modalBeforeMotion = modal;
    modal = function (title, ...args) {
      const changedOwner = verifyScrollOwner();
      if (!changedOwner) remember(modalKey, document.querySelector('#modal .dialog-body'));
      const result = modalBeforeMotion.call(this, title, ...args);
      modalKey = 'modal:' + String(title);
      restore(modalKey, document.querySelector('#modal .dialog-body'));
      return result;
    };
    document.querySelector('#modal')?.addEventListener('close', () => remember(modalKey, document.querySelector('#modal .dialog-body')));
  }
  if (typeof window.drawMishwarRoute === 'function') {
    const drawBeforeMotion = window.drawMishwarRoute;
    window.drawMishwarRoute = function (route) {
      const result = drawBeforeMotion.call(this, route);
      const points = route?.geometry?.coordinates;
      const key = points?.length ? JSON.stringify([points.length, points[0], points[points.length - 1], route.calculatedAt]) : null;
      if (key && key !== routeKey && visible()) {
        const path = document.querySelector('#live-map .leaflet-overlay-pane path');
        // Animation reveals only the provider's measured route; no vehicle position is synthesized.
        if (path && typeof path.getTotalLength === 'function') {
          try {
            const length = path.getTotalLength();
            if (Number.isFinite(length) && length > 0) animate(path, [{strokeDasharray: length + ' ' + length, strokeDashoffset: length}, {strokeDasharray: length + ' ' + length, strokeDashoffset: 0}], 320);
          } catch { /* A removed SVG path needs no reveal animation. */ }
        }
      }
      routeKey = key;
      return result;
    };
  }
  const reduceChanged = () => { if (motionReduced()) stop(); };
  if (preference.addEventListener) preference.addEventListener('change', reduceChanged);
  else preference.addListener?.(reduceChanged);
  window.addEventListener('pagehide', stop);
  window.addEventListener('mishwar-motion-changed', reduceChanged);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('mishwar-account-reset', () => { stop(); scrollPositions.clear(); modalKey = null; routeKey = null; lastStage = typeof state === 'object' ? state.stage : null; });
})();
