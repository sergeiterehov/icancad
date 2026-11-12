import { describe, expect, it } from 'vitest';
import type { SplitSolid } from '@icancad/kernel';
import { splitAssignment, splitBodyId } from '../src/kernel/splitBodies';

function solid(id: string, volume: number, center: [number, number, number]): SplitSolid {
  return {
    shapeId: id,
    facesFromShape: [],
    stats: { faces: 0, edges: 0, solids: 1 },
    volume,
    center,
  };
}

describe('split body assignment', () => {
  it('keeps the largest part as the original body', () => {
    const assignment = splitAssignment([
      solid('small', 100, [0, 0, 0]),
      solid('large', 300, [20, 0, 0]),
      solid('middle', 200, [40, 0, 0]),
    ]);
    expect(assignment?.main.shapeId).toBe('large');
    expect(assignment?.extras.map((part) => part.shapeId)).toEqual(['middle', 'small']);
  });

  it('orders equal parts by position so names do not jump', () => {
    const assignment = splitAssignment([
      solid('right', 200, [20, 0, 0]),
      solid('left', 200, [-20, 0, 0]),
    ]);
    expect(assignment?.main.shapeId).toBe('left');
    expect(assignment?.extras.map((part) => part.shapeId)).toEqual(['right']);
    expect(splitAssignment([solid('only', 200, [0, 0, 0])])).toBeNull();
  });

  it('builds a stable id from the operation and the source body', () => {
    expect(splitBodyId('feat_1', 'body-2', 1)).toBe('feat_1:split:body-2:1');
  });
});
