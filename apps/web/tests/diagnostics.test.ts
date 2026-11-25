import { createRequire } from 'node:module';
import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { GcsWrapper, init_planegcs_module, type ModuleStatic } from '@salusoft89/planegcs';
import { beforeAll, expect, it } from 'vitest';
import { diagnoseFrozenEntities } from '../src/sketch/diagnostics';

let gcs: GcsWrapper;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm');
  const mod = (await init_planegcs_module({ locateFile: () => wasm })) as ModuleStatic;
  gcs = new GcsWrapper(new mod.GcsSystem(), mod);
  gcs.set_max_iterations(200);
});

const line: SketchEntity = {
  id: 'line',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 20,
  y2: 0,
};

const fixStart: SketchConstraint = {
  id: 'f1',
  type: 'fix',
  refs: [{ entityId: 'line', pointIndex: 0 }],
  x: 0,
  y: 0,
};

const fixEnd: SketchConstraint = {
  id: 'f2',
  type: 'fix',
  refs: [{ entityId: 'line', pointIndex: 1 }],
  x: 20,
  y: 0,
};

it('detects an otherwise unconstrained line as movable', () => {
  expect(diagnoseFrozenEntities(gcs, [line], [], 3)).toEqual([]);
});

it('detects a fully fixed line as frozen while global DoF remains elsewhere', () => {
  expect(diagnoseFrozenEntities(gcs, [line], [fixStart, fixEnd], 2)).toEqual(['line']);
  expect(diagnoseFrozenEntities(gcs, [line], [fixStart], 3)).toEqual([]);
});

it('detects a dimensioned and anchored line as frozen', () => {
  const constraints: SketchConstraint[] = [
    fixStart,
    { id: 'h', type: 'horizontal', refs: [{ entityId: 'line' }] },
    { id: 'd', type: 'distance', refs: [{ entityId: 'line' }], value: 20 },
  ];
  expect(diagnoseFrozenEntities(gcs, [line], constraints, 1)).toEqual(['line']);
  expect(
    diagnoseFrozenEntities(
      gcs,
      [line],
      [
        { id: 'h', type: 'horizontal', refs: [{ entityId: 'line' }] },
        { id: 'd', type: 'distance', refs: [{ entityId: 'line' }], value: 20 },
      ],
      2,
    ),
  ).toEqual([]);
});

it('keeps a point sliding on a fixed circle movable', () => {
  const circle: SketchEntity = {
    id: 'circle',
    type: 'circle',
    construction: false,
    cx: 0,
    cy: 0,
    r: 10,
  };
  const point: SketchEntity = {
    id: 'point',
    type: 'point',
    construction: false,
    x: 10,
    y: 0,
  };
  const constraints: SketchConstraint[] = [
    { id: 'center', type: 'fix', refs: [{ entityId: 'circle', pointIndex: 0 }], x: 0, y: 0 },
    { id: 'radius', type: 'radius', refs: [{ entityId: 'circle' }], value: 10 },
    {
      id: 'on-circle',
      type: 'point-on-circle',
      refs: [{ entityId: 'point' }, { entityId: 'circle' }],
    },
  ];
  const frozen = diagnoseFrozenEntities(gcs, [circle, point], constraints, 1);
  expect(frozen).toContain('circle');
  expect(frozen).not.toContain('point');
});

it('does not mark a closed but unanchored profile as fully constrained', () => {
  const lines: SketchEntity[] = [
    { id: 'l1', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'l2', type: 'line', construction: false, x1: 10.2, y1: 0, x2: 10.2, y2: 5 },
    { id: 'l3', type: 'line', construction: false, x1: 10, y1: 5.2, x2: 0, y2: 5.2 },
    { id: 'l4', type: 'line', construction: false, x1: 0, y1: 5, x2: 0, y2: 0.2 },
  ];
  const constraints: SketchConstraint[] = [
    {
      id: 'c1',
      type: 'coincident',
      refs: [
        { entityId: 'l1', pointIndex: 1 },
        { entityId: 'l2', pointIndex: 0 },
      ],
    },
    {
      id: 'c2',
      type: 'coincident',
      refs: [
        { entityId: 'l2', pointIndex: 1 },
        { entityId: 'l3', pointIndex: 0 },
      ],
    },
    {
      id: 'c3',
      type: 'coincident',
      refs: [
        { entityId: 'l3', pointIndex: 1 },
        { entityId: 'l4', pointIndex: 0 },
      ],
    },
    {
      id: 'c4',
      type: 'coincident',
      refs: [
        { entityId: 'l4', pointIndex: 1 },
        { entityId: 'l1', pointIndex: 0 },
      ],
    },
    { id: 'h1', type: 'horizontal', refs: [{ entityId: 'l1' }] },
    { id: 'h3', type: 'horizontal', refs: [{ entityId: 'l3' }] },
    { id: 'v2', type: 'vertical', refs: [{ entityId: 'l2' }] },
    { id: 'v4', type: 'vertical', refs: [{ entityId: 'l4' }] },
    { id: 'd1', type: 'distance', refs: [{ entityId: 'l1' }], value: 10 },
    { id: 'd2', type: 'distance', refs: [{ entityId: 'l2' }], value: 5 },
    { id: 'd3', type: 'distance', refs: [{ entityId: 'l3' }], value: 10 },
    { id: 'd4', type: 'distance', refs: [{ entityId: 'l4' }], value: 5 },
  ];
  expect(diagnoseFrozenEntities(gcs, lines, constraints, 2)).toEqual([]);
});

