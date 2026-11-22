import type { SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { fixedPointIds } from '../src/sketch/fixedPoints';

const feature: SketchFeature = {
  id: 'sketch',
  type: 'sketch',
  name: 'Sketch',
  suppressed: false,
  plane: { type: 'datum', plane: 'XY', offset: 0 },
  references: [],
  entities: [
    { id: 'line', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'dot', type: 'point', construction: false, x: 3, y: 4 },
  ],
  constraints: [
    { id: 'f1', type: 'fix', refs: [{ entityId: 'line', pointIndex: 1 }], x: 10, y: 0 },
    { id: 'f2', type: 'fix', refs: [{ entityId: 'dot' }], x: 3, y: 4 },
    { id: 'h1', type: 'horizontal', refs: [{ entityId: 'line' }] },
  ],
};

describe('fixedPointIds', () => {
  it('marks the pinned end and the fixed point, not the whole line', () => {
    expect(fixedPointIds(feature).sort()).toEqual(['dot#0', 'line#1']);
  });

  it('marks every control point when the whole curve is fixed', () => {
    const whole: SketchFeature = {
      ...feature,
      constraints: [{ id: 'f', type: 'fix', refs: [{ entityId: 'line' }], x: 0, y: 0 }],
    };
    expect(fixedPointIds(whole).sort()).toEqual(['line#0', 'line#1']);
  });
});
