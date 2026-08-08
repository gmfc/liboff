/**
 * Service worker registration, and the answer to "am I running the latest
 * version?"
 *
 * Updates normally arrive on their own: the shell is served from cache and
 * revalidated behind, so a redeployed file reaches the app on the visit after
 * it lands. That is right for the everyday case and useless when you are
 * standing there wanting the new version *now*, which is what `checkNow` is
 * for.
 *
 * The check deliberately does more than `registration.update()`. That call
 * only re-fetches sw.js, and this app has no build step: a deploy that changes
 * a view leaves the worker byte-identical, so `update()` would find nothing
 * and the app would claim to be current while still serving the old files.
 * The worker is therefore asked to re-fetch every precached asset and report
 * how many actually differed.
 */

import { toast } from './ui/toast.js';

let registration = null;
/** Sampled before registering — see below. */
let wasControlled = false;

export function isSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export async function registerServiceWorker() {
  if (!isSupported()) return null;
  // file:// has no service worker scope, and the dev flow uses a real server.
  if (location.protocol === 'file:') return null;
  // Sampled before registering: the worker calls clients.claim(), so by the
  // time it reports "activated" this page already has a controller even on a
  // first visit. Only a page that was *already* controlled is seeing an update.
  wasControlled = Boolean(navigator.serviceWorker.controller);
  try {
    registration = await navigator.serviceWorker.register(
      new URL('../sw.js', import.meta.url),
      { scope: new URL('../', import.meta.url).pathname },
    );
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing || !wasControlled) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'activated') {
          toast('A new version is ready.', {
            duration: 8000,
            action: { label: 'Reload', onClick: () => location.reload() },
          });
        }
      });
    });
    return registration;
  } catch (error) {
    console.warn('liboff: service worker registration failed —', error);
    return null;
  }
}

/** Ask the active worker something and wait for its reply. */
function askWorker(message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) {
      reject(new Error('No service worker is running yet.'));
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('The update check timed out.')), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/**
 * Look for a new version now.
 *
 * @returns {Promise<{state: 'updated'|'current'|'offline'|'unsupported',
 *                    changed?: number, failed?: number, checked?: number}>}
 *          `updated` means a reload will actually show something different.
 */
export async function checkNow() {
  if (!isSupported() || !navigator.serviceWorker.controller) return { state: 'unsupported' };
  if (navigator.onLine === false) return { state: 'offline' };

  // A changed worker still matters — it is how the caching rules themselves
  // are updated — so ask for it first, and let it take over if there is one.
  try {
    const current = registration ?? (await navigator.serviceWorker.getRegistration());
    await current?.update();
  } catch {
    // A failed worker fetch is not fatal: the asset sweep below is the part
    // that decides whether anything actually changed.
  }

  let report;
  try {
    report = await askWorker('refresh-shell');
  } catch (error) {
    return { state: 'offline', error: String(error.message ?? error) };
  }
  if (report?.error) return { state: 'offline', error: report.error };

  // Every asset failing means the network is gone, not that nothing changed.
  if (report.failed >= report.checked) return { state: 'offline' };

  return {
    state: report.changed > 0 ? 'updated' : 'current',
    changed: report.changed,
    failed: report.failed,
    checked: report.checked,
  };
}
