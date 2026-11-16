import { usePwaStore } from '../stores/pwaStore';
import { useUiStore } from '../stores/uiStore';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let watching = false;

/** Whether the page already runs in its own window rather than in a tab. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const overlay = window.matchMedia?.('(display-mode: window-controls-overlay)').matches === true;
  // iOS marks the home-screen window on the navigator instead of the display mode.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || overlay || iosStandalone;
}

/**
 * Keeps the browser's install offer. It arrives before the user asks for
 * anything, and a prompt that is dropped cannot be shown again.
 */
export function watchInstallPrompt(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  usePwaStore.getState().setInstalled(isInstalledApp());

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    usePwaStore.getState().setInstalled(true);
    useUiStore.getState().showToast('pwa.installed');
  });
}

/** Shows the browser install prompt; `null` means the browser has none to show. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const event = deferredPrompt;
  if (!event) return null;
  deferredPrompt = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    // A dismissed browser prompt can reject; the menu then explains the
    // manual route instead of leaving an unhandled rejection behind.
    return null;
  }
}
