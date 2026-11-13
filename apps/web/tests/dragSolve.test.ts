import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { expect, it, vi } from 'vitest';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const { solveDrag } = await import('../src/sketch/dragSolve');

const top: SketchEntity = {
  id: 'proj-top',
  type: 'line',
  construction: false,
  x1: -10,
  y1: 10,
  x2: 10,
  y2: 10,
};
const right: SketchEntity = {
  id: 'proj-right',
  type: 'line',
  construction: false,
  x1: 10,
  y1: -10,
  x2: 10,
  y2: 10,
};
const local: SketchEntity = {
  id: 'local',
  type: 'line',
  construction: false,
  x1: 8.286431739734004,
  y1: 16.25170111072465,
  x2: 16.599195943195284,
  y2: 8.164462915154974,
};

const constraints: SketchConstraint[] = [
  {
    id: 'c0',
    type: 'point-on-line',
    refs: [
      { entityId: 'local', pointIndex: 0 },
      { entityId: 'proj-top' },
    ],
  },
  {
    id: 'c1',
    type: 'point-on-line',
    refs: [
      { entityId: 'local', pointIndex: 1 },
      { entityId: 'proj-right' },
    ],
  },
];

const entityPins = [
  [
    { entityId: 'local', pointIndex: 0 },
    { entityId: 'local', pointIndex: 1 },
  ],
  [{ entityId: 'local', pointIndex: 0 }],
  [],
];

const line = (entities: SketchEntity[]): Extract<SketchEntity, { type: 'line' }> =>
  entities.find((entity) => entity.id === 'local') as Extract<SketchEntity, { type: 'line' }>;

it('keeps a dragged line on the geometry it is constrained to', async () => {
  const moved: SketchEntity = { ...local, x1: 12, y1: 18, x2: 20, y2: 10 };
  const result = await solveDrag({
    entities: [top, right, moved],
    constraints,
    pinSets: entityPins,
    derived: ['proj-top', 'proj-right'],
  });
  expect(result).not.toBeNull();
  const solved = line(result!.result.entities);
  expect(solved.y1).toBeCloseTo(10, 6);
  expect(solved.x2).toBeCloseTo(10, 6);
});

it('keeps a rigid drag the constraints already allow', async () => {
  const base: SketchEntity = {
    id: 'bar',
    type: 'line',
    construction: false,
    x1: 0,
    y1: 0,
    x2: 10,
    y2: 0,
  };
  const horizontal: SketchConstraint[] = [
    { id: 'h', type: 'horizontal', refs: [{ entityId: 'bar' }] },
  ];
  const moved: SketchEntity = { ...base, x1: 3, y1: 5, x2: 13, y2: 5 };
  const result = await solveDrag({
    entities: [moved],
    constraints: horizontal,
    pinSets: [
      [
        { entityId: 'bar', pointIndex: 0 },
        { entityId: 'bar', pointIndex: 1 },
      ],
      [{ entityId: 'bar', pointIndex: 0 }],
      [],
    ],
    derived: [],
  });
  expect(result).not.toBeNull();
  const solved = result!.result.entities[0] as Extract<SketchEntity, { type: 'line' }>;
  expect(solved.x1).toBeCloseTo(3, 6);
  expect(solved.y1).toBeCloseTo(5, 6);
  expect(solved.x2).toBeCloseTo(13, 6);
  expect(solved.y2).toBeCloseTo(5, 6);
});

it('does not keep a drag that breaks a horizontal constraint', async () => {
  const base: SketchEntity = {
    id: 'bar',
    type: 'line',
    construction: false,
    x1: 0,
    y1: 0,
    x2: 10,
    y2: 0,
  };
  const horizontal: SketchConstraint[] = [
    { id: 'h', type: 'horizontal', refs: [{ entityId: 'bar' }] },
  ];
  const rotated: SketchEntity = { ...base, x1: 3, y1: 5, x2: 12, y2: 9 };
  const result = await solveDrag({
    entities: [rotated],
    constraints: horizontal,
    pinSets: [
      [
        { entityId: 'bar', pointIndex: 0 },
        { entityId: 'bar', pointIndex: 1 },
      ],
      [{ entityId: 'bar', pointIndex: 0 }],
      [],
    ],
    derived: [],
  });
  expect(result).not.toBeNull();
  const solved = result!.result.entities[0] as Extract<SketchEntity, { type: 'line' }>;
  expect(solved.y1).toBeCloseTo(solved.y2, 6);
  expect(solved.y1).not.toBeCloseTo(9, 3);
});

it('does not move geometry held by a fix constraint', async () => {
  const fixed: SketchConstraint[] = [
    {
      id: 'f0',
      type: 'fix',
      refs: [{ entityId: 'local', pointIndex: 0 }],
      x: local.type === 'line' ? local.x1 : 0,
      y: local.type === 'line' ? local.y1 : 0,
    },
    {
      id: 'f1',
      type: 'fix',
      refs: [{ entityId: 'local', pointIndex: 1 }],
      x: local.type === 'line' ? local.x2 : 0,
      y: local.type === 'line' ? local.y2 : 0,
    },
  ];
  const moved: SketchEntity = { ...local, x1: 12, y1: 18, x2: 20, y2: 10 };
  const result = await solveDrag({
    entities: [moved],
    constraints: fixed,
    pinSets: entityPins,
    derived: [],
  });
  const solved = result
    ? line(result.result.entities)
    : (moved as Extract<SketchEntity, { type: 'line' }>);
  expect(solved.x1).toBeCloseTo(local.type === 'line' ? local.x1 : 0, 6);
  expect(solved.y1).toBeCloseTo(local.type === 'line' ? local.y1 : 0, 6);
});
