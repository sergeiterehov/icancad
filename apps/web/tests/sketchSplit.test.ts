import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import { commitSplit, planSplit, splitPreviewEntities } from '../src/sketch/sketchSplit';
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

const lineOf = (entity: SketchEntity | undefined) => {
  if (entity?.type !== 'line') throw new Error('EXPECTED_LINE');
  return entity;
};

describe('split tool', () => {
  it('splits the curve under the pointer into two pieces that meet there', () => {
    const result = planSplit(feature([line('a', 0, 0, 10, 0)]), [2.5, 0.4]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { first, second, at, joints } = result.plan;
    expect(at.point[0]).toBeCloseTo(2.5, 6);
    expect(at.point[1]).toBeCloseTo(0, 6);
    expect([lineOf(first.entity).x1, lineOf(first.entity).x2]).toEqual([0, 2.5]);
    expect([lineOf(second.entity).x1, lineOf(second.entity).x2]).toEqual([2.5, 10]);
    // The first piece keeps the curve's id; the point between them is a joint.
    expect(first.keepsId).toBe(true);
    expect(joints).toEqual([{ firstIndex: 1, secondIndex: 0 }]);
  });

  it('splits the curve nearest the pointer, and only a non-construction one by default', () => {
    const entities = [line('a', 0, 0, 10, 0), line('b', 0, 3, 10, 3), line('c', 0, 6, 10, 6, true)];
    const onB = planSplit(feature(entities), [5, 2.7]);
    expect(onB.ok).toBe(true);
    if (!onB.ok) return;
    expect(onB.plan.source.id).toBe('b');

    // The pointer stands on the helper, which does not take part unless asked.
    const helper = planSplit(feature([line('a', 0, 0, 10, 0), line('c', 0, 6, 10, 6, true)]), [5, 6]);
    expect(helper.ok).toBe(true);
    if (!helper.ok) return;
    expect(helper.plan.source.id).toBe('a');

    const asked = planSplit(feature([line('a', 0, 0, 10, 0), line('c', 0, 6, 10, 6, true)]), [5, 6], {
      construction: true,
    });
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    expect(asked.plan.source.id).toBe('c');
  });

  it('refuses a point on an end, and a sketch with nothing to split', () => {
    expect(planSplit(feature([line('a', 0, 0, 10, 0)]), [0.01, 0.1])).toEqual({
      ok: false,
      error: 'end',
    });
    expect(planSplit(feature([]), [0, 0])).toEqual({ ok: false, error: 'selection' });
  });

  it('names the joint points an arc really has', () => {
    // An arc's points are its centre, its start and its end — not its ends' own
    // order. A joint written against index 0 would tie a piece's end to the
    // other piece's centre, and the solver answers that by collapsing both arcs.
    const arc: SketchEntity = {
      id: 'a',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0,
      r: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const result = planSplit(feature([arc]), [7.0710678, 7.0710678]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The first piece runs from the arc's start to the new point: the new end is
    // its index 2; the second piece starts at the new point, its index 1.
    expect(result.plan.joints).toEqual([{ firstIndex: 2, secondIndex: 1 }]);
  });

  it('turns a circle into two arcs that meet at the new point and at its seam', () => {
    const circle: SketchEntity = { id: 'c', type: 'circle', construction: false, cx: 0, cy: 0, r: 5 };
    const result = planSplit(feature([circle]), [0, 5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.first.entity.type).toBe('arc');
    expect(result.plan.second.entity.type).toBe('arc');
    // Both halves are arcs of the same circle, and they meet twice: at the new
    // point and at the seam the circle already had.
    expect(result.plan.joints).toHaveLength(2);
    for (const joint of result.plan.joints) {
      expect(joint.firstIndex).toBeGreaterThanOrEqual(1);
      expect(joint.secondIndex).toBeGreaterThanOrEqual(1);
    }
  });

  it('previews the two pieces the curve will be', () => {
    const result = planSplit(feature([line('a', 0, 0, 10, 0)]), [4, 0.2]);
    if (!result.ok) throw new Error(result.error);
    expect(splitPreviewEntities(result.plan)).toHaveLength(2);
  });

  it('commits two pieces, a joint between them, and keeps every relation', async () => {
    const joined = feature(
      [line('a', 0, 0, 10, 0), line('b', 10, 0, 10, 5)],
      [
        {
          id: 'far',
          type: 'coincident',
          refs: [
            { entityId: 'a', pointIndex: 1 },
            { entityId: 'b', pointIndex: 0 },
          ],
        },
        { id: 'flat', type: 'horizontal', auto: true, refs: [{ entityId: 'a' }] } as SketchConstraint,
      ],
    );
    const split = await commitSplit(joined, [4, 0.2]);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const next = split.commit.feature;

    expect(next.entities).toHaveLength(3);
    expect(split.commit.keptIds).toHaveLength(2);
    expect(split.commit.removedConstraintIds).toEqual([]);
    // The relation on the far end moved to the piece that carries that end; the
    // relation on the curve as a whole stayed with the piece that kept its id.
    const far = next.constraints.find((constraint) => constraint.id === 'far')!;
    const piece = next.entities.find((entity) => entity.id === far.refs[0]?.entityId)!;
    expect(lineOf(piece).x2).toBeCloseTo(10, 6);
    expect(far.refs[0]?.pointIndex).toBe(1);
    const flat = next.constraints.find((constraint) => constraint.id === 'flat')!;
    expect(flat.refs[0]?.entityId).toBe('a');
    expect(next.constraints.filter((constraint) => constraint.type === 'coincident')).toHaveLength(2);

    const solved = await solveSketch(next.entities, next.constraints, [], { diagnose: true });
    expect(solved.conflicting).toEqual([]);
    expect(solved.redundant).toEqual([]);
  });
});
