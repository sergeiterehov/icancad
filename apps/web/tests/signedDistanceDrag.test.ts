import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { expect, it, vi } from 'vitest';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const { solveDrag } = await import('../src/sketch/dragSolve');

const circle: SketchEntity = {
  id: 'c',
  type: 'circle',
  construction: false,
  cx: 0,
  cy: 0,
  r: 5,
};

const constraints: SketchConstraint[] = [
  { id: 'fix', type: 'fix', refs: [{ entityId: 'c', pointIndex: 0 }], x: 0, y: 0 },
  { id: 'radius', type: 'radius', refs: [{ entityId: 'c' }], value: 5 },
  {
    id: 'distance',
    type: 'distance',
    refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'c' }],
    value: 5,
    side: 1,
  },
];

const pins = [[{ entityId: 'p', pointIndex: 0 }]];

function pointAt(x: number, y: number): SketchEntity {
  return { id: 'p', type: 'point', construction: false, x, y };
}

it('does not oscillate while dragging a point held by a signed circle distance', async () => {
  const positions: Array<[number, number]> = [];
  for (let angle = 0; angle <= 90; angle += 10) {
    const radians = (angle * Math.PI) / 180;
    // The pointer is a little outside the allowed circle, as a real drag is.
    const target = pointAt(Math.cos(radians) * 11, Math.sin(radians) * 11);
    const result = await solveDrag({
      entities: [circle, target],
      constraints,
      pinSets: pins,
      derived: [],
    });
    expect(result).not.toBeNull();
    const solved = result!.result.entities.find((entity) => entity.id === 'p');
    expect(solved?.type).toBe('point');
    if (solved?.type !== 'point') return;
    positions.push([solved.x, solved.y]);
  }
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1]!;
    const current = positions[index]!;
    expect(Math.hypot(current[0] - previous[0], current[1] - previous[1])).toBeLessThan(3);
  }
  for (const [x, y] of positions) {
    expect(Math.hypot(x, y)).toBeCloseTo(10, 1);
  }
});

it('does not oscillate while dragging a point held by a signed arc distance', async () => {
  const arc: SketchEntity = {
    id: 'a',
    type: 'arc',
    construction: false,
    cx: 0,
    cy: 0,
    r: 5,
    startAngle: -0.4,
    endAngle: Math.PI + 0.4,
  };
  const arcConstraints: SketchConstraint[] = [
    { id: 'fix', type: 'fix', refs: [{ entityId: 'a', pointIndex: 0 }], x: 0, y: 0 },
    {
      id: 'distance',
      type: 'distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'a' }],
      value: 5,
      side: 1,
    },
  ];
  const positions: Array<[number, number]> = [];
  const radii: number[] = [];
  for (let angle = 0; angle <= 90; angle += 10) {
    const radians = (angle * Math.PI) / 180;
    const target = pointAt(Math.cos(radians) * 12, Math.sin(radians) * 12);
    const result = await solveDrag({
      entities: [arc, target],
      constraints: arcConstraints,
      pinSets: pins,
      derived: [],
    });
    expect(result).not.toBeNull();
    const solvedPoint = result!.result.entities.find((entity) => entity.id === 'p');
    const solvedArc = result!.result.entities.find((entity) => entity.id === 'a');
    expect(solvedPoint?.type).toBe('point');
    expect(solvedArc?.type).toBe('arc');
    if (solvedPoint?.type !== 'point' || solvedArc?.type !== 'arc') return;
    positions.push([solvedPoint.x, solvedPoint.y]);
    radii.push(solvedArc.r);
  }
  expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(2);
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1]!;
    const current = positions[index]!;
    expect(Math.hypot(current[0] - previous[0], current[1] - previous[1])).toBeLessThan(6);
  }
});

it('keeps a free arc stable while its point distance is dragged', async () => {
  const arc: SketchEntity = {
    id: 'a',
    type: 'arc',
    construction: false,
    cx: 0,
    cy: 0,
    r: 5,
    startAngle: -0.4,
    endAngle: Math.PI + 0.4,
  };
  const arcConstraints: SketchConstraint[] = [
    {
      id: 'distance',
      type: 'distance',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'a' }],
      value: 5,
      side: 1,
    },
  ];
  const centers: Array<[number, number]> = [];
  for (let angle = 0; angle <= 90; angle += 10) {
    const radians = (angle * Math.PI) / 180;
    const target = pointAt(Math.cos(radians) * 12, Math.sin(radians) * 12);
    const result = await solveDrag({
      entities: [arc, target],
      constraints: arcConstraints,
      pinSets: pins,
      derived: [],
    });
    const solvedArc = result?.result.entities.find((entity) => entity.id === 'a');
    expect(solvedArc?.type).toBe('arc');
    if (solvedArc?.type !== 'arc') return;
    centers.push([solvedArc.cx, solvedArc.cy]);
  }
  for (let index = 1; index < centers.length; index += 1) {
    const previous = centers[index - 1]!;
    const current = centers[index]!;
    expect(Math.hypot(current[0] - previous[0], current[1] - previous[1])).toBeLessThan(5);
  }
});
