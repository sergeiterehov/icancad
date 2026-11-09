import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { autoConstraintsForEntity, orientationConstraint } from '../src/sketch/autoConstraints';
import type { SketchSnap, SketchSnapInput } from '../src/sketch/snap';

const snap = (
  target: SketchSnap['pointSnap'] | null,
  curve: SketchSnap['curveSnap'] = null,
  midpoint: SketchSnap['midpointSnap'] = null,
): SketchSnap => ({ point: [0, 0], pointSnap: target, curveSnap: curve, midpointSnap: midpoint });

const free = (value: SketchSnap): SketchSnapInput => ({ snap: value, mode: 'free' });
const curveOnly = (value: SketchSnap): SketchSnapInput => ({ snap: value, mode: 'curve-only' });
const none: SketchSnapInput = { snap: null, mode: 'none' };

const line: SketchEntity = {
  id: 'line',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 6,
};

describe('automatic constraints', () => {
  it('creates coincidence for point snaps', () => {
    const result = autoConstraintsForEntity(line, [
      free(snap({ entityId: 'other', pointIndex: 1, point: [0, 0] })),
      none,
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
    const onLine = autoConstraintsForEntity(line, [
      free(snap(null, { entityId: 'curve', type: 'line', point: [1, 1] })),
      none,
    ]);
    expect(onLine.snapConstraints[0]?.type).toBe('point-on-line');

    const onArc = autoConstraintsForEntity(line, [
      free(snap(null, { entityId: 'arc', type: 'arc', point: [1, 1] })),
      none,
    ]);
    expect(onArc.snapConstraints[0]?.type).toBe('point-on-circle');

    const onEllipse = autoConstraintsForEntity(line, [
      free(snap(null, { entityId: 'ellipse', type: 'ellipse', point: [1, 1] })),
      none,
    ]);
    expect(onEllipse.snapConstraints[0]?.type).toBe('point-on-ellipse');
  });

  it('creates symmetry when snapping to a segment midpoint', () => {
    const result = autoConstraintsForEntity(line, [
      free(snap(null, null, { entityId: 'other', point: [5, 0] })),
      none,
    ]);
    expect(result.snapConstraints[0]).toMatchObject({
      type: 'symmetric',
      refs: [
        { entityId: 'other', pointIndex: 0 },
        { entityId: 'other', pointIndex: 1 },
        { entityId: 'line', pointIndex: 0 },
      ],
    });
    expect(result.highlightIds).toContain('other');
  });

  it('creates tangency for circle radius snaps and nothing else', () => {
    const circle: SketchEntity = {
      id: 'circle',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 5,
    };
    const tangent = autoConstraintsForEntity(circle, [
      free(snap({ entityId: 'p', pointIndex: 0, point: [0, 0] })),
      curveOnly(snap(null, { entityId: 'line', type: 'line', point: [5, 0] })),
    ]);
    expect(tangent.constraints.map((constraint) => constraint.type)).toEqual([
      'coincident',
      'tangent',
    ]);

    const ignored = autoConstraintsForEntity(circle, [
      none,
      curveOnly(snap(null, { entityId: 'ellipse', type: 'ellipse', point: [5, 0] })),
    ]);
    expect(ignored.constraints).toHaveLength(0);
  });

  it('ignores point snaps in curve-only mode', () => {
    const circle: SketchEntity = {
      id: 'circle',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 5,
    };
    const result = autoConstraintsForEntity(circle, [
      none,
      curveOnly(snap({ entityId: 'p', pointIndex: 0, point: [5, 0] })),
    ]);
    expect(result.constraints).toHaveLength(0);
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
