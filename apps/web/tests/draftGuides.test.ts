import { describe, expect, it } from 'vitest';
import { draftGuides } from '../src/sketch/draftGuides';

let counter = 0;
const newId = () => `guide-${(counter += 1)}`;

describe('draftGuides', () => {
  it('shows the circle an arc is being cut from, and its radius', () => {
    const guides = draftGuides('arc', [[0, 0]], [3, 4], newId);
    expect(guides[0]).toMatchObject({ type: 'circle', cx: 0, cy: 0, r: 5 });
    expect(guides[1]).toMatchObject({ type: 'line', x1: 0, y1: 0, x2: 3, y2: 4 });
  });

  it('adds the radii an arc has already picked', () => {
    const guides = draftGuides(
      'arc',
      [
        [0, 0],
        [10, 0],
      ],
      [0, 10],
      newId,
    );
    expect(guides.map((guide) => guide.type)).toEqual(['circle', 'line', 'line']);
  });

  it('shows the full ellipse behind an elliptical arc', () => {
    const guides = draftGuides(
      'elliptical-arc',
      [
        [0, 0],
        [10, 0],
        [0, 5],
      ],
      [10, 1],
      newId,
    );
    expect(guides[0]).toMatchObject({ type: 'ellipse', rx: 10, ry: 5, rotation: 0 });
  });

  it('shows the axes of an ellipse with no second radius yet', () => {
    const guides = draftGuides('ellipse', [[0, 0]], [10, 0], newId);
    expect(guides).toHaveLength(2);
    expect(guides.every((guide) => guide.type === 'line')).toBe(true);
    // The half-length partner of the first radius is drawn straight away.
    expect(guides[1]).toMatchObject({ x1: 0, y1: 0, x2: 0, y2: 5 });
  });

  it('has nothing to show before the centre is picked', () => {
    expect(draftGuides('arc', [], [3, 4], newId)).toEqual([]);
  });
});
