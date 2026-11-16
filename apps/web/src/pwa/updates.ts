import { registerSW } from 'virtual:pwa-register';
import { flushCurrentProject } from '../persistence/projects';
import { usePwaStore } from '../stores/pwaStore';
import { useUiStore } from '../stores/uiStore';
import { watchInstallPrompt } from './install';

/** How often an open workspace asks whether a newer build was deployed. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * How long the kernel waits for the worker on a first visit. The shell is a few
 * megabytes, so the claim normally lands in well under a second; the cap keeps
 * a broken or blocked worker from holding the model back.
 */
const CONTROL_TIMEOUT_MS = 3000;

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

let updateServiceWorker: UpdateServiceWorker | null = null;
let started = false;

/**
 * Resolves once the worker controls this page, so the kernel binary the app is
 * about to fetch ends up in the offline cache. Only the first visit starts
 * uncontrolled; every later one is served by the worker from the start.
 */
export function whenOfflineCacheReady(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return Promise.resolve();
  if (navigator.serviceWorker.controller) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, CONTROL_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener('controllerchange', finish);
  });
}

/**
 * Wires the install offer, the offline cache and the update prompt. The worker
 * is only registered in a production build: the dev server rewrites modules on
 * every keystroke, and a cache in front of it would serve yesterday's code.
 */
export function startPwa(): void {
  watchInstallPrompt();
  if (started || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  started = true;

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      usePwaStore.getState().setUpdateReady(true);
      useUiStore.getState().showToast('pwa.updateReady', 'info', undefined, {
        key: 'pwa.reload',
        onSelect: () => void applyUpdate(),
      });
    },
    onOfflineReady() {
      useUiStore.getState().showToast('pwa.offlineReady');
    },
    onRegisteredSW(_url, registration) {
      // A modeling session can outlive a deployment, so the tab must not wait
      // for its next start to notice one. An offline check just fails quietly.
      if (registration) {
        window.setInterval(
          () => void registration.update().catch(() => undefined),
          UPDATE_CHECK_MS,
        );
      }
    },
  });
}

/**
 * Saves the open project before the new worker takes over: the reload discards
 * the page, and the autosave debounce may still hold the last edit.
 */
export async function applyUpdate(): Promise<void> {
  await flushCurrentProject().catch(() => undefined);
  await updateServiceWorker?.(true);
}
