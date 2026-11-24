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

  it('keeps an arc one arc: the same centre and the same radius', async () => {
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
    const cut = await commitSplit(feature([arc]), [7.0710678, 7.0710678]);
    if (!cut.ok) throw new Error(cut.error);
    const types = cut.commit.feature.constraints.map((constraint) => constraint.type);
    // The joint at the new point, the same centre, and the same radius.
    expect(types).toEqual(['coincident', 'coincident', 'equal']);
    const centre = cut.commit.feature.constraints[1]!;
    expect(centre.refs.map((ref) => ref.pointIndex)).toEqual([0, 0]);
    const radii = cut.commit.feature.constraints[2]!;
    expect(radii.refs).toHaveLength(2);
    expect(radii.refs[0]?.entityId).not.toBe(radii.refs[1]?.entityId);
  });

  it('keeps an elliptical arc one arc: the same centre and the same axes', async () => {
    const ellipse: SketchEntity = {
      id: 'e',
      type: 'elliptical-arc',
      construction: false,
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 5,
      rotation: 0,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const at = [10 * Math.cos(Math.PI / 4), 5 * Math.sin(Math.PI / 4)] as [number, number];
    const cut = await commitSplit(feature([ellipse]), at);
    if (!cut.ok) throw new Error(cut.error);
    const constraints = cut.commit.feature.constraints;
    // There is no "equal radii" for an ellipse in the solver, so the two axes
    // are points of the arc and are made coincident: the same ellipse.
    expect(constraints.every((constraint) => constraint.type === 'coincident')).toBe(true);
    expect(constraints).toHaveLength(4);
    const indices = constraints.map((constraint) =>
      constraint.refs.map((ref) => ref.pointIndex).sort((a, b) => (a ?? -1) - (b ?? -1)),
    );
    expect(indices).toContainEqual([0, 0]);
    expect(indices).toContainEqual([1, 1]);
    expect(indices).toContainEqual([2, 2]);
    expect(indices).toContainEqual([3, 4]);
  });

  it('joins both places an ellipse meets itself again', async () => {
    // An ellipse is closed: cut once it becomes two elliptical arcs that meet at
    // the new point *and* at the seam. The seam sits exactly on the ellipse's
    // own axis handle, so naming points by position ties a handle instead — the
    // reported bug was one joint in the right place and none at the seam.
    const ellipse: SketchEntity = {
      id: 'e',
      type: 'ellipse',
      construction: false,
      cx: 0,
      cy: 0,
      rx: 20,
      ry: 10,
      rotation: 0,
    };
    // The top of the ellipse: parameter π/2.
    const top: [number, number] = [0, 10];
    const result = planSplit(feature([ellipse]), top);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // An elliptical arc's points are its centre, its two axis handles, its
    // start and its end: 3 and 4 are the ends, 1 and 2 are the handles.
    const named = result.plan.joints.flatMap((joint) => [joint.firstIndex, joint.secondIndex]);
    expect(named.every((index) => index === 3 || index === 4)).toBe(true);
    expect(result.plan.joints).toEqual([
      { firstIndex: 4, secondIndex: 3 },
      { firstIndex: 3, secondIndex: 4 },
    ]);

    const cut = await commitSplit(feature([ellipse]), top);
    if (!cut.ok) throw new Error(cut.error);
    const coincidences = cut.commit.feature.constraints.filter(
      (constraint) => constraint.type === 'coincident',
    );
    // Two joints at the ends, the same centre and the same Y axis. The X axis is
    // not tied again: a closed ellipse is cut from its own angle zero, so the
    // seam joint already ties the handles that stand there.
    expect(coincidences).toHaveLength(4);
    const atEnds = coincidences.filter((constraint) =>
      constraint.refs.every((ref) => ref.pointIndex === 3 || ref.pointIndex === 4),
    );
    expect(atEnds).toHaveLength(2);
    const handles = coincidences.flatMap((constraint) =>
      constraint.refs.map((ref) => ref.pointIndex),
    );
    expect(handles).not.toContain(1);
  });

  it('ties both axes of an open elliptical arc', async () => {
    // An open arc has no seam, so nothing else ties its X axis.
    const open: SketchEntity = {
      id: 'ea',
      type: 'elliptical-arc',
      construction: false,
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 5,
      rotation: 0,
      startAngle: Math.PI / 4,
      endAngle: (3 * Math.PI) / 2,
    };
    const at = [10 * Math.cos(Math.PI / 2), 5 * Math.sin(Math.PI / 2)] as [number, number];
    const result = planSplit(feature([open]), at);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const indices = result.plan.ties.flatMap((tie) => tie.refs.map((ref) => ref.pointIndex));
    expect(indices).toContain(0);
    expect(indices).toContain(1);
    expect(indices).toContain(2);
  });

  it('keeps a split line as one line: the pieces only meet', async () => {
    const cut = await commitSplit(feature([line('a', 0, 0, 40, 0)]), [15, 0]);
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.commit.feature.constraints.map((constraint) => constraint.type)).toEqual([
      'coincident',
    ]);
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
    // A circle becomes arcs, so it is held together like an arc: same centre,
    // same radius — plus the two joints.
    expect(result.plan.ties.map((tie) => tie.type)).toEqual(['coincident', 'equal']);
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
