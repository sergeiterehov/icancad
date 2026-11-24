import type { SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import { commitFillet, planFillet } from '../src/sketch/sketchFillet';
import { solveSketch } from '../src/sketch/client';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

function feature(entities: SketchEntity[], constraints: SketchFeature['constraints'] = []): SketchFeature {
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

const corner: SketchEntity[] = [
  { id: 'a', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
  { id: 'b', type: 'line', construction: false, x1: 0, y1: 0, x2: 0, y2: 10 },
];

/** A U of three lines with a right-angled corner at each end of the middle one. */
const chain: SketchEntity[] = [
  { id: 'a', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
  { id: 'b', type: 'line', construction: false, x1: 10, y1: 0, x2: 10, y2: 10 },
  { id: 'c', type: 'line', construction: false, x1: 10, y1: 10, x2: 0, y2: 10 },
];

/** A pointer that rides the middle of a fillet of the given radius, 90° corner. */
function pointerFor(radius: number, at: [number, number] = [0, 0]): [number, number] {
  const offset = radius * (1 / Math.SQRT1_2 - 1);
  const step = offset * Math.SQRT1_2;
  return [at[0] + step, at[1] + step];
}

const lineOf = (entities: SketchEntity[], id: string) => {
  const found = entities.find((entity) => entity.id === id);
  if (found?.type !== 'line') throw new Error(`NO_LINE:${id}`);
  return found;
};

const arcsOf = (entities: SketchEntity[]) =>
  entities.filter((entity): entity is Extract<SketchEntity, { type: 'arc' }> =>
    entity.type === 'arc',
  );

describe('fillet tool', () => {
  it('rounds the corner two selected lines share', () => {
    const result = planFillet(feature(corner), ['a', 'b'], pointerFor(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.radius).toBeCloseTo(3, 6);
    const first = lineOf(result.plan.lines, 'a');
    const second = lineOf(result.plan.lines, 'b');
    expect(first.x1).toBeCloseTo(3, 6);
    expect(first.x2).toBeCloseTo(10, 6);
    expect(second.y1).toBeCloseTo(3, 6);
    expect(second.y2).toBeCloseTo(10, 6);
    const [arc] = arcsOf(result.plan.corners.map((entry) => entry.arc));
    expect(arc?.r).toBeCloseTo(3, 6);
    expect(arc?.cx).toBeCloseTo(3, 6);
    expect(arc?.cy).toBeCloseTo(3, 6);
  });

  it('rounds both corners of one selected segment, sharing its radius', () => {
    // Only the middle line is selected: its two ends are the corners to round.
    const pointer = pointerFor(3, [10, 0]);
    const result = planFillet(feature(chain), ['b'], pointer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.corners).toHaveLength(2);
    expect(arcsOf(result.plan.lines.map((line) => line))).toHaveLength(0);
    // The first line keeps its far end and its corner end moves; the middle one
    // is shortened at both of its ends at once.
    expect(lineOf(result.plan.lines, 'a').x2).toBeCloseTo(7, 6);
    const middle = lineOf(result.plan.lines, 'b');
    expect(middle.y1).toBeCloseTo(3, 6);
    expect(middle.y2).toBeCloseTo(7, 6);
    expect(lineOf(result.plan.lines, 'c').x1).toBeCloseTo(7, 6);
    const arcs = arcsOf(result.plan.corners.map((entry) => entry.arc));
    expect(arcs).toHaveLength(2);
    // One pointer, one radius: every corner of the selection takes it.
    for (const arc of arcs) expect(arc.r).toBeCloseTo(3, 6);
    expect(arcs[0]?.cx).toBeCloseTo(7, 6);
    expect(arcs[0]?.cy).toBeCloseTo(3, 6);
    expect(arcs[1]?.cx).toBeCloseTo(7, 6);
    expect(arcs[1]?.cy).toBeCloseTo(7, 6);
  });

  it('rounds the corner a selected point or a selected vertex stands at', () => {
    const marked: SketchEntity[] = [
      ...chain,
      { id: 'p', type: 'point', construction: false, x: 10, y: 0 },
    ];
    const fromPoint = planFillet(feature(marked), ['p'], pointerFor(3, [10, 0]));
    expect(fromPoint.ok).toBe(true);
    if (!fromPoint.ok) return;
    expect(fromPoint.plan.corners).toHaveLength(1);

    // The end of a line is a pick of its own, and names the same corner.
    const fromVertex = planFillet(feature(chain), ['a#1'], pointerFor(3, [10, 0]));
    expect(fromVertex.ok).toBe(true);
    if (!fromVertex.ok) return;
    expect(fromVertex.plan.corners).toHaveLength(1);
    expect(lineOf(fromVertex.plan.lines, 'b').y1).toBeCloseTo(3, 6);
  });

  it('rounds every corner of a multi-selection', () => {
    const result = planFillet(feature(chain), ['a', 'b', 'c'], pointerFor(3, [10, 0]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.corners).toHaveLength(2);
  });

  it('reports a radius the lines cannot give, and a selection without a corner', () => {
    expect(planFillet(feature(corner), ['a', 'b'], [100, 100])).toEqual({
      ok: false,
      error: 'too-large',
    });
    expect(planFillet(feature(corner), ['a', 'b'], [0, 0])).toEqual({ ok: false, error: 'radius' });
    const apart = feature([
      { id: 'a', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'b', type: 'line', construction: false, x1: 0, y1: 5, x2: 10, y2: 5 },
    ]);
    expect(planFillet(apart, ['a', 'b'], pointerFor(3))).toEqual({
      ok: false,
      error: 'selection',
    });
  });

  it('commits the trim, the arc and the relations that hold them', async () => {
    const result = await commitFillet(feature(corner), ['a', 'b'], pointerFor(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.commit.feature;
    expect(next.entities).toHaveLength(3);
    // The lines keep their ids: the trim is the same geometry, shortened.
    expect(result.commit.trimmedIds).toEqual(['a', 'b']);
    const types = next.constraints.reduce(
      (counts, constraint) => ({ ...counts, [constraint.type]: (counts[constraint.type] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    // Two joints, the radius, and the corner's angle. A tangency to each line
    // would repeat what those already say and make the set rank-deficient.
    expect(types).toEqual({ coincident: 2, radius: 1, angle: 1 });
    const radius = next.constraints.find((constraint) => constraint.type === 'radius')!;
    expect(radius.value).toBeCloseTo(3, 6);

    const solved = await solveSketch(next.entities, next.constraints, [], { diagnose: true });
    expect(solved.conflicting).toEqual([]);
    expect(solved.dof).toBeGreaterThan(0);
    expect(solved.frozenEntityIds).toEqual([]);
  });

  it('commits both corners of a chain with their own joints', async () => {
    const result = await commitFillet(feature(chain), ['b'], pointerFor(3, [10, 0]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.commit.feature;
    expect(next.entities).toHaveLength(5);
    expect(result.commit.arcIds).toHaveLength(2);
    const types = next.constraints.reduce(
      (counts, constraint) => ({ ...counts, [constraint.type]: (counts[constraint.type] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    expect(types).toEqual({ coincident: 4, radius: 2, angle: 2 });

    const solved = await solveSketch(next.entities, next.constraints, [], { diagnose: true });
    expect(solved.conflicting).toEqual([]);
    expect(solved.frozenEntityIds).toEqual([]);
  });

  it('drops the joint the corner was made of and leaves the rest where it was', async () => {
    // The corner as a sketch really holds it: the two ends tied by a joint, and
    // a joint further along the chain that the fillet has nothing to do with.
    const joined = feature(
      [
        { id: 'a', type: 'line', construction: false, x1: -10, y1: 0, x2: 0, y2: 0 },
        { id: 'b', type: 'line', construction: false, x1: 0, y1: 0, x2: 0, y2: 10 },
        { id: 'c', type: 'line', construction: false, x1: 0, y1: 10, x2: 0, y2: 20 },
      ],
      [
        {
          id: 'joint',
          type: 'coincident',
          refs: [
            { entityId: 'a', pointIndex: 1 },
            { entityId: 'b', pointIndex: 0 },
          ],
        },
        {
          id: 'other',
          type: 'coincident',
          refs: [
            { entityId: 'b', pointIndex: 1 },
            { entityId: 'c', pointIndex: 0 },
          ],
        },
      ],
    );

    // The corner is picked by its end, so the other end of `a` — which is a
    // corner too — stays as it is.
    const result = await commitFillet(joined, ['a#1'], pointerFor(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.commit.feature;

    // The joint that made the corner is gone — it says the two tangent points
    // are one point, which would collapse the arc — and a joint elsewhere in
    // the sketch is kept.
    expect(result.commit.removedConstraintIds).toEqual(['joint']);
    expect(next.constraints.map((constraint) => constraint.id)).toContain('other');
    expect(next.constraints.map((constraint) => constraint.id)).not.toContain('joint');

    const solved = await solveSketch(next.entities, next.constraints, [], { diagnose: true });
    expect(solved.conflicting).toEqual([]);
    expect(solved.redundant).toEqual([]);

    // The far end of the sketch is exactly where it was, and so is the line
    // that ends there.
    expect(solved.entities.find((entity) => entity.id === 'c')).toEqual(
      joined.entities.find((entity) => entity.id === 'c'),
    );
    expect(lineOf(solved.entities, 'b').y2).toBeCloseTo(10, 9);
  });

  it('holds its radius and its joints when a line is dragged', async () => {
    const result = await commitFillet(feature(corner), ['a', 'b'], pointerFor(3));
    if (!result.ok) throw new Error(result.error);
    const next = result.commit.feature;
    const arcId = result.commit.arcIds[0]!;

    // The fillet is tangent to both lines as committed.
    const committedArc = next.entities.find((entity) => entity.id === arcId)!;
    const committedLine = next.entities.find((entity) => entity.id === 'a')!;
    expect(distanceToLine(committedArc, committedLine)).toBeCloseTo(3, 6);

    // Pull the free end of the horizontal line two millimetres away.
    const dragged = next.entities.map((entity) =>
      entity.id === 'a' && entity.type === 'line'
        ? { ...entity, x2: entity.x2 + 2, y2: entity.y2 + 1 }
        : entity,
    );
    const solved = await solveSketch(dragged, next.constraints, [
      { entityId: 'a', pointIndex: 1 },
    ]);
    expect(solved.conflicting).toEqual([]);

    const arc = solved.entities.find((entity) => entity.id === arcId)!;
    const lineA = solved.entities.find((entity) => entity.id === 'a')!;
    if (arc.type !== 'arc') throw new Error('EXPECTED_GEOMETRY');
    // The fillet keeps its radius and stays all but tangent: a drag of the far
    // end can tilt a joint by a fraction of a degree, but it cannot break it.
    expect(arc.r).toBeCloseTo(3, 3);
    expect(Math.abs(distanceToLine(arc, lineA) - arc.r)).toBeLessThan(0.15);
    // Both joints are still closed.
    const lineB = solved.entities.find((entity) => entity.id === 'b')!;
    if (lineA.type !== 'line' || lineB.type !== 'line') throw new Error('EXPECTED_LINES');
    const firstJoint = Math.hypot(arc.cx + Math.cos(arc.startAngle) * arc.r - lineA.x1, arc.cy + Math.sin(arc.startAngle) * arc.r - lineA.y1);
    const secondJoint = Math.hypot(arc.cx + Math.cos(arc.endAngle) * arc.r - lineB.x1, arc.cy + Math.sin(arc.endAngle) * arc.r - lineB.y1);
    expect(Math.min(firstJoint, secondJoint)).toBeLessThan(1e-2);
  });
});

/** Distance from the centre of an arc to a line. */
function distanceToLine(arc: SketchEntity, line: SketchEntity): number {
  if (arc.type !== 'arc' || line.type !== 'line') return Number.NaN;
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  return Math.abs(((arc.cx - line.x1) * dy - (arc.cy - line.y1) * dx) / length);
}
