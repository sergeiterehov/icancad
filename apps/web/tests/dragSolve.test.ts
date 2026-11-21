import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { expect, it, vi } from 'vitest';
import { constraintsSatisfied } from '../src/sketch/constraintModel';

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

// The curved slot of the sample holder: two concentric arcs closed by two
// tangent end caps, all tied to a construction circle whose centre and diameter
// are fixed. Dragging it by a constrained centre must not look like a solver
// conflict.
const slotEntities: SketchEntity[] = [
  {
    id: 'slot-ring',
    type: 'circle',
    construction: true,
    cx: -2.85,
    cy: 0,
    r: 18.935,
  },
  { id: 'slot-hole', type: 'circle', construction: false, cx: -2.85, cy: 0, r: 1.75 },
  {
    id: 'slot-inner',
    type: 'arc',
    construction: false,
    cx: -2.85,
    cy: 0,
    r: 17.168782487173036,
    startAngle: -2.9110637160610877,
    endAngle: -3.3721208970147685,
  },
  {
    id: 'slot-outer',
    type: 'arc',
    construction: false,
    cx: -2.85,
    cy: 0,
    r: 20.668782487173036,
    startAngle: -2.9110637829105497,
    endAngle: -3.3721215363490016,
  },
  {
    id: 'slot-cap-b',
    type: 'arc',
    construction: false,
    cx: -21.268299167554787,
    cy: 4.3227984652787,
    r: 1.75,
    startAngle: -3.3721217942592685,
    endAngle: -6.513720204365894,
  },
  {
    id: 'slot-cap-e',
    type: 'arc',
    construction: false,
    cx: -21.268299167554787,
    cy: -4.3227984652787,
    r: 1.75,
    startAngle: -2.9110636555935576,
    endAngle: 0.23052808752003986,
  },
];

const slotConstraints: SketchConstraint[] = [
  {
    id: 'slot-on-axis',
    type: 'point-on-line',
    refs: [{ entityId: 'slot-ring', pointIndex: 0 }, { entityId: 'sketch:x-axis' }],
  },
  { id: 'slot-ring-diameter', type: 'diameter', refs: [{ entityId: 'slot-ring' }], value: 37.87 },
  {
    id: 'slot-ring-origin',
    type: 'distance',
    refs: [
      { entityId: 'slot-ring', pointIndex: 0 },
      { entityId: 'sketch:origin', pointIndex: 0 },
    ],
    value: 2.85,
  },
  {
    id: 'slot-hole-centre',
    type: 'coincident',
    refs: [
      { entityId: 'slot-hole', pointIndex: 0 },
      { entityId: 'slot-ring', pointIndex: 0 },
    ],
  },
  { id: 'slot-hole-diameter', type: 'diameter', refs: [{ entityId: 'slot-hole' }], value: 3.5 },
  {
    id: 'slot-inner-centre',
    type: 'coincident',
    refs: [
      { entityId: 'slot-inner', pointIndex: 0 },
      { entityId: 'slot-hole', pointIndex: 0 },
    ],
  },
  {
    id: 'slot-outer-centre',
    type: 'coincident',
    refs: [
      { entityId: 'slot-outer', pointIndex: 0 },
      { entityId: 'slot-inner', pointIndex: 0 },
    ],
  },
  {
    id: 'slot-e-inner',
    type: 'coincident',
    refs: [
      { entityId: 'slot-cap-e', pointIndex: 2 },
      { entityId: 'slot-inner', pointIndex: 1 },
    ],
  },
  {
    id: 'slot-b-inner',
    type: 'coincident',
    refs: [
      { entityId: 'slot-cap-b', pointIndex: 2 },
      { entityId: 'slot-inner', pointIndex: 2 },
    ],
  },
  {
    id: 'slot-b-inner-tangent',
    type: 'tangent',
    refs: [{ entityId: 'slot-cap-b' }, { entityId: 'slot-inner' }],
  },
  {
    id: 'slot-inner-e-tangent',
    type: 'tangent',
    refs: [{ entityId: 'slot-inner' }, { entityId: 'slot-cap-e' }],
  },
  {
    id: 'slot-outer-e-tangent',
    type: 'tangent',
    refs: [{ entityId: 'slot-outer' }, { entityId: 'slot-cap-e' }],
  },
  {
    id: 'slot-caps-equal',
    type: 'equal',
    refs: [{ entityId: 'slot-cap-b' }, { entityId: 'slot-cap-e' }],
  },
  {
    id: 'slot-b-outer',
    type: 'coincident',
    refs: [
      { entityId: 'slot-cap-b', pointIndex: 1 },
      { entityId: 'slot-outer', pointIndex: 2 },
    ],
  },
  {
    id: 'slot-e-outer',
    type: 'coincident',
    refs: [
      { entityId: 'slot-cap-e', pointIndex: 1 },
      { entityId: 'slot-outer', pointIndex: 1 },
    ],
  },
  {
    id: 'slot-cap-radius',
    type: 'equal',
    refs: [{ entityId: 'slot-cap-b' }, { entityId: 'slot-hole' }],
  },
  {
    id: 'slot-caps-vertical',
    type: 'vertical',
    refs: [
      { entityId: 'slot-cap-b', pointIndex: 0 },
      { entityId: 'slot-cap-e', pointIndex: 0 },
    ],
  },
];

it('keeps a fully constrained slot point where it is instead of reporting a conflict', async () => {
  const centre = slotEntities.find((entity) => entity.id === 'slot-outer')!;
  if (centre.type !== 'arc') throw new Error('arc expected');
  const moved = slotEntities.map((entity) =>
    entity.id === 'slot-outer' ? { ...centre, cx: centre.cx + 0.7, cy: centre.cy + 0.4 } : entity,
  );
  const result = await solveDrag({
    entities: moved,
    constraints: slotConstraints,
    pinSets: [[{ entityId: 'slot-outer', pointIndex: 0 }]],
    previous: slotEntities,
    movedEntityId: 'slot-outer',
    maxMove: 5,
  });
  expect(result).not.toBeNull();
  expect(result!.attempt).toBe('fixed');
  const solved = result!.result.entities.find((entity) => entity.id === 'slot-outer')!;
  if (solved.type !== 'arc') throw new Error('arc expected');
  expect(solved.cx).toBeCloseTo(centre.cx, 6);
  expect(solved.cy).toBeCloseTo(centre.cy, 6);
});

it('turns the slot by dragging an arc endpoint and keeps every constraint', async () => {
  const outer = slotEntities.find((entity) => entity.id === 'slot-outer')!;
  if (outer.type !== 'arc') throw new Error('arc expected');
  const point = [
    outer.cx + Math.cos(outer.startAngle) * outer.r,
    outer.cy + Math.sin(outer.startAngle) * outer.r,
  ] as [number, number];
  const target: [number, number] = [point[0] + 0.5, point[1] + 0.5];
  const angle = Math.atan2(target[1] - outer.cy, target[0] - outer.cx);
  const moved = slotEntities.map((entity) =>
    entity.id === 'slot-outer'
      ? { ...entity, r: Math.hypot(target[0] - outer.cx, target[1] - outer.cy), startAngle: angle }
      : entity,
  );
  const result = await solveDrag({
    entities: moved,
    constraints: slotConstraints,
    pinSets: [[{ entityId: 'slot-outer', pointIndex: 1 }]],
    previous: slotEntities,
    movedEntityId: 'slot-outer',
    maxMove: 5,
  });
  expect(result).not.toBeNull();
  expect(result!.attempt).not.toBe('fixed');
  expect(constraintsSatisfied(slotConstraints, result!.result.entities)).toBe(true);
});
