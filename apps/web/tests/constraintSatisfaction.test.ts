import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { constraintsSatisfied } from '../src/sketch/constraintModel';

const line: SketchEntity = {
  id: 'line',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 14,
  y2: 0,
};

const circle: SketchEntity = {
  id: 'circle',
  type: 'circle',
  construction: false,
  cx: 0,
  cy: 0,
  r: 5,
};

function distance(value: number): SketchConstraint {
  return {
    id: 'distance',
    type: 'distance',
    refs: [
      { entityId: 'line', pointIndex: 0 },
      { entityId: 'line', pointIndex: 1 },
    ],
    value,
  };
}

describe('constraintsSatisfied', () => {
  it('accepts geometry that already has the driven length', () => {
    expect(constraintsSatisfied([distance(14)], [line])).toBe(true);
  });

  it('rejects geometry that the driven length has to move', () => {
    expect(constraintsSatisfied([distance(15)], [line])).toBe(false);
  });

  it('measures radius and diameter from the curve', () => {
    const radius: SketchConstraint = {
      id: 'radius',
      type: 'radius',
      refs: [{ entityId: 'circle' }],
      value: 5,
    };
    const diameter: SketchConstraint = {
      id: 'diameter',
      type: 'diameter',
      refs: [{ entityId: 'circle' }],
      value: 10,
    };
    expect(constraintsSatisfied([radius, diameter], [circle])).toBe(true);
  });

  it('ignores constraints without a numeric value', () => {
    const horizontal: SketchConstraint = {
      id: 'horizontal',
      type: 'horizontal',
      refs: [{ entityId: 'line' }],
    };
    expect(constraintsSatisfied([horizontal], [line])).toBe(true);
  });
});
