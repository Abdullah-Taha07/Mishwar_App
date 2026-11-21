/* Small, interruptible feedback. This module never submits or retries an action. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map(), scrollPositions = new Map();
  let lastStage = typeof state === 'object' ? state.stage : null;
  let lastTier = typeof state === 'object' ? state.tier : null;
  let modalKey = null, routeKey = null, tripKey = null, tripSequence = 0;
  const owner = () => window.MishwarAccountContext?.snapshot().accountKey || 'guest';
  let scrollOwner = owner();
  function verifyScrollOwner() {
    const current = owner();
    if (current !== scrollOwner) { scrollPositions.clear(); modalKey = null; scrollOwner = current; return true; }
    return false;
  }
  const motionReduced = () => preference.matches || document.body?.classList?.contains('no-animation') === true;
  const visible = () => !document.hidden && !motionReduced();
  function cancel(element) {
    const animation = animations.get(element);
    if (!animation) return;
    animations.delete(element);
    try { animation.cancel(); } catch { /* Optional feedback is already detached. */ }
  }
  function animate(element, frames, duration = 180) {
    if (!visible() || !element?.isConnected || typeof element.animate !== 'function') return;
    try {
      // Rapid input replaces its previous effect; detached screens retain no effects.
      for (const node of animations.keys()) if (!node.isConnected) cancel(node);
      cancel(element);
      if (animations.size >= 12) cancel(animations.keys().next().value);
      const animation = element.animate(frames, {duration, easing: 'cubic-bezier(.2,.75,.25,1)'});
      animations.set(element, animation);
      const remove = () => { if (animations.get(element) === animation) animations.delete(element); };
      if (animation.finished?.then) animation.finished.then(remove, remove);
      else animation.onfinish = remove;
    } catch { /* Optional feedback cannot interrupt booking or navigation. */ }
  }
  function stop() { tripSequence++; for (const node of animations.keys()) cancel(node); }
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
      const tier = typeof state === 'object' ? state.tier : null;
      restore('panel:' + stage, document.querySelector('.panel-content'));
      if (stage !== priorStage) {
        animate(document.querySelector('#panel'), [{opacity: .65, transform: 'translateY(8px)'}, {opacity: 1, transform: 'translateY(0)'}], 220);
        lastStage = stage;
      } else if (!changedOwner && stage === 'select' && tier !== lastTier) {
        animate(document.querySelector('.ride-category.selected'), [{opacity: .75, transform: 'translateY(3px)'}, {opacity: 1, transform: 'translateY(0)'}], 170);
      }
      lastTier = tier;
      return result;
    };
  }
  if (typeof modal === 'function') {
    const modalBeforeMotion = modal;
    modal = function (title, ...args) {
      const changedOwner = verifyScrollOwner();
      const wasOpen = document.querySelector('#modal')?.open === true;
      const previousKey = modalKey;
      if (!changedOwner) remember(modalKey, document.querySelector('#modal .dialog-body'));
      const result = modalBeforeMotion.call(this, title, ...args);
      modalKey = 'modal:' + String(title);
      restore(modalKey, document.querySelector('#modal .dialog-body'));
      if (!wasOpen || previousKey !== modalKey) animate(document.querySelector('#modal .dialog-body'), [{opacity: .55, transform: 'translateY(5px)'}, {opacity: 1, transform: 'translateY(0)'}], 180);
      return result;
    };
    document.querySelector('#modal')?.addEventListener('close', () => { const body = document.querySelector('#modal .dialog-body'); remember(modalKey, body); cancel(body); });
  }
  if (typeof openDrawer === 'function') {
    const openBeforeMotion = openDrawer;
    openDrawer = function (...args) {
      const drawer = document.querySelector('#drawer'), wasOpen = drawer?.open === true;
      const result = openBeforeMotion.apply(this, args);
      if (!wasOpen && drawer?.open) animate(document.querySelector('#drawer-content'), [{opacity: .5, transform: 'translateY(5px)'}, {opacity: 1, transform: 'translateY(0)'}], 180);
      return result;
    };
    document.querySelector('#drawer')?.addEventListener('close', () => cancel(document.querySelector('#drawer-content')));
  }
  if (typeof window.drawMishwarRoute === 'function') {
    const drawBeforeMotion = window.drawMishwarRoute;
    window.drawMishwarRoute = function (route) {
      const result = drawBeforeMotion.call(this, route);
      const points = route?.geometry?.coordinates;
      const key = points?.length ? JSON.stringify(points) : null;
      if (key && key !== routeKey && visible()) {
        const path = document.querySelector('#live-map .leaflet-overlay-pane path');
        // Fade the real measured route without measuring/painting its stroke each frame.
        animate(path, [{opacity: .25}, {opacity: 1}], 260);
      }
      routeKey = key;
      return result;
    };
  }
  window.addEventListener('mishwar-trip-updated', event => {
    const trip = event.detail;
    if (!trip?.id || !['matching','arriving','arrived','riding','completed','cancelled'].includes(trip.status)) return;
    const key = trip.id + ':' + trip.status, previousKey = tripKey;
    tripKey = key;
    // Stage changes already animate the panel. GPS/ETA-only polls stay still.
    if (key === previousKey) return;
    const sequence = ++tripSequence, account = owner();
    if ((!previousKey && trip.status !== 'matching') || typeof state !== 'object' || state.stage !== lastStage) return;
    Promise.resolve().then(() => {
      if (sequence !== tripSequence || account !== owner()) return;
      animate(document.querySelector('.live-trip h2'), [{opacity: .45, transform: 'translateY(4px)'}, {opacity: 1, transform: 'translateY(0)'}], 180);
    });
  });
  const reduceChanged = () => { if (motionReduced()) stop(); };
  if (preference.addEventListener) preference.addEventListener('change', reduceChanged);
  else preference.addListener?.(reduceChanged);
  window.addEventListener('pagehide', stop);
  window.addEventListener('mishwar-motion-changed', reduceChanged);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('mishwar-account-reset', () => { stop(); scrollPositions.clear(); modalKey = null; routeKey = null; tripKey = null; lastStage = typeof state === 'object' ? state.stage : null; lastTier = typeof state === 'object' ? state.tier : null; });
})();
