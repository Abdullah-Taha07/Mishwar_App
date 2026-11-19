/* GPS samples are short-lived measurements; manual pickup points are a separate choice. */
(() => {
  const MAX_AGE = 30000, MAX_ACCURACY = 150, MAX_FUTURE_SKEW = 5000;
  function inspect(sample, now = Date.now()) {
    if (!sample || !Number.isFinite(sample.lat) || !Number.isFinite(sample.lng) ||
        Math.abs(sample.lat) > 90 || Math.abs(sample.lng) > 180) return {ok: false, reason: 'coordinates'};
    if (!Number.isFinite(sample.accuracy) || sample.accuracy <= 0 || sample.accuracy > MAX_ACCURACY) return {ok: false, reason: 'accuracy'};
    if (!Number.isFinite(now) || !Number.isFinite(sample.observedAt)) return {ok: false, reason: 'timestamp'};
    if (sample.observedAt > now + MAX_FUTURE_SKEW) return {ok: false, reason: 'future'};
    if (now - sample.observedAt > MAX_AGE) return {ok: false, reason: 'stale'};
    return {ok: true, reason: null};
  }
  function validatePosition(position, now = Date.now()) {
    const point = {
      lat: position?.coords?.latitude, lng: position?.coords?.longitude,
      accuracy: position?.coords?.accuracy, observedAt: position?.timestamp, source: 'gps',
    };
    const result = inspect(point, now);
    return result.ok ? {...result, point} : result;
  }
  function createTracker(options = {}) {
    const geolocation = options.geolocation;
    const permissions = options.permissions;
    const now = options.now || Date.now;
    const schedule = options.setTimeout || globalThis.setTimeout.bind(globalThis);
    const cancel = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    const onPoint = options.onPoint || (() => {}), onSearch = options.onSearch || (() => {});
    const onStatus = options.onStatus || (() => {}), reverse = options.reverse || (point => point);
    const flag = (value, fallback) => typeof value === 'function' ? value() : value ?? fallback;
    let generation = 0, fixSequence = 0, watch = null, active = false, expiry = null;
    let last = null, latestObservedAt = -Infinity, manualMode = options.manual === true;
    let permissionStatus = null, permissionListener = null;

    function status(state, reason = null) { onStatus(state, reason); }
    function clearTimer() { if (expiry !== null) cancel(expiry); expiry = null; }
    function detachPermission() {
      if (permissionStatus && permissionListener) {
        if (typeof permissionStatus.removeEventListener === 'function') permissionStatus.removeEventListener('change', permissionListener);
        else if (permissionStatus.onchange === permissionListener) permissionStatus.onchange = null;
      }
      permissionListener = null;
    }
    function clearWatch(id) {
      if (id === null || id === undefined) return;
      try { geolocation?.clearWatch?.(id); } catch {}
    }
    function invalidate() {
      generation++; fixSequence++; active = false;
      const previousWatch = watch; watch = null; clearWatch(previousWatch);
      detachPermission(); clearTimer(); last = null; latestObservedAt = -Infinity;
      onSearch(null);
    }
    function halt(state, reason = null) { invalidate(); status(state, reason); }
    function current() {
      if (!last) return null;
      const checked = inspect(last, now());
      if (!checked.ok) {
        fixSequence++; clearTimer(); last = null; onSearch(null); status('stale', checked.reason);
        return null;
      }
      return {...last};
    }
    function armExpiry(epoch, point) {
      clearTimer();
      expiry = schedule(() => {
        expiry = null;
        if (epoch !== generation || !last || last.observedAt !== point.observedAt) return;
        if (inspect(last, now()).ok) { armExpiry(epoch, last); return; }
        fixSequence++; last = null; onSearch(null); status('stale', 'stale');
      }, Math.max(1, point.observedAt + MAX_AGE - now() + 1));
    }
    function allowedToApply() {
      try { return flag(options.canApply, true) === true && flag(options.isVisible, true) === true; }
      catch { return false; }
    }
    async function receive(position, epoch, explicit) {
      if (epoch !== generation || !active || !flag(options.isVisible, true)) return;
      const checked = validatePosition(position, now());
      if (!checked.ok) { status(checked.reason === 'stale' ? 'stale' : 'invalid', checked.reason); return; }
      const point = checked.point;
      if (typeof options.acceptsPoint === 'function') {
        let accepted = false;
        try { accepted = options.acceptsPoint({...point}) === true; } catch {}
        if (!accepted) { status('invalid', 'service-area'); return; }
      }
      if (point.observedAt <= latestObservedAt) return;
      if (manualMode && !explicit) return;
      latestObservedAt = point.observedAt;
      const sequence = ++fixSequence;
      last = {...point}; onSearch({...point}); armExpiry(epoch, point);
      let named;
      try { named = await reverse({...point}); }
      catch { named = {resolved: false}; }
      if (epoch !== generation || sequence !== fixSequence || !active || !allowedToApply()) return;
      const fresh = inspect(point, now());
      if (!fresh.ok) { current(); return; }
      if (manualMode && !explicit) return;
      // A geocoder supplies labels, never a replacement measurement or timestamp.
      const applied = {...(named && typeof named === 'object' ? named : {}), ...point};
      manualMode = false; onPoint(applied); status('live');
    }
    function geoError(error, epoch) {
      if (epoch !== generation || !active) return;
      if (error?.code === 1) halt('denied', 'permission');
      else if (error?.code === 3) halt('timeout', 'timeout');
      else halt('unavailable', 'unavailable');
    }
    function observePermission(epoch) {
      if (typeof permissions?.query !== 'function') return;
      let query;
      try { query = permissions.query({name: 'geolocation'}); } catch { return; }
      Promise.resolve(query).then(value => {
        if (epoch !== generation || !active || !value) return;
        detachPermission(); permissionStatus = value;
        if (value.state === 'denied') { halt('denied', 'permission'); return; }
        permissionListener = () => {
          if (epoch === generation && active && value.state === 'denied') halt('denied', 'permission');
        };
        if (typeof value.addEventListener === 'function') value.addEventListener('change', permissionListener);
        else value.onchange = permissionListener;
      }).catch(() => {});
    }
    function start({explicit = false} = {}) {
      if (!flag(options.isSecure, globalThis.isSecureContext !== false)) { halt('insecure', 'secure-context'); return false; }
      if (!geolocation || typeof geolocation.watchPosition !== 'function') { halt('unsupported', 'geolocation'); return false; }
      if (!flag(options.isVisible, true)) { halt(manualMode ? 'manual' : 'stopped', 'hidden'); return false; }
      // A detached PermissionStatus may be an old snapshot on some browsers.
      // An explicit retry re-queries it while the browser enforces the actual permission.
      if (permissionStatus?.state === 'denied' && !explicit) { halt('denied', 'permission'); return false; }
      if (manualMode && !explicit) { status('manual'); return false; }
      if (active) return true;
      const epoch = ++generation;
      active = true; status('pending');
      try {
        // active is set before registration: even a synchronous callback cannot create a second watch.
        const id = geolocation.watchPosition(
          position => { void receive(position, epoch, explicit); },
          error => geoError(error, epoch),
          {enableHighAccuracy: true, timeout: 15000, maximumAge: 0},
        );
        if (epoch !== generation || !active) { clearWatch(id); return false; }
        watch = id;
      } catch (error) {
        if (epoch === generation) geoError(error, epoch);
        return false;
      }
      observePermission(epoch);
      return true;
    }
    return {
      start,
      stop({clear = false} = {}) { if (clear) manualMode = false; halt('stopped'); },
      manual() { manualMode = true; halt('manual'); },
      reset() { manualMode = false; halt('stopped', 'reset'); permissionStatus = null; },
      current,
    };
  }
  window.MishwarLocation = Object.freeze({inspect, validatePosition, createTracker, maxAge: MAX_AGE, maxAccuracy: MAX_ACCURACY});
})();
