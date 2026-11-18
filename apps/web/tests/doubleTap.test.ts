import { describe, expect, it } from 'vitest';
import { isDoubleTap, type TapMark } from '../src/viewport/doubleTap';

function tap(time: number, x = 100, y = 100): TapMark {
  return { time, x, y };
}

describe('a second tap', () => {
  it('continues a tap that came quickly enough', () => {
    expect(isDoubleTap(tap(1000), tap(1200))).toBe(true);
  });

  it('is not a double tap once the hand waited', () => {
    expect(isDoubleTap(tap(1000), tap(1500))).toBe(false);
  });

  it('has to land where the first one did', () => {
    expect(isDoubleTap(tap(1000), tap(1200, 120, 100))).toBe(false);
  });

  it('starts a pair when nothing came before it', () => {
    expect(isDoubleTap(null, tap(1000))).toBe(false);
  });
});
