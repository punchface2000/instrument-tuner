// Offline support: registers the service worker and reports when the app has
// been saved for offline use or when a newer version is waiting.

export interface PwaEvents {
  /** First install finished: the app now works offline. */
  onOfflineReady(): void;
  /** A newer version is downloaded; call `apply` to switch to it (reloads). */
  onUpdateReady(apply: () => void): void;
}

export function registerServiceWorker(events: PwaEvents): void {
  if (!('serviceWorker' in navigator)) return;
  // Service workers need https (or localhost); a file opened from disk has neither.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });

  const offerUpdate = (worker: ServiceWorker) => {
    events.onUpdateReady(() => {
      reloading = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed') return;
          if (navigator.serviceWorker.controller) offerUpdate(worker);
          else {
            // First install: activate straight away so the next launch is offline-capable.
            worker.postMessage({ type: 'SKIP_WAITING' });
            events.onOfflineReady();
          }
        });
      });
      // Look for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    } catch {
      /* offline support unavailable; the app still works online */
    }
  });
}

/** Version of the offline copy in use, if any. */
export async function offlineVersion(): Promise<string | null> {
  const ctrl = navigator.serviceWorker?.controller;
  if (!ctrl) return null;
  return new Promise((resolve) => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === 'VERSION') {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve(String(ev.data.version));
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    ctrl.postMessage({ type: 'GET_VERSION' });
    setTimeout(() => resolve(null), 1500);
  });
}
