import type { SketchEntity } from '@icancad/model';
import { moveEntityControlPoint } from '@icancad/sketch';
import { describe, expect, it, vi } from 'vitest';
import { autoConstraintsForEntity } from '../src/sketch/autoConstraints';
import { applyConstraintAction, buildConstraintActions } from '../src/sketch/constraintModel';
import { measuresForEntity, measureValue } from '../src/sketch/measure';
import { buildSolverPrimitives } from '../src/sketch/mapping';
import { ellipticalArcFrame } from '../src/sketch/ellipticalArcDraft';
import { solveSketch } from './planegcsSolve';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const arc: SketchEntity = {
  id: 'arc',
  type: 'elliptical-arc',
  construction: false,
  cx: 0,
  cy: 0,
  rx: 10,
  ry: 5,
  rotation: 0,
  startAngle: 0,
  endAngle: Math.PI,
};

describe('elliptical arc in the solver', () => {
  it('is an ellipse plus an arc that carries its angles', () => {
    const { primitives } = buildSolverPrimitives([arc], []);
    expect(primitives.filter((primitive) => primitive.type === 'ellipse')).toHaveLength(1);
    expect(primitives.filter((primitive) => primitive.type === 'arc_of_ellipse')).toHaveLength(1);
    expect(primitives.filter((primitive) => primitive.type === 'point_on_ellipse')).toHaveLength(2);
  });

  it('round-trips its frame and angles through a solve', async () => {
    const wider = moveEntityControlPoint(arc, 1, [14, 0]);
    const result = await solveSketch([wider], [], []);
    const solved = result.entities[0]!;
    expect(solved.type).toBe('elliptical-arc');
    if (solved.type !== 'elliptical-arc') return;
    expect(solved.rx).toBeCloseTo(14, 4);
    expect(solved.ry).toBeCloseTo(5, 4);
    expect(solved.startAngle).toBeCloseTo(0, 4);
    expect(solved.endAngle).toBeCloseTo(Math.PI, 4);
  });

  it('snaps a point onto its curve with point-on-ellipse', () => {
    const line: SketchEntity = {
      id: 'line',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 5,
    };
    const result = autoConstraintsForEntity(line, [
      { snap: null, mode: 'none' },
      {
        snap: {
          point: [7, 3],
          pointSnap: null,
          curveSnap: { entityId: 'arc', type: 'elliptical-arc', point: [7, 3] },
          midpointSnap: null,
        },
        mode: 'free',
      },
    ]);
    expect(result.snapConstraints.map((constraint) => constraint.type)).toEqual([
      'point-on-ellipse',
    ]);
  });

  it('measures its sweep and semi-axes', () => {
    expect(measuresForEntity(arc)).toEqual(['angle', 'length', 'rx', 'ry']);
    expect(measureValue(arc, 'angle')).toBeCloseTo(180, 2);
    expect(measureValue(arc, 'rx')).toBeCloseTo(10);
    expect(measureValue(arc, 'ry')).toBeCloseTo(5);
    // Half of the 10 by 5 ellipse.
    expect(measureValue(arc, 'length')!).toBeGreaterThan(23);
    expect(measureValue(arc, 'length')!).toBeLessThan(25);
  });

  it('offers an angle constraint and drives the sweep with it', async () => {
    const feature = {
      id: 'sketch',
      type: 'sketch' as const,
      name: 'Sketch',
      suppressed: false,
      plane: { type: 'datum' as const, plane: 'XY' as const, offset: 0 },
      entities: [arc],
      constraints: [],
      references: [],
    };
    const action = buildConstraintActions(feature, ['arc']).find(
      (candidate) => candidate.type === 'angle',
    );
    expect(action?.value).toBeCloseTo(180, 2);
    const applied = await applyConstraintAction(feature, {
      key: 'angle',
      type: 'angle',
      refs: [{ entityId: 'arc' }],
      value: 120,
    });
    const solved = applied.feature.entities[0]!;
    expect(solved.type).toBe('elliptical-arc');
    if (solved.type !== 'elliptical-arc') return;
    expect((Math.abs(solved.endAngle - solved.startAngle) * 180) / Math.PI).toBeCloseTo(120, 1);
  });
});

describe('elliptical arc draft', () => {
  it('reads a rotated major axis and keeps the minor axis at a right angle', () => {
    const frame = ellipticalArcFrame([0, 0], [0, 10], [4, 10], [0, 10]);
    expect(frame).not.toBeNull();
    expect(frame!.rx).toBeCloseTo(10);
    expect(frame!.ry).toBeCloseTo(4);
    expect(frame!.rotation).toBeCloseTo(Math.PI / 2);
    expect(frame!.startAngle).toBeCloseTo(0);
  });
});
