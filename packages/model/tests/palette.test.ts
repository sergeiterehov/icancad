import { describe, expect, it } from 'vitest';
import { BODY_COLORS, SKETCH_COLOR } from '../src/index';

/** How many colours the first bodies of a project take before they get loud. */
const QUIET = 5;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** Perceptual distance, so "a pair still reads apart" is a number, not a taste. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (value: number) => (value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function distance(a: string, b: string): number {
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/** Greys and tints sit well below a full hue: the palette opens quietly. */
function chroma(hex: string): number {
  const values = rgb(hex);
  return Math.max(...values) - Math.min(...values);
}

describe('the body palette', () => {
  it('opens with quiet tints instead of full colours', () => {
    for (const color of BODY_COLORS.slice(0, QUIET)) {
      expect(chroma(color)).toBeLessThan(0.25);
    }
    // The palette does reach full colour, so "quiet" is an opening, not a theme.
    expect(BODY_COLORS.slice(QUIET).some((color) => chroma(color) > 0.5)).toBe(true);
  });

  it('keeps the quiet tints apart from each other', () => {
    const quiet = BODY_COLORS.slice(0, QUIET);
    for (let first = 0; first < quiet.length; first += 1) {
      for (let second = first + 1; second < quiet.length; second += 1) {
        expect(distance(quiet[first]!, quiet[second]!)).toBeGreaterThan(10);
      }
    }
  });

  it('is a set of distinct colours', () => {
    expect(new Set(BODY_COLORS).size).toBe(BODY_COLORS.length);
    for (const color of BODY_COLORS) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps the sketch blue outside the body sequence', () => {
    // A sketch row has to read as a sketch, not as the first, quiet body.
    expect(SKETCH_COLOR).not.toBe(BODY_COLORS[0]);
    expect(BODY_COLORS).toContain(SKETCH_COLOR);
  });
});
