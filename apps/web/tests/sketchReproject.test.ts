import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { solveSketch } from '../src/sketch/client';
import type { SketchSolveResult } from '../src/sketch/protocol';
import { solveReprojectedSketch } from '../src/sketch/reproject';

vi.mock('../src/sketch/client', () => ({ solveSketch: vi.fn() }));

const solve = vi.mocked(solveSketch);

const projected: SketchEntity = {
  id: 'proj-edge',
  type: 'line',
  construction: true,
  x1: 0,
  y1: 0,
  x2: 20,
  y2: 0,
};

const constrained: SketchEntity = {
  id: 'line',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 10,
  x2: 20,
  y2: 10,
};

const tie: SketchConstraint = {
  id: 'c1',
  type: 'coincident',
  refs: [
    { entityId: 'line', pointIndex: 1 },
    { entityId: 'proj-edge', pointIndex: 1 },
  ],
};

function solved(
  entities: SketchEntity[],
  conflicting: string[] = [],
): SketchSolveResult {
  return {
    entities,
    conflicting,
    status: conflicting.length > 0 ? 'failed' : 'converged',
    redundant: [],
    dof: 0,
    frozenEntityIds: [],
  };
}

function sketch(constraints: SketchConstraint[]): SketchFeature {
  return {
    id: 'feat_sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [projected, constrained],
    constraints,
    references: [],
    projections: [
      {
        id: 'proj1',
        entityId: 'proj-edge',
        source: { kind: 'edge', bodyId: 'body-1', name: 'fixture/edge' },
      },
    ],
  };
}

describe('solving a sketch again after its projections moved', () => {
  beforeEach(() => {
    solve.mockReset();
  });

  it('uses the solved geometry when the constraints still hold', async () => {
    const solvedEntities = [{ ...constrained, x2: 30 }, projected];
    solve.mockResolvedValue(solved(solvedEntities));
    await expect(solveReprojectedSketch(sketch([tie]), [projected, constrained])).resolves.toEqual({
      entities: solvedEntities,
      conflict: false,
    });
    expect(solve).toHaveBeenCalledWith([projected, constrained], [tie], [], {
      derived: ['proj-edge'],
    });
  });

  it('reports a conflict instead of hiding the mismatch', async () => {
    solve.mockResolvedValue(solved([], ['c1']));
    await expect(solveReprojectedSketch(sketch([tie]), [projected, constrained])).resolves.toEqual({
      entities: null,
      conflict: true,
    });
  });

  it('has nothing to solve without constraints', async () => {
    await expect(solveReprojectedSketch(sketch([]), [projected, constrained])).resolves.toEqual({
      entities: null,
      conflict: false,
    });
    expect(solve).not.toHaveBeenCalled();
  });

  it('does not blame the constraints when the solver fails to run', async () => {
    solve.mockRejectedValue(new Error('solver crashed'));
    await expect(solveReprojectedSketch(sketch([tie]), [projected, constrained])).resolves.toEqual({
      entities: null,
      conflict: false,
    });
  });
});
