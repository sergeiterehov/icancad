import { describe, expect, it } from 'vitest';
import { markEdge, markSqueeze } from '../src/ui/useFloatingBarShift';

// A whole corner: badge, product name and a 190px project name.
const mark = { right: 324, name: 205, brand: 65 };

describe('the corner beside a floating bar', () => {
  it('stays whole while the bar clears it', () => {
    expect(markSqueeze(400, mark)).toBe(0);
    expect(markEdge(0, mark)).toBe(0);
  });

  it('gives up the project name first', () => {
    expect(markSqueeze(200, mark)).toBe(1);
    // The bar still starts where it wanted to, which is already past the name.
    expect(markEdge(1, mark)).toBe(0);
  });

  it('gives up the product name before the bar reaches the mark', () => {
    expect(markSqueeze(100, mark)).toBe(2);
    expect(markEdge(2, mark)).toBe(mark.right - mark.name - mark.brand + 8);
  });

  it('reads a bar pushed left by a dock as pressed against the corner', () => {
    expect(markSqueeze(-20, mark)).toBe(2);
  });
});
