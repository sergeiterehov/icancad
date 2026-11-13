import { describe, expect, it } from 'vitest';
import { formatStep, parseNumber, steppedValue, wheelStep } from '../src/ui/numberStep';

describe('numeric field stepping', () => {
  it('reads the typed precision as the step', () => {
    expect(wheelStep('12.3')).toBeCloseTo(0.1);
    expect(wheelStep('12.34')).toBeCloseTo(0.01);
    expect(wheelStep('12.345')).toBeCloseTo(0.001);
    expect(wheelStep('0')).toBe(1);
    expect(wheelStep('12')).toBe(1);
  });

  it('accepts a comma as the separator', () => {
    expect(wheelStep('12,34')).toBeCloseTo(0.01);
    expect(parseNumber('12,34')).toBeCloseTo(12.34);
  });

  it('moves by exactly one step without float noise', () => {
    expect(steppedValue(12.3, 0.1, 1)).toBe(12.4);
    expect(steppedValue(12.3, 0.1, -1)).toBe(12.2);
    expect(steppedValue(12.34, 0.01, 1)).toBe(12.35);
    expect(steppedValue(0, 1, 1)).toBe(1);
    expect(steppedValue(0, 1, -1)).toBe(-1);
  });

  it('keeps stepping across zero and over ten thousandths', () => {
    expect(steppedValue(-0.1, 0.1, 1)).toBe(0);
    expect(steppedValue(12.345, 0.001, 1)).toBe(12.346);
  });

  it('keeps the step visible after a round value', () => {
    // A step of 0.1 through 2 must still read as `2.0`, so the next notch and
    // a refocus keep stepping by 0.1.
    expect(formatStep(2, 0.1)).toBe('2.0');
    expect(formatStep(12.3, 0.01)).toBe('12.30');
    expect(formatStep(13, 1)).toBe('13');
    expect(wheelStep(formatStep(2, 0.1))).toBeCloseTo(0.1);
  });
});
