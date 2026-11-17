import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { expect, it, vi } from 'vitest';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const { solveDrag } = await import('../src/sketch/dragSolve');

const line: SketchEntity = {
  id: 'line',
  type: 'line',
  construction: false,
  x1: -10,
  y1: -10,
  x2: 10,
  y2: 10,
};
const point: SketchEntity = { id: 'point', type: 'point', construction: false, x: 0, y: 0 };
const constraints: SketchConstraint[] = [
  {
    id: 'on-line',
    type: 'point-on-line',
    refs: [{ entityId: 'point', pointIndex: 0 }, { entityId: 'line' }],
  },
];

it('moves a point to the nearest place on its constraint surface', async () => {
  const target: [number, number] = [3, 0];
  const solved = await solveDrag({
    entities: [line, { ...point, x: target[0], y: target[1] }],
    constraints,
    pinSets: [[{ entityId: 'point', pointIndex: 0 }]],
    derived: ['line'],
    previous: [line, point],
  });

  expect(solved?.attempt).toBe('nearest');
  const result = solved!.result.entities.find(
    (entity): entity is Extract<SketchEntity, { type: 'point' }> => entity.id === 'point',
  )!;
  // Pinning x would put the point at (3, 3), three units from the cursor.
  expect(Math.hypot(result.x - target[0], result.y - target[1])).toBeLessThan(2.5);
});
