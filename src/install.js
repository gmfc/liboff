/**
 * Home-screen installation.
 *
 * Chromium fires `beforeinstallprompt` and lets us trigger the prompt later
 * from a real button; Safari has no such event and requires the user to go
 * through Share → Add to Home Screen, which the settings view explains.
 */

let deferredPrompt = null;
const listeners = new Set();

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function getInstallPrompt() {
  if (!deferredPrompt) return null;
  return async () => {
    const prompt = deferredPrompt;
    deferredPrompt = null;
    notify();
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    return choice?.outcome === 'accepted';
  };
}

export function onInstallChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

export function watchInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}
