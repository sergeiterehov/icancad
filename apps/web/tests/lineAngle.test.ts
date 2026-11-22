import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import {
  applyConstraintAction,
  applyConstraintValue,
  buildConstraintActions,
} from '../src/sketch/constraintModel';
import { solveSketch } from './planegcsSolve';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const line = (id: string, degrees: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: Math.cos((degrees * Math.PI) / 180) * 10,
  y2: Math.sin((degrees * Math.PI) / 180) * 10,
});

const axis: SketchEntity = {
  id: 'sketch:x-axis',
  type: 'line',
  construction: true,
  x1: -100,
  y1: 0,
  x2: 100,
  y2: 0,
};

function feature(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    references: [],
    constraints,
    entities,
  };
}

function lineAngle(entity: SketchEntity | undefined): number {
  if (entity?.type !== 'line') throw new Error('NOT_A_LINE');
  return (Math.atan2(entity.y2 - entity.y1, entity.x2 - entity.x1) * 180) / Math.PI;
}

async function angleConstraint(startAngle: number) {
  const start = feature([line('b', startAngle), axis]);
  const action = buildConstraintActions(start, ['b', 'sketch:x-axis']).find(
    (candidate) => candidate.type === 'angle',
  )!;
  const applied = await applyConstraintAction(start, action);
  return {
    feature: applied.feature,
    constraint: applied.feature.constraints.find((candidate) => candidate.type === 'angle')!,
  };
}

describe('angle between a line and an axis', () => {
  it('keeps the line on the side it was drawn on', async () => {
    for (const degrees of [45, 135, -45, 20]) {
      const { feature: applied } = await angleConstraint(degrees);
      const after = applied.entities.find((entity) => entity.id === 'b');
      expect(lineAngle(after)).toBeCloseTo(degrees, 6);
    }
  });

  it('stores a magnitude and the turn as a hidden side', async () => {
    const up = await angleConstraint(45);
    expect(up.constraint).toMatchObject({ value: 45, side: -1 });
    const down = await angleConstraint(-45);
    expect(down.constraint).toMatchObject({ value: 45, side: 1 });
  });

  it('turns the line the way the value says, and never stores a negative angle', async () => {
    const { feature: applied, constraint } = await angleConstraint(45);
    const at = async (typed: number) => {
      const next = await applyConstraintValue(applied, constraint.id, typed);
      return {
        angle: lineAngle(next.entities.find((entity) => entity.id === 'b')),
        stored: next.constraints.find((candidate) => candidate.id === constraint.id)!,
      };
    };
    expect(await at(60)).toMatchObject({ angle: expect.closeTo(60, 6) });
    // A negative value turns the line over rather than being stored as a minus.
    const mirrored = await at(-60);
    expect(mirrored.angle).toBeCloseTo(-60, 6);
    expect(mirrored.stored).toMatchObject({ value: 60, side: 1 });
    // A full turn between two lines is the same line again.
    const wrapped = await at(200);
    expect(wrapped.stored.value).toBe(20);
    expect(wrapped.angle).toBeCloseTo(20, 6);
  });

  it('solves to the requested angle when the line starts elsewhere', async () => {
    const { feature: applied, constraint } = await angleConstraint(45);
    const next = await applyConstraintValue(applied, constraint.id, 30);
    expect(lineAngle(next.entities.find((entity) => entity.id === 'b'))).toBeCloseTo(30, 6);
    const solved = await solvePreserved(next);
    expect(solved).toBe(true);
  });
});

/** The stored constraint still describes the solved geometry. */
async function solvePreserved(next: SketchFeature): Promise<boolean> {
  const constraint = next.constraints.find((candidate) => candidate.type === 'angle')!;
  const result = await solveSketch(next.entities, next.constraints, []);
  expect(result.conflicting).toEqual([]);
  const after = result.entities.find((entity) => entity.id === constraint.refs[0]!.entityId);
  return Math.abs(lineAngle(after) - Number(constraint.value)) < 0.01;
}
