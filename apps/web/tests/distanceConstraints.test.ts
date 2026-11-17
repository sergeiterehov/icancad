import { createRequire } from 'node:module';
import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { sketchEntityIndex } from '@icancad/sketch';
import {
  Algorithm,
  GcsWrapper,
  init_planegcs_module,
  type ModuleStatic,
} from '@salusoft89/planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildConstraintActions,
  constraintsForAction,
  constraintsSatisfied,
} from '../src/sketch/constraintModel';
import { applySolverSolution, buildSolverPrimitives } from '../src/sketch/mapping';

let gcs: GcsWrapper;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm');
  const mod = (await init_planegcs_module({ locateFile: () => wasm })) as ModuleStatic;
  gcs = new GcsWrapper(new mod.GcsSystem(), mod);
  gcs.set_max_iterations(200);
});

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints,
    references: [],
  };
}

const point = (id: string, x: number, y: number): SketchEntity => ({
  id,
  type: 'point',
  construction: false,
  x,
  y,
});
const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});
const circle = (id: string, cx: number, cy: number, r: number): SketchEntity => ({
  id,
  type: 'circle',
  construction: false,
  cx,
  cy,
  r,
});

function action(feature: SketchFeature, keys: string[], type: SketchConstraint['type']) {
  return buildConstraintActions(feature, keys).find((candidate) => candidate.type === type);
}

function solve(entities: SketchEntity[], constraints: SketchConstraint[]) {
  gcs.clear_data();
  const { primitives } = buildSolverPrimitives(entities, constraints);
  gcs.push_primitives_and_params(primitives);
  const status = gcs.solve(Algorithm.DogLeg);
  const conflicting = gcs.get_gcs_conflicting_constraints();
  const redundant = gcs.get_gcs_redundant_constraints();
  if (status >= 2) return { status, conflicting, redundant, entities };
  gcs.apply_solution();
  return {
    status,
    conflicting,
    redundant,
    entities: applySolverSolution(entities, gcs.sketch_index.get_primitives()),
  };
}

describe('new distance actions', () => {
  it('offers the distance from a point to a circle and to an arc', () => {
    const withCircle = sketch([point('p', 10, 0), circle('c', 0, 0, 3)]);
    expect(action(withCircle, ['p#0', 'c'], 'distance')?.value).toBeCloseTo(7);

    const arc: SketchEntity = {
      id: 'a',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0,
      r: 3,
      startAngle: 0,
      endAngle: Math.PI,
    };
    const withArc = sketch([point('p', 10, 0), arc]);
    expect(action(withArc, ['p#0', 'a'], 'distance')?.value).toBeCloseTo(7);
  });

  it('offers the distance between the edges of two circles', () => {
    const separate = sketch([circle('c1', 0, 0, 2), circle('c2', 10, 0, 3)]);
    expect(action(separate, ['c1', 'c2'], 'distance')?.value).toBeCloseTo(5);

    const overlapping = sketch([circle('c1', 0, 0, 4), circle('c2', 5, 0, 4)]);
    expect(action(overlapping, ['c1', 'c2'], 'distance')?.value).toBe(0);

    const concentric = sketch([circle('c1', 0, 0, 45), circle('c2', 0, 0, 35)]);
    expect(action(concentric, ['c1', 'c2'], 'distance')?.value).toBeCloseTo(10);

    const nested = sketch([circle('c1', 0, 0, 10), circle('c2', 2, 0, 3)]);
    expect(action(nested, ['c1', 'c2'], 'distance')?.value).toBeCloseTo(5);
  });

  it('offers an axis distance from a point to a line', () => {
    const feature = sketch([point('p', 4, 3), line('l', 0, 0, 10, 0)]);
    // A horizontal line has no horizontal crossing, but a vertical one.
    expect(action(feature, ['p#0', 'l'], 'horizontal-distance')).toBeUndefined();
    expect(action(feature, ['p#0', 'l'], 'vertical-distance')?.value).toBeCloseTo(3);
  });

  it('offers an axis distance from a point to a circle', () => {
    const feature = sketch([point('p', 10, 0), circle('c', 0, 0, 3)]);
    expect(action(feature, ['p#0', 'c'], 'horizontal-distance')?.value).toBeCloseTo(7);
  });

  it('measures geometry that already satisfies the new distance', () => {
    const feature = sketch(
      [point('p', 8, 0), circle('c', 0, 0, 3)],
      [
        {
          id: 'd',
          type: 'distance',
          refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'c' }],
          value: 5,
        },
      ],
    );
    expect(constraintsSatisfied(feature.constraints, feature.entities)).toBe(true);
  });
});

