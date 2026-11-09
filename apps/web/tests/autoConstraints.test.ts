import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { autoConstraintsForEntity, orientationConstraint } from '../src/sketch/autoConstraints';
import type { SketchSnap } from '../src/sketch/snap';

const snap = (
  target: SketchSnap['pointSnap'] | null,
  curve: SketchSnap['curveSnap'] = null,
): SketchSnap => ({
  point: [0, 0],
  pointSnap: target,
  curveSnap: curve,
});

describe('automatic constraints', () => {
  it('creates coincidence for point snaps', () => {
    const line: SketchEntity = {
      id: 'line',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 0,
    };
    const result = autoConstraintsForEntity(line, [
      snap({ entityId: 'other', pointIndex: 1, point: [0, 0] }),
      null,
    ]);
    expect(result.snapConstraints[0]).toMatchObject({
      type: 'coincident',
      refs: [
        { entityId: 'line', pointIndex: 0 },
        { entityId: 'other', pointIndex: 1 },
      ],
    });
    expect(result.highlightIds).toContain('other#1');
  });

  it('creates point-on-curve constraints for curves', () => {
    const line: SketchEntity = {
      id: 'line',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 0,
    };
    expect(
      autoConstraintsForEntity(line, [
        snap(null, { entityId: 'curve', type: 'line', point: [1, 1] }),
        null,
      ]).snapConstraints[0]?.type,
    ).toBe('point-on-line');
    expect(
      autoConstraintsForEntity(line, [
        snap(null, { entityId: 'arc', type: 'arc', point: [1, 1] }),
        null,
      ]).snapConstraints[0]?.type,
    ).toBe('point-on-circle');
    expect(
      autoConstraintsForEntity(line, [
        snap(null, { entityId: 'ellipse', type: 'ellipse', point: [1, 1] }),
        null,
      ]).snapConstraints[0]?.type,
    ).toBe('point-on-ellipse');
  });

  it('adds horizontal or vertical constraints near the axes', () => {
    const horizontal: SketchEntity = {
      id: 'h',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 4,
    };
    const vertical: SketchEntity = {
      id: 'v',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 4,
      y2: 100,
    };
    expect(orientationConstraint(horizontal)?.type).toBe('horizontal');
    expect(orientationConstraint(vertical)?.type).toBe('vertical');
    expect(orientationConstraint({ ...horizontal, y2: 20 })).toBeNull();
  });
});
