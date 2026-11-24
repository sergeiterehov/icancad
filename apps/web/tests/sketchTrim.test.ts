import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { commitTrim, planTrim, trimPreviewEntities } from '../src/sketch/sketchTrim';

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

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

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
    const result = planTrim(feature(crossed()), [], [5, 0.2]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { removed, kept } = result.plan.cut;
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
    const result = planTrim(feature(entities), [], [8, 0.1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([lineOf(result.plan.cut.removed).x1, lineOf(result.plan.cut.removed).x2]).toEqual([
      4, 10,
    ]);
    expect(result.plan.cut.kept).toHaveLength(1);
  });

  it('cuts only the selection when there is one', () => {
    const entities = crossed();
    // The pointer is nearer the vertical line, but the horizontal one is chosen.
    const result = planTrim(feature(entities), ['h'], [7.2, -0.1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cut.source.id).toBe('h');
  });

  it('refuses a curve nothing crosses and a selection of no curve', () => {
    const lonely = feature([line('a', 0, 0, 10, 0)]);
    expect(planTrim(lonely, [], [5, 0.1])).toEqual({ ok: false, error: 'no-crossing' });
    expect(planTrim(feature([]), [], [0, 0])).toEqual({ ok: false, error: 'selection' });
  });

  it('turns a cut circle into the arcs that are left', () => {
    const entities: SketchEntity[] = [
      { id: 'c', type: 'circle', construction: false, cx: 0, cy: 0, r: 5 },
      line('a', -10, 0, 10, 0),
      line('b', 0, -10, 0, 10),
    ];
    // Four crossings, so four quarters; the pointer stands on the one in the
    // first quadrant, and the other three stay as arcs of the same circle.
    const result = planTrim(feature(entities), [], [3.5, 3.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kept = result.plan.cut.kept;
    expect(kept).toHaveLength(3);
    let sweep = 0;
    for (const piece of kept) {
      if (piece.entity.type !== 'arc') throw new Error('EXPECTED_ARC');
      expect(piece.entity.r).toBe(5);
      expect(piece.entity.cx).toBe(0);
      sweep += Math.abs(piece.entity.endAngle - piece.entity.startAngle);
    }
    expect(sweep).toBeCloseTo((Math.PI * 3) / 2, 6);
    // The piece that carries the circle's own angle zero keeps its id.
    expect(kept.filter((piece) => piece.keepsId)).toHaveLength(1);
    expect(kept.find((piece) => piece.keepsId)?.entity.id).toBe('c');
  });

  it('previews the pieces that stay, not the one that goes', () => {
    const result = planTrim(feature(crossed()), [], [5, 0.2]);
    if (!result.ok) throw new Error(result.error);
    const preview = trimPreviewEntities(result.plan);
    expect(preview).toHaveLength(2);
    expect(
      preview.some((entity) => entity.type === 'line' && entity.x1 === 3 && entity.x2 === 7),
    ).toBe(false);
  });

  it('moves the relations onto the pieces that carry their points', async () => {
    const entities = crossed();
    const result = await commitTrim(feature(entities), [], [1, 0.1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.commit.feature;
    // The curve is gone and its two pieces stand in its place.
    expect(next.entities.some((entity) => entity.id === 'h')).toBe(true);
    expect(result.commit.keptIds).toHaveLength(2);
    expect(next.entities).toHaveLength(entities.length + 1);

    // A relation on the end the cut left alone follows the piece that ends
    // there; a relation on an end that is gone goes with it.
    const joined = feature(
      entities,
      [
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
      ],
    );
    const cut = await commitTrim(joined, [], [1, 0.1]);
    if (!cut.ok) throw new Error(cut.error);
    const constraints = cut.commit.feature.constraints;
    expect(cut.commit.removedConstraintIds).toEqual(['start']);
    expect(constraints.map((constraint) => constraint.id)).toEqual(['end']);
    const moved = constraints[0]!;
    expect(moved.refs[0]?.entityId).not.toBe('h');
    const piece = cut.commit.feature.entities.find(
      (entity) => entity.id === moved.refs[0]?.entityId,
    );
    // The point it names is still the end of the stub.
    expect(lineOf(piece).x2).toBeCloseTo(10, 9);
    expect(moved.refs[0]?.pointIndex).toBe(1);
  });
});
