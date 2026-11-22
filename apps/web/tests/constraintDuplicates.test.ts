import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { sketchEntityIndex } from '@icancad/sketch';
import { describe, expect, it, vi } from 'vitest';
import {
  applyConstraintAction,
  buildConstraintActions,
  constraintKey,
  constraintsForAction,
  uniqueConstraints,
} from '../src/sketch/constraintModel';

vi.mock('../src/sketch/client', () => ({
  solveSketch: vi.fn(async (entities: SketchEntity[]) => ({
    entities,
    conflicting: [],
    redundant: [],
    frozenEntityIds: [],
    dof: 0,
    status: 'success',
  })),
}));

const point = (id: string, x: number, y: number): SketchEntity => ({
  id,
  type: 'point',
  construction: false,
  x,
  y,
});
const line = (id: string, y = 0): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1: 0,
  y1: y,
  x2: 10,
  y2: y + 1,
});

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints,
    references: [],
  };
}

function action(feature: SketchFeature, keys: string[], type: SketchConstraint['type']) {
  return buildConstraintActions(feature, keys).find((candidate) => candidate.type === type);
}

describe('constraint identity', () => {
  it('treats a point reference with and without an index as the same target', () => {
    const entities = new Map([['p', point('p', 1, 2)]]);
    expect(constraintKey({ id: 'a', type: 'fix', refs: [{ entityId: 'p' }] }, entities)).toBe(
      constraintKey({ id: 'b', type: 'fix', refs: [{ entityId: 'p', pointIndex: 0 }] }, entities),
    );
  });

  it('ignores the order of the mirrored pair but keeps the symmetry center', () => {
    const entities = new Map([
      ['a', point('a', 0, 0)],
      ['b', point('b', 1, 0)],
      ['c', point('c', 2, 0)],
      ['l', line('l', 0)],
    ]);
    const symmetry = (refs: SketchConstraint['refs']) => ({
      id: 's',
      type: 'symmetric' as const,
      refs,
    });
    expect(
      constraintKey(symmetry([{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'l' }]), entities),
    ).toBe(
      constraintKey(symmetry([{ entityId: 'b' }, { entityId: 'a' }, { entityId: 'l' }]), entities),
    );
    expect(
      constraintKey(symmetry([{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'c' }]), entities),
    ).not.toBe(
      constraintKey(symmetry([{ entityId: 'a' }, { entityId: 'c' }, { entityId: 'b' }]), entities),
    );
  });

  it('ignores the order of a coincidence but keeps the order of an angle', () => {
    const entities = new Map([
      ['a', point('a', 0, 0)],
      ['b', point('b', 1, 0)],
      ['l1', line('l1', 0)],
      ['l2', line('l2', 5)],
    ]);
    expect(
      constraintKey(
        { id: 'c', type: 'coincident', refs: [{ entityId: 'a' }, { entityId: 'b' }] },
        entities,
      ),
    ).toBe(
      constraintKey(
        { id: 'd', type: 'coincident', refs: [{ entityId: 'b' }, { entityId: 'a' }] },
        entities,
      ),
    );
    expect(
      constraintKey(
        { id: 'e', type: 'angle', refs: [{ entityId: 'l1' }, { entityId: 'l2' }] },
        entities,
      ),
    ).not.toBe(
      constraintKey(
        { id: 'f', type: 'angle', refs: [{ entityId: 'l2' }, { entityId: 'l1' }] },
        entities,
      ),
    );
  });
});

describe('duplicate constraints', () => {
  it('keeps one of two identical constraints', () => {
    const entities = new Map([
      ['a', point('a', 0, 0)],
      ['b', point('b', 1, 0)],
    ]);
    const existing: SketchConstraint[] = [
      { id: 'one', type: 'coincident', refs: [{ entityId: 'a' }, { entityId: 'b' }] },
    ];
    const added = uniqueConstraints(
      [
        {
          id: 'two',
          type: 'coincident',
          refs: [
            { entityId: 'b', pointIndex: 0 },
            { entityId: 'a', pointIndex: 0 },
          ],
        },
      ],
      existing,
      entities,
    );
    expect(added).toEqual([]);
  });

  it('filters a group pair by pair', () => {
    const feature = sketch(
      [line('a'), line('b', 5), line('c', 10)],
      [{ id: 'ab', type: 'equal', refs: [{ entityId: 'a' }, { entityId: 'b' }] }],
    );
    const equal = action(feature, ['a', 'b', 'c'], 'equal')!;
    const expanded = constraintsForAction(equal, sketchEntityIndex(feature.entities));
    const added = uniqueConstraints(
      expanded,
      feature.constraints,
      sketchEntityIndex(feature.entities),
    );
    expect(expanded.map((constraint) => constraint.refs.map((ref) => ref.entityId))).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ]);
    expect(added.map((constraint) => constraint.refs.map((ref) => ref.entityId))).toEqual([
      ['a', 'c'],
    ]);
  });

  it('hides an action that already exists', () => {
    const feature = sketch([line('l')], [{ id: 'v', type: 'vertical', refs: [{ entityId: 'l' }] }]);
    const types = buildConstraintActions(feature, ['l']).map((candidate) => candidate.type);
    expect(types).not.toContain('vertical');
    // A line cannot be both vertical and horizontal, so the opposite is hidden too.
    expect(types).not.toContain('horizontal');
    expect(types).toContain('distance');
  });

  it('hides a numeric action when the same dimension exists', () => {
    const feature = sketch(
      [point('a', 0, 0), point('b', 5, 0)],
      [
        {
          id: 'd',
          type: 'distance',
          refs: [
            { entityId: 'b', pointIndex: 0 },
            { entityId: 'a', pointIndex: 0 },
          ],
          value: 5,
        },
      ],
    );
    expect(action(feature, ['a#0', 'b#0'], 'distance')).toBeUndefined();
  });

  it('adds nothing and asks for no editor when every expanded constraint exists', async () => {
    const feature = sketch(
      [point('a', 0, 0), point('b', 5, 0)],
      [
        {
          id: 'd',
          type: 'distance',
          refs: [
            { entityId: 'a', pointIndex: 0 },
            { entityId: 'b', pointIndex: 0 },
          ],
          value: 5,
        },
      ],
    );
    const result = await applyConstraintAction(feature, {
      key: 'distance',
      type: 'distance',
      refs: [
        { entityId: 'a', pointIndex: 0 },
        { entityId: 'b', pointIndex: 0 },
      ],
      value: 10,
    });
    expect(result.feature).toBe(feature);
    expect(result.editConstraintId).toBeNull();
  });

  it('opens the editor for a numeric constraint it actually created', async () => {
    const feature = sketch([line('l')]);
    const result = await applyConstraintAction(feature, {
      key: 'distance',
      type: 'distance',
      refs: [{ entityId: 'l' }],
      value: 10,
    });
    expect(result.editConstraintId).toBe(result.feature.constraints[0]?.id);
    expect(result.feature.constraints).toHaveLength(1);
    expect(result.feature.constraints[0]).toMatchObject({ type: 'distance', value: 10 });
  });
});
