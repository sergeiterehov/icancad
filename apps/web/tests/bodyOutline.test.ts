import { describe, expect, it } from 'vitest';
import type { BodyEdge } from '@icancad/kernel';
import { OUTLINE_CREASE_RADIANS, outlineSegments } from '../src/viewport/bodyOutline';

function edge(overrides: Partial<BodyEdge>): BodyEdge {
  return {
    id: '0',
    faceIds: [0, 1],
    points: [],
    closed: false,
    ...overrides,
  };
}

describe('body outline', () => {
  it('turns every sharp edge polyline into segments', () => {
    const outline = outlineSegments([
      edge({ points: [0, 0, 0, 1, 0, 0, 2, 0, 0], wedge: Math.PI / 2 }),
    ]);
    expect([...outline.sharp]).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(outline.tangent).toHaveLength(0);
  });

  it('keeps edges whose faces meet almost smoothly apart as tangency lines', () => {
    for (const wedge of [Math.PI, Math.PI - OUTLINE_CREASE_RADIANS / 2]) {
      const outline = outlineSegments([edge({ points: [0, 0, 0, 1, 0, 0], wedge })]);
      expect(outline.sharp).toHaveLength(0);
      expect([...outline.tangent]).toEqual([0, 0, 0, 1, 0, 0]);
    }
  });

  it('keeps an edge with an unknown wedge sharp', () => {
    const outline = outlineSegments([edge({ points: [0, 0, 0, 1, 0, 0] })]);
    expect([...outline.sharp]).toEqual([0, 0, 0, 1, 0, 0]);
    expect(outline.tangent).toHaveLength(0);
  });

  it('keeps the closing segment of a closed polyline', () => {
    const outline = outlineSegments([
      edge({
        points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0],
        closed: true,
        wedge: Math.PI / 2,
      }),
    ]);
    expect(outline.sharp).toHaveLength(3 * 6);
    expect([...outline.sharp.slice(12)]).toEqual([1, 1, 0, 0, 0, 0]);
  });
});
