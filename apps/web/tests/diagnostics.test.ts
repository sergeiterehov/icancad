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
