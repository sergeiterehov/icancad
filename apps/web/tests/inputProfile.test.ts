import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUT_PREFERENCE,
  INPUT_PREFERENCES,
  detectInputProfile,
  inputProfile,
  isInputPreference,
  isKeylessPointer,
  isTouchPointer,
  likelyPointerKind,
  noteWheelKind,
  resolvedPointerKind,
  wheelPointerKind,
} from '../src/viewport/inputProfile';

const wheel = (deltaY: number, extra: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean }> = {}) => ({
  deltaX: extra.deltaX ?? 0,
  deltaY,
  deltaMode: extra.deltaMode ?? 0,
  ctrlKey: extra.ctrlKey ?? false,
});

describe('wheel signature', () => {
  it('reads a notch of a mouse wheel', () => {
    expect(wheelPointerKind(wheel(100))).toBe('mouse');
    expect(wheelPointerKind(wheel(-120))).toBe('mouse');
    // Lines come from a notched wheel as well.
    expect(wheelPointerKind(wheel(3, { deltaMode: 1 }))).toBe('mouse');
  });

  it('reads a smooth scroll, including sideways, as a trackpad', () => {
    expect(wheelPointerKind(wheel(7.5))).toBe('trackpad');
    expect(wheelPointerKind(wheel(12, { deltaX: -4 }))).toBe('trackpad');
    expect(wheelPointerKind(wheel(0, { deltaX: 18 }))).toBe('trackpad');
  });

  it('reads a pinch as a trackpad', () => {
    // Ctrl with the wheel is how a pinch reaches the page.
    expect(wheelPointerKind(wheel(24, { ctrlKey: true }))).toBe('trackpad');
  });

  it('says nothing when the event is not clear', () => {
    expect(wheelPointerKind(wheel(20))).toBeNull();
  });
});

describe('pointer kinds', () => {
  it('knows which pointers have no key to hold', () => {
    // A mouse hovers and has buttons; a pen hovers too but has no keyboard, and
    // a finger is the one that cannot hover at all.
    expect(isKeylessPointer('mouse')).toBe(false);
    expect(isKeylessPointer('touch')).toBe(true);
    expect(isKeylessPointer('pen')).toBe(true);
    expect(isTouchPointer('pen')).toBe(false);
    expect(isTouchPointer('touch')).toBe(true);
  });
});

describe('input preference', () => {
  it('offers a mouse, a trackpad and a finger', () => {
    expect(INPUT_PREFERENCES).toEqual(['auto', 'mouse', 'trackpad', 'touch']);
    expect(DEFAULT_INPUT_PREFERENCE).toBe('auto');
    for (const value of INPUT_PREFERENCES) expect(isInputPreference(value)).toBe(true);
    expect(isInputPreference('icancad')).toBe(false);
    expect(isInputPreference(null)).toBe(false);
  });

  it('follows the platform until a wheel says otherwise', () => {
    expect(likelyPointerKind('macOS')).toBe('trackpad');
    expect(likelyPointerKind('iPad')).toBe('trackpad');
    expect(likelyPointerKind('Windows')).toBe('mouse');
    expect(likelyPointerKind('Linux x86_64')).toBe('mouse');
  });

  it('lets a wheel change the automatic reading, and a pinned one ignore it', () => {
    noteWheelKind('mouse');
    expect(resolvedPointerKind('auto')).toBe('mouse');
    noteWheelKind('trackpad');
    expect(resolvedPointerKind('auto')).toBe('trackpad');
    // A pinned choice stands whatever the last wheel was.
    expect(resolvedPointerKind('mouse')).toBe('mouse');
    expect(resolvedPointerKind('trackpad')).toBe('trackpad');
  });

  it('maps the preference to the gesture profile', () => {
    expect(inputProfile('mouse')).toBe('pointer');
    expect(inputProfile('trackpad')).toBe('pointer');
    expect(inputProfile('touch')).toBe('touch');
  });

  it('reads a precise pointer where the platform cannot answer', () => {
    // Without a window there is no media query to ask, and a precise pointer is
    // the safe answer: it is the mouse every desktop has.
    expect(detectInputProfile()).toBe('pointer');
  });
});
