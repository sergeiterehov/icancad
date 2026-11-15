/**
 * What the pointer is.
 *
 * A browser cannot tell a trackpad from a mouse by asking: both are a fine
 * pointer with a wheel. Two things still give it away. The media query says
 * whether the primary pointer is a finger, which is what a tablet or a phone
 * reports. And the wheel events themselves say which device sent them: a
 * trackpad scrolls smoothly and in fractions, often sideways, and a pinch
 * arrives as a wheel with Ctrl held, while a mouse wheel comes in whole notches
 * on one axis.
 *
 * The camera therefore works with three profiles — a mouse, a trackpad and a
 * finger — and the user can pin any of them, because hybrids (a touch laptop, a
 * tablet with a keyboard) report whichever input was used first.
 */

export type InputProfile = 'pointer' | 'touch';
export type PointerKind = 'mouse' | 'trackpad';
export type InputPreference = 'auto' | PointerKind | InputProfile;

export const INPUT_PREFERENCES: readonly InputPreference[] = ['auto', 'mouse', 'trackpad', 'touch'];

export const DEFAULT_INPUT_PREFERENCE: InputPreference = 'auto';

export function isInputPreference(value: string | null | undefined): value is InputPreference {
  return INPUT_PREFERENCES.some((candidate) => candidate === value);
}

/** What a wheel event looks like; a `WheelEvent` satisfies it. */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

/**
 * The device behind a wheel event, when the event says it clearly, or null when
 * it does not. A pinch is always a trackpad: no mouse sends Ctrl with its wheel.
 */
export function wheelPointerKind(event: WheelSample): PointerKind | null {
  if (event.ctrlKey) return 'trackpad';
  // Lines and pages come from a notched wheel; a trackpad scrolls in pixels.
  if (event.deltaMode !== 0) return 'mouse';
  const notch = Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 50;
  if (notch && Math.abs(event.deltaX) < 1) return 'mouse';
  if (Math.abs(event.deltaX) >= 1 || !Number.isInteger(event.deltaY)) return 'trackpad';
  return null;
}

/**
 * The pointer a platform is likely to have built in. Apple laptops and tablets
 * come with a trackpad; everything else is assumed to be a mouse until the
 * wheel says otherwise.
 */
export function likelyPointerKind(platform: string): PointerKind {
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'trackpad' : 'mouse';
}

/** What the browser says about the primary pointer. */
export function detectInputProfile(): InputProfile {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'pointer';
  return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer';
}

let detected: InputProfile | null = null;
let watching = false;

/** Re-read the media query when the primary input changes, as a tablet does. */
function watchInputProfile(): void {
  if (watching || typeof window === 'undefined') return;
  if (typeof window.matchMedia !== 'function') return;
  watching = true;
  window.matchMedia('(pointer: coarse)').addEventListener?.('change', () => {
    detected = null;
  });
}

export function primaryInputProfile(): InputProfile {
  watchInputProfile();
  if (detected === null) detected = detectInputProfile();
  return detected;
}

/** The pointer the platform was built with, used until a wheel says otherwise. */
export function primaryPointerKind(): PointerKind {
  if (typeof navigator === 'undefined') return 'mouse';
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = agent.userAgentData?.platform ?? navigator.platform ?? '';
  return likelyPointerKind(platform);
}

let lastWheelKind: PointerKind | null = null;

/** Remembers what the last wheel event showed, so a device switch is noticed. */
export function noteWheelKind(kind: PointerKind | null): void {
  if (kind) lastWheelKind = kind;
}

/**
 * The pointer the camera should follow now. A pinned preference wins; "auto"
 * follows the last wheel event and falls back to the platform it runs on.
 */
export function resolvedPointerKind(preference: InputPreference): PointerKind {
  if (preference === 'mouse' || preference === 'trackpad') return preference;
  if (lastWheelKind) return lastWheelKind;
  // A finger-first device that also got a mouse is more likely a mouse here.
  if (preference === 'touch') return 'mouse';
  return primaryPointerKind();
}

/** The profile the camera should follow now. */
export function inputProfile(preference: InputPreference): InputProfile {
  if (preference === 'pointer' || preference === 'touch') return preference;
  if (preference === 'mouse' || preference === 'trackpad') return 'pointer';
  return primaryInputProfile();
}
