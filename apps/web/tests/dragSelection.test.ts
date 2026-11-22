import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  dragPinSets,
  isSelectionConstrained,
  movableEntities,
  moveDraggedEntities,
} from '../src/sketch/dragSelection';

const line = (id: string, y: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1: 0,
  y1: y,
  x2: 10,
  y2: y,
});

const circle: SketchEntity = {
  id: 'circle',
  type: 'circle',
  construction: false,
  cx: 4,
  cy: 4,
  r: 2,
};

const entities = [line('a', 0), line('b', 5), circle];

function entityById(id: string): SketchEntity {
  return entities.find((candidate) => candidate.id === id)!;
}

describe('moveDraggedEntities', () => {
  it('moves every entity of the set by the pointer delta', () => {
    const moved = moveDraggedEntities({
      entities,
      grabbed: { id: 'a', mode: 'entity', pointIndex: null, original: entityById('a') },
      movedIds: ['a', 'circle'],
      target: [3, -2],
      reference: [0, 0],
    });
    expect(moved[0]).toMatchObject({ x1: 3, y1: -2, x2: 13, y2: -2 });
    expect(moved[1]).toEqual(entityById('b'));
    expect(moved[2]).toMatchObject({ cx: 7, cy: 2, r: 2 });
  });

  it('moves only the grabbed handle when a point is dragged', () => {
    const moved = moveDraggedEntities({
      entities,
      grabbed: { id: 'a', mode: 'point', pointIndex: 1, original: entityById('a') },
      movedIds: ['a', 'b'],
      target: [7, 3],
      reference: [10, 0],
    });
    expect(moved[0]).toMatchObject({ x1: 0, y1: 0, x2: 7, y2: 3 });
    expect(moved[1]).toEqual(entityById('b'));
  });
});

describe('isSelectionConstrained', () => {
  it('sees a constraint on any entity of the set', () => {
    const constraints = [
      {
        id: 'c',
        type: 'horizontal' as const,
        refs: [{ entityId: 'circle' }],
      },
    ];
    expect(isSelectionConstrained(constraints, ['a'])).toBe(false);
    expect(isSelectionConstrained(constraints, ['a', 'circle'])).toBe(true);
  });
});

describe('dragPinSets', () => {
  it('holds the whole shape of every group member before falling back', () => {
    const sets = dragPinSets({
      grabbed: { id: 'a', mode: 'entity', pointIndex: null, original: entityById('a') },
      movedIds: ['a', 'circle'],
      startPoint: [0, 0],
      entities,
    });
    // Two line ends and the centre plus radius handle of the circle: the group
    // keeps the shapes it was drawn with instead of being re-solved into others.
    expect(sets[0]).toEqual([
      { entityId: 'a', pointIndex: 0 },
      { entityId: 'a', pointIndex: 1 },
      { entityId: 'circle', pointIndex: 0 },
      { entityId: 'circle', pointIndex: 1 },
    ]);
    expect(sets[1]).toEqual([
      { entityId: 'a', pointIndex: 0 },
      { entityId: 'circle', pointIndex: 0 },
    ]);
    expect(sets[2]).toEqual([
      { entityId: 'a', pointIndex: 0 },
      { entityId: 'a', pointIndex: 1 },
    ]);
  });

  it('keeps the single pin for a point drag', () => {
    const sets = dragPinSets({
      grabbed: { id: 'a', mode: 'point', pointIndex: 1, original: entityById('a') },
      movedIds: ['a'],
      startPoint: [10, 0],
    });
    expect(sets).toEqual([[{ entityId: 'a', pointIndex: 1 }]]);
  });
});

describe('movableEntities', () => {
  it('leaves geometry without degrees of freedom behind', () => {
    expect(movableEntities(['a', 'b#1', 'circle'], ['b'])).toEqual(['a', 'circle']);
  });

  it('keeps one id per entity', () => {
    expect(movableEntities(['a#0', 'a#1', 'a'], [])).toEqual(['a']);
  });
});
