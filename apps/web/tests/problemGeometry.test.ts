import type { SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { problemGeometryIds } from '../src/sketch/problems';

const feature: SketchFeature = {
  id: 'sketch',
  type: 'sketch',
  name: 'Sketch',
  suppressed: false,
  plane: { type: 'datum', plane: 'XY', offset: 0 },
  entities: [],
  references: [],
  constraints: [
    {
      id: 'equal',
      type: 'equal',
      refs: [{ entityId: 'a' }, { entityId: 'b' }],
    },
    {
      id: 'vertical',
      type: 'vertical',
      refs: [{ entityId: 'b' }],
    },
    {
      id: 'fine',
      type: 'horizontal',
      refs: [{ entityId: 'c' }],
    },
  ],
};

describe('problem geometry', () => {
  it('collects the geometry of every problem constraint without duplicates', () => {
    expect(problemGeometryIds(feature, ['equal', 'vertical'])).toEqual(['a', 'b']);
  });

  it('returns nothing while the sketch has no problems', () => {
    expect(problemGeometryIds(feature, [])).toEqual([]);
  });

  it('ignores an id that no longer names a constraint', () => {
    expect(problemGeometryIds(feature, ['gone'])).toEqual([]);
  });
});
