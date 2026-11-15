// The browser owns install eligibility; never advertise an unavailable action.
const button = document.querySelector('#install');
let deferredPrompt = null;
const standalone = matchMedia('(display-mode: standalone)');
const sync = () => { button.hidden = !deferredPrompt || standalone.matches || navigator.standalone === true; };
sync();
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;
  sync();
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; sync(); });
standalone.addEventListener('change', sync);
button.onclick = async () => {
  const available = deferredPrompt;
  deferredPrompt = null;
  sync();
  if (!available) return;
  button.disabled = true;
  try { await available.prompt(); await available.userChoice; }
  catch { /* A consumed prompt cannot be reused; wait for a new browser event. */ }
  finally { button.disabled = false; sync(); }
};
