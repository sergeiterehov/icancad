import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import { commitTrim, planTrim, trimPreviewEntities } from '../src/sketch/sketchTrim';
import { solveSketch } from '../src/sketch/client';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

function feature(
  entities: SketchEntity[],
  constraints: SketchConstraint[] = [],
): SketchFeature {
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

const line = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  construction = false,
): SketchEntity => ({ id, type: 'line', construction, x1, y1, x2, y2 });

/** A horizontal line crossed at 3 and at 7, and a stub on its far end. */
const crossed = (): SketchEntity[] => [
  line('h', 0, 0, 10, 0),
  line('v1', 3, -5, 3, 5),
  line('v2', 7, -5, 7, 5),
  line('stub', 10, 0, 10, -5),
];

const lineOf = (entity: SketchEntity | undefined) => {
  if (entity?.type !== 'line') throw new Error('EXPECTED_LINE');
  return entity;
};

describe('trim tool', () => {
  it('cuts the piece the pointer stands over, and keeps the rest', () => {
    const result = planTrim(feature(crossed()), [5, 0.2]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { removed, kept, whole } = result.plan.cut;
    expect(whole).toBe(false);
    // The middle piece, between the two crossings.
    expect([lineOf(removed).x1, lineOf(removed).x2]).toEqual([3, 7]);
    expect(kept).toHaveLength(2);
    expect([lineOf(kept[0]?.entity).x1, lineOf(kept[0]?.entity).x2]).toEqual([0, 3]);
    expect([lineOf(kept[1]?.entity).x1, lineOf(kept[1]?.entity).x2]).toEqual([7, 10]);
    // The piece that carries the curve's own start keeps its id, so every
    // relation that names the curve keeps pointing at a curve.
    expect(kept.map((piece) => piece.keepsId)).toEqual([true, false]);
  });

  it('cuts the dangling piece beyond the only crossing', () => {
    const entities = [line('h', 0, 0, 10, 0), line('v', 4, -5, 4, 5)];
    const result = planTrim(feature(entities), [8, 0.1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([lineOf(result.plan.cut.removed).x1, lineOf(result.plan.cut.removed).x2]).toEqual([
      4, 10,
    ]);
    expect(result.plan.cut.kept).toHaveLength(1);
  });

  it('removes a curve nothing crosses whole', () => {
    const lonely = feature([line('a', 0, 0, 10, 0), line('b', 0, 20, 10, 20)]);
    const result = planTrim(lonely, [5, 0.1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cut.whole).toBe(true);
    expect(result.plan.cut.kept).toEqual([]);
    expect(trimPreviewEntities(result.plan)).toEqual([]);
  });

  it('leaves construction curves out of the cut unless they are asked for', () => {
    // The helper crosses the line, but a helper is not what the part is made of.
    const entities = [line('h', 0, 0, 10, 0), line('helper', 5, -5, 5, 5, true)];
    const plain = planTrim(feature(entities), [2, 0.1]);
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.plan.cut.whole).toBe(true);
    expect(plain.plan.cut.source.id).toBe('h');

    const asked = planTrim(feature(entities), [2, 0.1], { construction: true });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    expect(asked.plan.cut.whole).toBe(false);
    expect(asked.plan.cut.removed.type).toBe('line');

    // A helper is not cut by default either, even when it is the nearest curve.
    const helperFirst = planTrim(feature([line('h', 0, 0, 10, 0), line('c', 5, -5, 5, 5, true)]), [
      5, 4.9,
    ]);
    expect(helperFirst.ok).toBe(true);
    if (!helperFirst.ok) return;
    expect(helperFirst.plan.cut.source.id).toBe('h');
  });

  it('refuses a sketch without a curve to cut', () => {
    expect(planTrim(feature([]), [0, 0])).toEqual({ ok: false, error: 'selection' });
  });

  it('turns a cut circle into the arcs that are left', () => {
    const entities: SketchEntity[] = [
      { id: 'c', type: 'circle', construction: false, cx: 0, cy: 0, r: 5 },
      line('a', -10, 0, 10, 0),
      line('b', 0, -10, 0, 10),
    ];
    // Four crossings, so four quarters; the pointer stands on the one in the
    // first quadrant, and the other three stay as arcs of the same circle.
    const result = planTrim(feature(entities), [3.5, 3.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kept = result.plan.cut.kept;
    expect(kept).toHaveLength(3);
    let sweep = 0;
    for (const piece of kept) {
      if (piece.entity.type !== 'arc') throw new Error('EXPECTED_ARC');
      expect(piece.entity.r).toBe(5);
      sweep += Math.abs(piece.entity.endAngle - piece.entity.startAngle);
    }
    expect(sweep).toBeCloseTo((Math.PI * 3) / 2, 6);
    expect(kept.filter((piece) => piece.keepsId)).toHaveLength(1);
    expect(kept.find((piece) => piece.keepsId)?.entity.id).toBe('c');
  });

  it('previews the pieces that stay, not the one that goes', () => {
    const result = planTrim(feature(crossed()), [5, 0.2]);
    if (!result.ok) throw new Error(result.error);
    const preview = trimPreviewEntities(result.plan);
    expect(preview).toHaveLength(2);
    expect(
      preview.some((entity) => entity.type === 'line' && entity.x1 === 3 && entity.x2 === 7),
    ).toBe(false);
  });

  it('moves the relations onto the pieces that carry their points', async () => {
    const entities = crossed();
    const joined = feature(entities, [
      {
        id: 'end',
        type: 'coincident',
        refs: [
          { entityId: 'h', pointIndex: 1 },
          { entityId: 'stub', pointIndex: 0 },
        ],
      },
      {
        id: 'start',
        type: 'coincident',
        refs: [
          { entityId: 'h', pointIndex: 0 },
          { entityId: 'v1', pointIndex: 0 },
        ],
      },
    ]);
    const cut = await commitTrim(joined, [1, 0.1]);
    if (!cut.ok) throw new Error(cut.error);
    const next = cut.commit.feature;
    expect(cut.commit.keptIds).toHaveLength(2);
    expect(next.entities).toHaveLength(entities.length + 1);

    const constraints = next.constraints;
    expect(cut.commit.removedConstraintIds).toEqual(['start']);
    // The joint of the far end is kept and moved; the pieces standing on the
    // crossing are joined to each other where the cut met the vertical line.
    expect(constraints.map((constraint) => constraint.id)[0]).toBe('end');
    expect(constraints.filter((constraint) => constraint.type === 'coincident')).toHaveLength(2);
    const moved = constraints[0]!;
    expect(moved.refs[0]?.entityId).not.toBe('h');
    const piece = next.entities.find((entity) => entity.id === moved.refs[0]?.entityId);
    // The point it names is still the end of the stub.
    expect(lineOf(piece).x2).toBeCloseTo(10, 9);
    expect(moved.refs[0]?.pointIndex).toBe(1);
  });

  it('drops every relation of a curve it removes whole', async () => {
    const lonely = feature(
      [line('a', 0, 0, 10, 0), line('b', 0, 20, 10, 20)],
      [
        { id: 'flat', type: 'horizontal', auto: true, refs: [{ entityId: 'a' }] } as SketchConstraint,
        {
          id: 'gap',
          type: 'distance',
          refs: [
            { entityId: 'a', pointIndex: 0 },
            { entityId: 'b', pointIndex: 0 },
          ],
          value: 20,
        } as SketchConstraint,
      ],
    );
    const cut = await commitTrim(lonely, [5, 0.1]);
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.commit.feature.entities.map((entity) => entity.id)).toEqual(['b']);
    expect(cut.commit.removedConstraintIds).toEqual(['flat', 'gap']);
    expect(cut.commit.feature.constraints).toEqual([]);
  });

  it('holds the cut end on a curve that only runs through the point', async () => {
    // The vertical line crosses the horizontal one in its middle, so there is no
    // point of the sketch at the crossing — the cut end is held on the curve.
    const entities = [line('h', 0, 0, 40, 0), line('v', 20, -10, 20, 10)];
    const cut = await commitTrim(feature(entities), [5, 0.1]);
    if (!cut.ok) throw new Error(cut.error);
    const next = cut.commit.feature;
    expect(next.constraints.map((constraint) => constraint.type)).toEqual(['point-on-line']);
    const joint = next.constraints[0]!;
    // The piece that is left carries the curve's id, and its start is the cut.
    expect(joint.refs[0]).toEqual({ entityId: 'h', pointIndex: 0 });
    expect(joint.refs[1]).toEqual({ entityId: 'v' });
    const piece = next.entities.find((entity) => entity.id === 'h')!;
    expect(lineOf(piece).x1).toBeCloseTo(20, 9);

    // The relation is one the solver knows: the cut end sits on the crossing.
    const solved = await solveSketch(next.entities, next.constraints, [], { diagnose: true });
    expect(solved.conflicting).toEqual([]);
    expect(solved.redundant).toEqual([]);
  });

  it('joins a piece to the point the cut left it standing on', async () => {
    // The vertical line ends on the horizontal one, so cutting the horizontal
    // leaves a piece whose end is the very point the vertical ends at.
    const entities = [line('h', 0, 0, 40, 0), line('v', 20, -10, 20, 0)];
    const cut = await commitTrim(feature(entities), [5, 0.1]);
    if (!cut.ok) throw new Error(cut.error);
    const constraints = cut.commit.feature.constraints;
    expect(constraints.map((constraint) => constraint.type)).toEqual(['coincident']);
    const [first, second] = constraints[0]!.refs;
    const piece = cut.commit.feature.entities.find((entity) => entity.id === first?.entityId)!;
    expect(lineOf(piece).x1).toBeCloseTo(20, 9);
    expect(cut.commit.feature.entities.find((entity) => entity.id === second?.entityId)?.id).toBe(
      'v',
    );
  });
});
