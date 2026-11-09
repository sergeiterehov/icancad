import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { buildSolverPrimitives } from '../src/sketch/mapping';

const line: SketchEntity = {
  id: 'line-1',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 5,
};

const line2: SketchEntity = {
  id: 'line-2',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 10,
};

function primitives(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  pinned: SketchConstraintRef[] = [],
) {
  const point = (id: string) =>
    buildSolverPrimitives(entities, constraints, pinned).primitives.find(
      (primitive) => primitive.id === id,
    );
  return { build: buildSolverPrimitives(entities, constraints, pinned), point };
}

describe('planegcs mapping', () => {
  it('anchors fixed control points at their captured coordinates', () => {
    const fix: SketchConstraint = {
      id: 'fix-1',
      type: 'fix',
      refs: [{ entityId: line.id, pointIndex: 0 }],
      x: 2,
      y: 3,
    };
    const { point } = primitives([line], [fix]);
    expect(point('line-1~p0')).toMatchObject({ type: 'point', x: 2, y: 3, fixed: true });
  });

  it('pins dragged points during a solve', () => {
    const { point } = primitives([line], [], [{ entityId: line.id, pointIndex: 1 }]);
    expect(point('line-1~p1')).toMatchObject({ fixed: true, x: 10, y: 5 });
  });

  it('maps symmetry about the last selected point for midpoints', () => {
    const points: SketchEntity[] = [
      { id: 'p1', type: 'point', construction: false, x: 0, y: 0 },
      { id: 'p2', type: 'point', construction: false, x: 20, y: 0 },
      { id: 'mid', type: 'point', construction: false, x: 10, y: 0 },
    ];
    const constraint: SketchConstraint = {
      id: 'symmetry',
      type: 'symmetric',
      refs: [{ entityId: 'p1' }, { entityId: 'p2' }, { entityId: 'mid' }],
    };
    const { build } = primitives(points, [constraint]);
    expect(build.primitives.find((primitive) => primitive.id === 'symmetry')).toMatchObject({
      type: 'p2p_symmetric_ppp',
      p1_id: 'p1',
      p2_id: 'p2',
      p_id: 'mid',
    });
  });

  it('maps horizontal distance through an auxiliary aligned point', () => {
    const constraint: SketchConstraint = {
      id: 'hd-1',
      type: 'horizontal-distance',
      refs: [
        { entityId: line.id, pointIndex: 0 },
        { entityId: line.id, pointIndex: 1 },
      ],
      value: 25,
    };
    const { build, point } = primitives([line], [constraint]);
    expect(point('hd-1~aux')).toMatchObject({ type: 'point', x: 10, y: 0 });
    expect(build.primitives.find((primitive) => primitive.id === 'hd-1')).toMatchObject({
      type: 'p2p_distance',
      distance: 25,
    });
  });

  it('converts line angle constraints from degrees to radians', () => {
    const constraint: SketchConstraint = {
      id: 'angle-1',
      type: 'angle',
      refs: [{ entityId: line.id }, { entityId: line2.id }],
      value: 90,
    };
    const { build } = primitives([line, line2], [constraint]);
    expect(build.primitives.find((primitive) => primitive.id === 'angle-1')).toMatchObject({
      type: 'l2l_angle_ll',
      angle: Math.PI / 2,
    });
  });
});