it('does not mark coupled geometry as frozen when a global DoF remains', () => {
  const entities: SketchEntity[] = [
    { id: 'c0', type: 'circle', construction: false, cx: -10, cy: 0, r: 4 },
    { id: 'c1', type: 'circle', construction: false, cx: 10, cy: 0, r: 4 },
    { id: 'l0', type: 'line', construction: true, x1: 0, y1: 0, x2: -10, y2: 0 },
    { id: 'l1', type: 'line', construction: true, x1: 0, y1: 0, x2: 10, y2: 0 },
  ];
  const constraints: SketchConstraint[] = [
    {
      id: 'on-x-0',
      type: 'point-on-line',
      refs: [{ entityId: 'c0', pointIndex: 0 }, { entityId: 'sketch:x-axis' }],
    },
    {
      id: 'on-x-1',
      type: 'point-on-line',
      refs: [{ entityId: 'c1', pointIndex: 0 }, { entityId: 'sketch:x-axis' }],
    },
    { id: 'equal-radius', type: 'equal', refs: [{ entityId: 'c0' }, { entityId: 'c1' }] },
    {
      id: 'start-0',
      type: 'coincident',
      refs: [
        { entityId: 'l0', pointIndex: 0 },
        { entityId: 'sketch:origin', pointIndex: 0 },
      ],
    },
    {
      id: 'end-0',
      type: 'coincident',
      refs: [
        { entityId: 'l0', pointIndex: 1 },
        { entityId: 'c0', pointIndex: 0 },
      ],
    },
    {
      id: 'start-1',
      type: 'coincident',
      refs: [
        { entityId: 'l1', pointIndex: 0 },
        { entityId: 'sketch:origin', pointIndex: 0 },
      ],
    },
    {
      id: 'end-1',
      type: 'coincident',
      refs: [
        { entityId: 'l1', pointIndex: 1 },
        { entityId: 'c1', pointIndex: 0 },
      ],
    },
    { id: 'equal-length', type: 'equal', refs: [{ entityId: 'l0' }, { entityId: 'l1' }] },
  ];
  // Moving one circle needs both construction lines to resize, so projecting a
  // single moved point back onto the constraints restores the old state and
  // hides the motion. Sliding one coordinate exposes it.
  expect(diagnoseFrozenEntities(gcs, entities, constraints, 2)).toEqual([]);
});

it('does not freeze a curve that can slide along a fixed one', () => {
  // The sketch from the field: two fixed points on the axis and a fixed line
  // standing on it, with construction curves from the points to a point held on
  // that line. Every such curve has one degree of freedom left — it slides along
  // the line — so none of them is frozen. The probe moves a point by a quarter
  // of a millimetre, and the coordinates here run to two metres: a tolerance
  // that grew with them swallowed the step, so nothing looked moved and the
  // curves were painted as fully constrained.
  const entities: SketchEntity[] = [
    { id: 'p1', type: 'point', construction: false, x: 0, y: 700 },
    { id: 'p2', type: 'point', construction: false, x: 0, y: 2200 },
    { id: 'L', type: 'line', construction: false, x1: 2000, y1: 0, x2: 2000, y2: 1700 },
    { id: 'A', type: 'line', construction: true, x1: 0, y1: 700, x2: 2000, y2: 1700 },
    { id: 'B', type: 'line', construction: true, x1: 2000, y1: 1700, x2: 0, y2: 2200 },
    { id: 'C', type: 'line', construction: true, x1: 0, y1: 700, x2: 2000, y2: -359 },
    { id: 'D', type: 'line', construction: true, x1: 0, y1: 2200, x2: 2000, y2: 2975 },
  ];
  const settle = (id: string, pointIndex: number, x: number, y: number): SketchConstraint => ({
    id: `${id}-${pointIndex}`,
    type: 'fix',
    refs: [{ entityId: id, pointIndex }],
    x,
    y,
  });
  const constraints: SketchConstraint[] = [
    settle('p1', 0, 0, 700),
    settle('p2', 0, 0, 2200),
    settle('L', 0, 2000, 0),
    settle('L', 1, 2000, 1700),
    { id: 'a0', type: 'coincident', refs: [{ entityId: 'A', pointIndex: 0 }, { entityId: 'p1' }] },
    { id: 'a1', type: 'coincident', refs: [{ entityId: 'A', pointIndex: 1 }, { entityId: 'L', pointIndex: 1 }] },
    { id: 'b0', type: 'coincident', refs: [{ entityId: 'B', pointIndex: 0 }, { entityId: 'L', pointIndex: 1 }] },
    { id: 'b1', type: 'coincident', refs: [{ entityId: 'B', pointIndex: 1 }, { entityId: 'p2' }] },
    { id: 'c0', type: 'coincident', refs: [{ entityId: 'C', pointIndex: 0 }, { entityId: 'p1' }] },
    { id: 'c1', type: 'point-on-line', refs: [{ entityId: 'C', pointIndex: 1 }, { entityId: 'L' }] },
    { id: 'd0', type: 'coincident', refs: [{ entityId: 'D', pointIndex: 0 }, { entityId: 'p2' }] },
    { id: 'd1', type: 'point-on-line', refs: [{ entityId: 'D', pointIndex: 1 }, { entityId: 'L' }] },
  ] as SketchConstraint[];

  const frozen = diagnoseFrozenEntities(gcs, entities, constraints, 2);
  // The fixed handful is frozen; the curves sliding on the line are not.
  expect(frozen.sort()).toEqual(['A', 'B', 'L', 'p1', 'p2']);
});
