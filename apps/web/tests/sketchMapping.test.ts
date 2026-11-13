import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { applySolverSolution, buildSolverPrimitives } from '../src/sketch/mapping';
import type { SolverPin } from '../src/sketch/protocol';

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
  pinned: SolverPin[] = [],
  derived: string[] = [],
) {
  const point = (id: string) =>
    buildSolverPrimitives(entities, constraints, pinned, derived).primitives.find(
      (primitive) => primitive.id === id,
    );
  return { build: buildSolverPrimitives(entities, constraints, pinned, derived), point };
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

  it('maps a point-to-line distance to the perpendicular distance', () => {
    const target: SketchEntity = { id: 'p', type: 'point', construction: false, x: 4, y: 3 };
    const constraint: SketchConstraint = {
      id: 'dl-1',
      type: 'distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: line.id }],
      value: 5,
    };
    const { build } = primitives([target, line], [constraint]);
    expect(build.primitives.find((primitive) => primitive.id === 'dl-1')).toMatchObject({
      type: 'p2l_distance',
      p_id: 'p',
      l_id: line.id,
      distance: 5,
    });
  });

  it('maps the distance between two lines from the first line to the second', () => {
    const parallel: SketchEntity = {
      id: 'line-3',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 20,
      x2: 10,
      y2: 20,
    };
    const constraint: SketchConstraint = {
      id: 'dl-2',
      type: 'distance',
      refs: [{ entityId: 'line-3' }, { entityId: line.id }],
      value: 12,
    };
    const { build } = primitives([parallel, line], [constraint]);
    expect(build.primitives.find((primitive) => primitive.id === 'dl-2')).toMatchObject({
      type: 'p2l_distance',
      p_id: 'line-3~p0',
      l_id: line.id,
      distance: 12,
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

describe('solver pins', () => {
  it('holds derived geometry fixed without an explicit fix constraint', () => {
    const { build, point } = primitives([line], [], [], [line.id]);
    expect(point('line-1~p0')).toMatchObject({ fixed: true });
    expect(point('line-1~p1')).toMatchObject({ fixed: true });
    expect(build.primitives.some((primitive) => primitive.type === 'p2p_coincident')).toBe(false);
  });

  it('holds only the pinned coordinate so the point can still slide', () => {
    const { build, point } = primitives(
      [line],
      [],
      [{ entityId: line.id, pointIndex: 1, axis: 'x' }],
    );
    expect(point('line-1~p1')).toMatchObject({ type: 'point', x: 10, y: 5, fixed: false });
    expect(build.primitives.find((primitive) => primitive.id === 'line-1~p1~pin-x')).toMatchObject({
      type: 'coordinate_x',
      p_id: 'line-1~p1',
      x: 10,
    });
    expect(
      build.primitives.find((primitive) => primitive.id === 'line-1~p1~pin-y'),
    ).toBeUndefined();
  });
});

describe('solver solution mapping', () => {
  it('keeps an arc on its side when a solved endpoint crosses the angle branch cut', () => {
    const arc: SketchEntity = {
      id: 'arc-1',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0.1,
      r: 10,
      startAngle: Math.PI,
      endAngle: 0,
    };
    const solved = [
      { id: 'arc-1~p0', type: 'point', x: 0, y: 0.1, fixed: true },
      // The start endpoint drops a hair below the centre, so `atan2` returns a
      // negative angle while the arc must still sweep clockwise over the top.
      { id: 'arc-1~p1', type: 'point', x: -10, y: 0.05, fixed: false },
      { id: 'arc-1~p2', type: 'point', x: 10, y: 0.1, fixed: false },
      {
        id: 'arc-1',
        type: 'arc',
        c_id: 'arc-1~p0',
        start_id: 'arc-1~p1',
        end_id: 'arc-1~p2',
        radius: 10,
        start_angle: Math.PI,
        end_angle: 0,
      },
    ] as Parameters<typeof applySolverSolution>[1];

    const [result] = applySolverSolution([arc], solved);
    expect(result?.type).toBe('arc');
    if (result?.type !== 'arc') return;
    expect(result.endAngle - result.startAngle).toBeLessThan(0);
    expect(result.endAngle - result.startAngle).toBeCloseTo(-Math.PI, 2);
  });
});