describe('new distance mappings', () => {
  it('maps a point-to-circle distance to p2cdistance', () => {
    const entities = [point('p', 10, 0), circle('c', 0, 0, 3)];
    const constraint: SketchConstraint = {
      id: 'd',
      type: 'distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'c' }],
      value: 2,
    };
    const { primitives } = buildSolverPrimitives(entities, [constraint]);
    expect(primitives.find((primitive) => primitive.id === 'd')).toMatchObject({
      type: 'p2cdistance',
      p_id: 'p',
      c_id: 'c',
      distance: 2,
    });
  });

  it('maps a circle-to-circle distance to c2cdistance', () => {
    const entities = [circle('c1', 0, 0, 2), circle('c2', 10, 0, 3)];
    const constraint: SketchConstraint = {
      id: 'd',
      type: 'distance',
      refs: [{ entityId: 'c1' }, { entityId: 'c2' }],
      value: 5,
    };
    const { primitives } = buildSolverPrimitives(entities, [constraint]);
    expect(primitives.find((primitive) => primitive.id === 'd')).toMatchObject({
      type: 'c2cdistance',
      c1_id: 'c1',
      c2_id: 'c2',
      dist: 5,
    });
  });

  it('maps a concentric pair through contact points', () => {
    const entities = [circle('c1', 0, 0, 45), circle('c2', 0, 0, 35)];
    const constraint: SketchConstraint = {
      id: 'd',
      type: 'distance',
      refs: [{ entityId: 'c1' }, { entityId: 'c2' }],
      value: 10,
    };
    const { primitives } = buildSolverPrimitives(entities, [constraint]);
    expect(primitives.find((primitive) => primitive.id === 'd')).toMatchObject({
      type: 'p2p_distance',
      distance: 10,
    });
  });

  it('maps a point-to-ellipse distance through an auxiliary contact point', () => {
    const ellipse: SketchEntity = {
      id: 'e',
      type: 'ellipse',
      construction: false,
      cx: 0,
      cy: 0,
      rx: 4,
      ry: 2,
      rotation: 0,
    };
    const entities = [point('p', 10, 0), ellipse];
    const constraint: SketchConstraint = {
      id: 'd',
      type: 'distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'e' }],
      value: 6,
    };
    const { primitives } = buildSolverPrimitives(entities, [constraint]);
    expect(primitives.find((primitive) => primitive.id === 'd~on')).toMatchObject({
      type: 'point_on_ellipse',
      e_id: 'e',
    });
    expect(primitives.find((primitive) => primitive.id === 'd')).toMatchObject({
      type: 'p2p_distance',
      p1_id: 'p',
      distance: 6,
    });
  });
});

