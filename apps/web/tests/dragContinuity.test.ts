import type { SketchEntity } from '@icancad/model';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SketchSolveResult, SolverPin } from '../src/sketch/protocol';

vi.mock('../src/sketch/client', () => ({ solveSketch: vi.fn() }));

const { solveSketch } = await import('../src/sketch/client');
const { solveDrag } = await import('../src/sketch/dragSolve');

const dragged: SketchEntity = {
  id: 'a',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 0,
};
const other: SketchEntity = {
  id: 'b',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 1,
  x2: 1,
  y2: 1,
};
const previous = [dragged, other];

const movedOther = (offset: number): SketchEntity => ({
  ...other,
  x1: other.x1 + offset,
  x2: other.x2 + offset,
});

const result = (entities: SketchEntity[], conflicting: string[] = []): SketchSolveResult => ({
  entities,
  status: 'success',
  conflicting,
  redundant: [],
  dof: 0,
  frozenEntityIds: [],
});

const pins = [[{ entityId: 'a', pointIndex: 0 }]];

beforeEach(() => {
  vi.mocked(solveSketch).mockReset();
});

it('rejects a same-axis solution that jumps the rest of the sketch', async () => {
  vi.mocked(solveSketch).mockImplementation(async (_entities, _constraints, attempt = []) => {
    if (attempt.length === 1 && !attempt[0]?.axis) return result(previous, ['conflict']);
    return result([dragged, movedOther(10)]);
  });

  const solved = await solveDrag({
    entities: previous,
    constraints: [],
    pinSets: pins,
    prefer: 'one:y',
    allowAxisSwitch: false,
    previous,
    movedEntityId: 'a',
    maxMove: 2,
  });

  // The jump is rejected; the sketch stays where it was instead of reporting
  // a solver conflict.
  expect(solved?.attempt).toBe('fixed');
  expect(solved?.result.entities).toBe(previous);
});

it('accepts a continuous axis solution', async () => {
  vi.mocked(solveSketch).mockImplementation(async (_entities, _constraints, attempt = []) => {
    if (attempt.length === 1 && !attempt[0]?.axis) return result(previous, ['conflict']);
    if (attempt.length === 0) return result([dragged, movedOther(0.2)]);
    return result([dragged, movedOther(0.2)]);
  });

  const solved = await solveDrag({
    entities: previous,
    constraints: [],
    pinSets: pins,
    prefer: 'one:y',
    allowAxisSwitch: false,
    previous,
    movedEntityId: 'a',
    maxMove: 2,
  });

  expect(solved?.attempt).toBe('one:y');
});

it('stays on the pinned axis after the one allowed switch', async () => {
  const calls: SolverPin[][] = [];
  vi.mocked(solveSketch).mockImplementation(async (_entities, _constraints, attempt = []) => {
    calls.push(attempt);
    return result(previous, ['conflict']);
  });

  await solveDrag({
    entities: previous,
    constraints: [],
    pinSets: pins,
    prefer: 'one:x',
    allowAxisSwitch: false,
    previous,
    movedEntityId: 'a',
    maxMove: 2,
  });

  expect(calls.some((attempt) => attempt[0]?.axis === 'y')).toBe(false);
});

it('switches the pinned axis while the drag still allows it', async () => {
  vi.mocked(solveSketch).mockImplementation(async (entities, _constraints, attempt = []) => {
    if (attempt.length === 1 && !attempt[0]?.axis) return result(previous, ['conflict']);
    if (attempt.length === 0) return result(entities);
    if (attempt[0]?.axis === 'x') return result(previous, ['conflict']);
    return result([dragged, movedOther(0.2)]);
  });

  const solved = await solveDrag({
    entities: previous,
    constraints: [],
    pinSets: pins,
    prefer: 'one:x',
    allowAxisSwitch: true,
    previous,
    movedEntityId: 'a',
    maxMove: 2,
  });

  expect(solved?.attempt).toBe('one:y');
});
