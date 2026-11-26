import type { SketchClipboardPayload } from '@icancad/model';
import { clipboardText, parseClipboardText } from './payload';

/**
 * Where this browser keeps its own last copy. The system clipboard is the one
 * that travels (ADR 0059); this is the copy a paste can still read when the
 * browser refuses to hand the system clipboard over, which is the common case
 * without a permission prompt the user has to answer.
 */
const STORAGE_KEY = 'icancad.clipboard.sketch';

/**
 * How long a paste waits for the system clipboard. `readText` can sit on a
 * permission the browser never asks about; a paste that waits forever reads as
 * a shortcut that does nothing.
 */
export const CLIPBOARD_READ_TIMEOUT_MS = 800;

function rememberLocal(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Storage can be unavailable in private mode.
  }
}

function localClipboard(): SketchClipboardPayload | null {
  try {
    return parseClipboardText(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function systemClipboard(): Clipboard | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.clipboard ?? null;
}

/**
 * Copies geometry: the plain JSON text goes to the system clipboard so another
 * tab, another browser or another machine can paste it, and to the local copy
 * so this browser can paste without being asked for a permission.
 */
export async function writeSketchClipboard(payload: SketchClipboardPayload): Promise<void> {
  const text = clipboardText(payload);
  rememberLocal(text);
  const clipboard = systemClipboard();
  if (!clipboard?.writeText) return;
  try {
    await clipboard.writeText(text);
  } catch {
    // A refused write leaves the local copy, which is enough for this browser.
  }
}

async function readSystemClipboard(): Promise<string | null> {
  const clipboard = systemClipboard();
  if (!clipboard?.readText) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CLIPBOARD_READ_TIMEOUT_MS);
    });
    return await Promise.race([clipboard.readText().catch(() => null), timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The geometry a paste would place. The system clipboard answers first, so a
 * copy made elsewhere lands here; when it cannot be read at all, or holds
 * nothing, the last copy this browser made stands in.
 */
export async function readSketchClipboard(): Promise<SketchClipboardPayload | null> {
  const text = await readSystemClipboard();
  const payload = text ? parseClipboardText(text) : null;
  if (payload) return payload;
  // Text this app did not write is not turned into geometry: a paste takes the
  // local copy only when the system clipboard said nothing.
  if (text) return null;
  return localClipboard();
}