describe('solver distances', () => {
  it('keeps a point on the side of the line it was measured from', () => {
    const entities = [line('l', 8, -10, 8, 10), point('p', 3, 1)];
    const fixes: SketchConstraint[] = [
      { id: 'f0', type: 'fix', refs: [{ entityId: 'l', pointIndex: 0 }], x: 8, y: -10 },
      { id: 'f1', type: 'fix', refs: [{ entityId: 'l', pointIndex: 1 }], x: 8, y: 10 },
    ];
    const withoutSide: SketchConstraint = {
      id: 'd',
      type: 'distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'l' }],
      value: 5,
    };
    const unsigned = solve(entities, [...fixes, withoutSide]);
    expect(unsigned.conflicting).toEqual([]);
    // The point already is five away on the left of the line: without a stored
    // side the solver has no reason to move it.
    const stillLeft = unsigned.entities.find((entity) => entity.id === 'p');
    expect(stillLeft?.type === 'point' ? stillLeft.x : NaN).toBeCloseTo(3, 2);

    const withSide = solve(entities, [...fixes, { ...withoutSide, side: -1 }]);
    expect(withSide.conflicting).toEqual([]);
    const moved = withSide.entities.find((entity) => entity.id === 'p');
    // side -1 is the right of the upward line, so the point has to cross over.
    expect(moved?.type === 'point' ? moved.x : NaN).toBeCloseTo(13, 2);
  });

  it('keeps the side when the line comes back with its endpoints swapped', () => {
    // The same line as above, written from the other end. The canonical side
    // must survive the swap instead of mirroring the point.
    const entities = [line('l', 8, 10, 8, -10), point('p', 3, 1)];
    const fixes: SketchConstraint[] = [
      { id: 'f0', type: 'fix', refs: [{ entityId: 'l', pointIndex: 0 }], x: 8, y: 10 },
      { id: 'f1', type: 'fix', refs: [{ entityId: 'l', pointIndex: 1 }], x: 8, y: -10 },
    ];
    const constraint: SketchConstraint = {
      id: 'd',
      type: 'distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'l' }],
      value: 5,
      side: 1,
    };
    const result = solve(entities, [...fixes, constraint]);
    expect(result.conflicting).toEqual([]);
    const solved = result.entities.find((entity) => entity.id === 'p');
    expect(solved?.type === 'point' ? solved.x : NaN).toBeCloseTo(3, 2);
  });

  it('keeps an axis distance above the line it was measured from', () => {
    const entities = [line('l', 0, 6, 10, 6), point('p', 4, 3)];
    const fixes: SketchConstraint[] = [
      { id: 'f0', type: 'fix', refs: [{ entityId: 'l', pointIndex: 0 }], x: 0, y: 6 },
      { id: 'f1', type: 'fix', refs: [{ entityId: 'l', pointIndex: 1 }], x: 10, y: 6 },
    ];
    const vertical: SketchConstraint = {
      id: 'v',
      type: 'vertical-distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'l' }],
      value: 3,
      side: 1,
    };
    const result = solve(entities, [...fixes, vertical]);
    expect(result.conflicting).toEqual([]);
    const solved = result.entities.find((entity) => entity.id === 'p');
    expect(solved?.type === 'point' ? solved.y : NaN).toBeCloseTo(9, 2);
  });

  it('solves the distance from a point to a circle', () => {
    const entities = [circle('c', 0, 0, 3), point('p', 10, 0)];
    const constraints: SketchConstraint[] = [
      { id: 'fc', type: 'fix', refs: [{ entityId: 'c', pointIndex: 0 }], x: 0, y: 0 },
      { id: 'rc', type: 'radius', refs: [{ entityId: 'c' }], value: 3 },
      {
        id: 'd',
        type: 'distance',
        refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'c' }],
        value: 5,
      },
    ];
    const result = solve(entities, constraints);
    expect(result.conflicting).toEqual([]);
    const solved = result.entities.find((entity) => entity.id === 'p');
    const radial = solved?.type === 'point' ? Math.hypot(solved.x, solved.y) - 3 : NaN;
    expect(radial).toBeCloseTo(5, 2);
  });

  it('solves the gap between two arcs through their supporting circles', () => {
    const arc = (id: string, cx: number, r: number): SketchEntity => ({
      id,
      type: 'arc',
      construction: false,
      cx,
      cy: 0,
      r,
      startAngle: 0,
      endAngle: Math.PI / 2,
    });
    const entities = [arc('a1', 0, 2), arc('a2', 12, 3)];
    const constraints: SketchConstraint[] = [
      { id: 'f1', type: 'fix', refs: [{ entityId: 'a1', pointIndex: 0 }], x: 0, y: 0 },
      { id: 'r1', type: 'radius', refs: [{ entityId: 'a1' }], value: 2 },
      { id: 'r2', type: 'radius', refs: [{ entityId: 'a2' }], value: 3 },
      {
        id: 'd',
        type: 'distance',
        refs: [{ entityId: 'a1' }, { entityId: 'a2' }],
        value: 5,
      },
    ];
    const result = solve(entities, constraints);
    expect(result.conflicting).toEqual([]);
    const second = result.entities.find((entity) => entity.id === 'a2');
    expect(second?.type === 'arc' ? Math.hypot(second.cx, second.cy) - 2 - 3 : NaN).toBeCloseTo(
      5,
      2,
    );
  });

  it('keeps the radial gap of concentric circles', () => {
    const entities = [circle('c1', 0, 0, 45), circle('c2', 0, 0, 35)];
    const constraints: SketchConstraint[] = [
      { id: 'f1', type: 'fix', refs: [{ entityId: 'c1', pointIndex: 0 }], x: 0, y: 0 },
      { id: 'r1', type: 'radius', refs: [{ entityId: 'c1' }], value: 45 },
      { id: 'r2', type: 'radius', refs: [{ entityId: 'c2' }], value: 35 },
      {
        id: 'd',
        type: 'distance',
        refs: [{ entityId: 'c1' }, { entityId: 'c2' }],
        value: 10,
      },
    ];
    const result = solve(entities, constraints);
    expect(result.conflicting).toEqual([]);
    const second = result.entities.find((entity) => entity.id === 'c2');
    expect(second?.type === 'circle' ? Math.hypot(second.cx, second.cy) : NaN).toBeCloseTo(0, 6);
  });

  it('solves the gap between two circles', () => {
    const entities = [circle('c1', 0, 0, 2), circle('c2', 10, 0, 3)];
    const constraints: SketchConstraint[] = [
      { id: 'f1', type: 'fix', refs: [{ entityId: 'c1', pointIndex: 0 }], x: 0, y: 0 },
      { id: 'r1', type: 'radius', refs: [{ entityId: 'c1' }], value: 2 },
      { id: 'r2', type: 'radius', refs: [{ entityId: 'c2' }], value: 3 },
      {
        id: 'd',
        type: 'distance',
        refs: [{ entityId: 'c1' }, { entityId: 'c2' }],
        value: 5,
      },
    ];
    const result = solve(entities, constraints);
    expect(result.conflicting).toEqual([]);
    const second = result.entities.find((entity) => entity.id === 'c2');
    expect(second?.type === 'circle' ? Math.hypot(second.cx, second.cy) - 2 - 3 : NaN).toBeCloseTo(
      5,
      2,
    );
  });
});

describe('distance action expansion', () => {
  it('captures the side when the constraint is created', () => {
    const feature = sketch([point('p', 3, 1), line('l', 0, -10, 0, 10)]);
    const [distance] = constraintsForAction(
      action(feature, ['p#0', 'l'], 'distance')!,
      sketchEntityIndex(feature.entities),
    );
    expect(distance).toMatchObject({ type: 'distance', side: -1 });
  });

  it('captures whether a point is inside or outside a circle', () => {
    const inside = sketch([point('p', 2, 0), circle('c', 0, 0, 5)]);
    const [distance] = constraintsForAction(
      action(inside, ['p#0', 'c'], 'distance')!,
      sketchEntityIndex(inside.entities),
    );
    expect(distance).toMatchObject({ type: 'distance', side: -1, value: 3 });
  });
});
