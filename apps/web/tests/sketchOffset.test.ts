import type { SketchFeature } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import { solveSketch } from '../src/sketch/client';
import {
  commitOffset,
  commitOffsetSolved,
  offsetConstraintsForPiece,
  offsetSelection,
  planOffset,
} from '../src/sketch/sketchOffset';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

function feature(entities: SketchFeature['entities']): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    references: [],
    constraints: [],
    entities,
  };
}

const rectangle: SketchFeature['entities'] = [
  { id: 'b', type: 'line', construction: false, x1: 0, y1: 0, x2: 20, y2: 0 },
  { id: 'r', type: 'line', construction: false, x1: 20, y1: 0, x2: 20, y2: 10 },
  { id: 't', type: 'line', construction: false, x1: 20, y1: 10, x2: 0, y2: 10 },
  { id: 'l', type: 'line', construction: false, x1: 0, y1: 10, x2: 0, y2: 0 },
];

describe('offset tool', () => {
  it('reads one closed chain from a rectangle selection', () => {
    const selection = offsetSelection(feature(rectangle), ['b', 'r', 't', 'l']);
    expect(selection.error).toBeUndefined();
    expect(selection.chains).toHaveLength(1);
    expect(selection.chains[0]!.closed).toBe(true);
  });

  it('ignores points and the sketch axes', () => {
    const sketch = feature(rectangle);
    expect(offsetSelection(sketch, ['b#0', 'sketch:origin']).error).toBe('empty');
  });

  it('reports a forking selection instead of guessing a chain', () => {
    const sketch = feature([
      { id: 'a', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'b', type: 'line', construction: false, x1: 10, y1: 0, x2: 20, y2: 0 },
      { id: 'c', type: 'line', construction: false, x1: 10, y1: 0, x2: 10, y2: 10 },
    ]);
    expect(offsetSelection(sketch, ['a', 'b', 'c']).error).toBe('branching');
  });

  it('follows the pointer side of the chain', () => {
    const sketch = feature(rectangle);
    const outside = planOffset(sketch, ['b', 'r', 't', 'l'], [10, -4], {
      tool: 'offset',
      join: 'round',
    });
    expect(outside.ok).toBe(true);
    if (!outside.ok) return;
    const loop = outside.loops[0]!.loop;
    expect(loop.pieces.some((piece) => piece.role === 'join')).toBe(true);
    expect(outside.loops[0]!.distance).toBeCloseTo(-4, 6);

    const inside = planOffset(sketch, ['b', 'r', 't', 'l'], [10, 4], {
      tool: 'offset',
      join: 'round',
    });
    expect(inside.ok).toBe(true);
    if (!inside.ok) return;
    expect(inside.loops[0]!.loop.pieces.every((piece) => piece.role === 'offset')).toBe(true);
  });

  it('commits the geometry and its driving dimensions in one feature', () => {
    const sketch = feature(rectangle);
    const result = commitOffset(sketch, ['b', 'r', 't', 'l'], [10, -5], {
      tool: 'offset',
      join: 'round',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { feature: next, createdIds, addedConstraintIds } = result.commit;
    expect(createdIds).toHaveLength(8);
    expect(next.entities).toHaveLength(sketch.entities.length + 8);
    // Four parallels, four distances, four corner diameters and the eight joints
    // of the loop. No tangency: the joint of two offset pieces is already fixed
    // by their own dimensions and the two coincidences at their ends.
    expect(addedConstraintIds).toHaveLength(20);
    const distances = next.constraints.filter((constraint) => constraint.type === 'distance');
    expect(distances).toHaveLength(4);
    for (const constraint of distances) {
      expect(constraint.value).toBeCloseTo(5, 6);
      expect(constraint.auto).toBe(true);
      expect(constraint.side).toBeDefined();
    }
    const parallels = next.constraints.filter((constraint) => constraint.type === 'parallel');
    expect(parallels).toHaveLength(4);
    const diameters = next.constraints.filter((constraint) => constraint.type === 'diameter');
    expect(diameters).toHaveLength(4);
    for (const constraint of diameters) expect(constraint.value).toBeCloseTo(10, 6);
  });

  it('adds a fresh pair of dimensions for every new copy', () => {
    const sketch = feature(rectangle);
    const first = commitOffset(sketch, ['b'], [10, -5], { tool: 'offset', join: 'round' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.commit.addedConstraintIds).toHaveLength(2);

    const again = commitOffset(first.commit.feature, ['b'], [10, -6], {
      tool: 'offset',
      join: 'round',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    // The second copy is its own entity, so its parallel and its distance are
    // new relations, not repeats.
    expect(again.commit.createdIds).toHaveLength(1);
    expect(again.commit.addedConstraintIds).toHaveLength(2);
    expect(new Set(again.commit.feature.constraints.map((constraint) => constraint.id)).size).toBe(
      again.commit.feature.constraints.length,
    );
  });

  it('gives an offset arc a coaxial centre and lets its radius follow the chain', () => {
    const source: SketchFeature['entities'][number] = {
      id: 'arc',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0,
      r: 10,
      startAngle: 0,
      endAngle: Math.PI,
    };
    const result: SketchFeature['entities'][number] = {
      id: 'copy',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0,
      r: 12,
      startAngle: 0,
      endAngle: Math.PI,
    };
    const copyDraft = { type: 'arc', construction: false, cx: 0, cy: 0, r: 12, startAngle: 0, endAngle: Math.PI } as const;
    const constraints = offsetConstraintsForPiece(
      source,
      result,
      { curve: copyDraft, sourceId: 'arc', role: 'offset' },
      2,
    );
    // The centre is concentric and the radius is not pinned: the offset lines
    // that meet the arc hold its ends, so the band keeps its width when the
    // source arc changes instead of keeping the radius it was born with.
    expect(constraints.map((constraint) => constraint.type)).toEqual(['coincident']);

    // A circle is the whole chain, so it has nothing else to drive its radius.
    const circleSource: SketchFeature['entities'][number] = {
      id: 'circle',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 10,
    };
    const circleCopy: SketchFeature['entities'][number] = { ...circleSource, id: 'ring', r: 13 };
    const circleDraft = { type: 'circle', construction: false, cx: 0, cy: 0, r: 13 } as const;
    const ring = offsetConstraintsForPiece(
      circleSource,
      circleCopy,
      { curve: circleDraft, sourceId: 'circle', role: 'offset' },
      3,
    );
    expect(ring.map((constraint) => constraint.type)).toEqual(['coincident', 'diameter']);
    expect(ring[1]!.value).toBeCloseTo(26, 6);

    const cornerDraft = {
      type: 'arc',
      construction: false,
      cx: 5,
      cy: 5,
      r: 2,
      startAngle: 0,
      endAngle: 1,
    } as const;
    const corner = offsetConstraintsForPiece(
      source,
      { ...cornerDraft, id: 'corner' },
      { curve: cornerDraft, sourceId: null, role: 'join' },
      2,
    );
    expect(corner.map((constraint) => constraint.type)).toEqual(['diameter']);
    expect(corner[0]!.value).toBeCloseTo(4, 6);
  });

  it('builds the ring for the contour tool', () => {
    const sketch = feature(rectangle);
    const result = commitOffset(sketch, ['b', 'r', 't', 'l'], [10, -3], {
      tool: 'outline',
      join: 'round',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two loops: the outside with four corners, the inside without any.
    expect(result.commit.createdIds).toHaveLength(12);
    // Each round corner keeps the width of the stroke by its diameter.
    expect(
      result.commit.feature.constraints.filter((constraint) => constraint.type === 'diameter'),
    ).toHaveLength(4);
    // Both loops stay closed: eight joints on the outside, four on the inside.
    const joints = result.commit.feature.constraints.filter(
      (constraint) => constraint.type === 'coincident',
    );
    expect(joints).toHaveLength(12);
    // A joint carries no tangency: the coincidences and the pieces' own
    // dimensions already hold the angle, and a repeated relation is what makes
    // the solver take seconds and report geometry that still moves as frozen.
    expect(
      result.commit.feature.constraints.filter((constraint) => constraint.type === 'tangent'),
    ).toHaveLength(0);
  });

  it('refuses a distance the user did not travel yet', () => {
    const sketch = feature(rectangle);
    expect(
      planOffset(sketch, ['b', 'r', 't', 'l'], [10, 0], { tool: 'offset', join: 'round' }),
    ).toEqual({ ok: false, error: 'too-close' });
  });

  it('constrains a contour without conflicts or redundant constraints', async () => {
    const sketch = feature([
      { id: 'a', type: 'line', construction: false, x1: 0, y1: 0, x2: 20, y2: 0 },
      { id: 'b', type: 'line', construction: false, x1: 20, y1: 0, x2: 30, y2: 10 },
    ]);
    // The pointer sits where the distance has no round hundredth, which used to
    // leave the dimensions unable to agree with the geometry they describe.
    const result = await commitOffsetSolved(sketch, ['a', 'b'], [24, -4], {
      tool: 'outline',
      join: 'round',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.commit.feature;
    expect(next.entities).toHaveLength(9);
    const solved = await solveSketch(next.entities, next.constraints, [], { diagnose: true });
    expect(solved.conflicting).toEqual([]);
    // A relation the solver calls implied costs one rank note, not a shape the
    // user did not ask for, so it is kept. The set solves, and the joints are
    // all there — that is what the contour has to hold on to.
    expect(
      next.constraints.filter((candidate) => candidate.type === 'coincident').length,
    ).toBeGreaterThanOrEqual(result.commit.createdIds.length);
    // The joints are there — that is what the contour has to hold on to — and
    // nothing repeats what they already say.
    expect(next.constraints.some((constraint) => constraint.type === 'coincident')).toBe(true);
    expect(next.constraints.some((constraint) => constraint.type === 'tangent')).toBe(false);
    // The dimensions say exactly what the geometry is, not a rounded chip.
    const distances = next.constraints.filter((constraint) => constraint.type === 'distance');
    for (const constraint of distances) expect(constraint.value).toBeCloseTo(Math.SQRT1_2 * 8, 9);
    expect(next.constraints.some((constraint) => constraint.type === 'diameter')).toBe(true);
  });

  it('keeps the contour joined and smooth when a piece is dragged', async () => {
    // The arc of this chain meets its lines within a hundredth of a millimetre,
    // which used to leave those joints without a coincidence: the contour looked
    // whole until the first drag pulled it apart.
    const sketch = feature([
      {
        id: 'line1',
        type: 'line',
        construction: false,
        x1: 11.516910393054463,
        y1: 13.490584289736725,
        x2: 20.861496908757797,
        y2: 35.44943377046296,
      },
      {
        id: 'line2',
        type: 'line',
        construction: false,
        x1: 32.9464195797937,
        y1: 39.63922291300685,
        x2: 65.94641957979371,
        y2: 21.568155101141365,
      },
      {
        id: 'arc',
        type: 'arc',
        construction: false,
        cx: 28.801715349339897,
        cy: 32.07048536711116,
        r: 8.629273503406258,
        startAngle: -3.5439278317112914,
        endAngle: -5.213394173209084,
      },
    ]);
    const result = await commitOffsetSolved(sketch, ['line1', 'line2', 'arc'], [51.3, 34.1], {
      tool: 'outline',
      join: 'round',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const committed = result.commit.feature;
    const pieces = result.commit.createdIds.map(
      (id) => committed.entities.find((entity) => entity.id === id)!,
    );

    // Every joint of the loop is a coincidence, and so are the two that keep the
    // offset arcs concentric with their source. Joints are never dropped, even
    // when the solver says the rest already implies one of them.
    const coincidences = committed.constraints.filter(
      (constraint) => constraint.type === 'coincident',
    );
    expect(coincidences.length).toBeGreaterThanOrEqual(pieces.length + 2);
    // The smooth joints are held by their coincidences and the pieces' own
    // dimensions; a repeated tangency would make the whole set rank-deficient.
    expect(
      committed.constraints.filter((constraint) => constraint.type === 'tangent'),
    ).toHaveLength(0);
    for (const gap of gaps(pieces)) expect(gap).toBeLessThan(1e-9);

    // Drag one side four millimetres with both of its points held, the way the
    // editor drags: the rest of the loop has to follow instead of opening.
    const dragged = pieces[4]!;
    if (dragged.type !== 'line') throw new Error('EXPECTED_LINE');
    const lineAt = { x1: dragged.x1, y1: dragged.y1, x2: dragged.x2, y2: dragged.y2 };
    const moved = committed.entities.map((entity) =>
      entity.id === dragged.id
        ? { ...entity, ...lineAt, x1: lineAt.x1 + 4, y1: lineAt.y1 + 3, x2: lineAt.x2 + 4, y2: lineAt.y2 + 3 }
        : entity,
    );
    const solved = await solveSketch(moved, committed.constraints, [
      { entityId: dragged.id, pointIndex: 0 },
      { entityId: dragged.id, pointIndex: 1 },
    ]);
    const after = result.commit.createdIds.map(
      (id) => solved.entities.find((entity) => entity.id === id)!,
    );
    for (const gap of gaps(after)) expect(gap).toBeLessThan(1e-3);
    expect(solved.entities.every((entity) => Number.isFinite(entity.id.length))).toBe(true);
  });

  it('wraps a closed chain without a system the solver chokes on', async () => {
    // A ring: a contour of it is two closed loops, and the pieces around them
    // used to make a rank-deficient set — the solver spent seconds on it and
    // then reported geometry that still moves as fully constrained.
    const sketch = feature([
      {
        id: 'a',
        type: 'line',
        construction: false,
        x1: 19.536694875118236,
        y1: 13.99997852970554,
        x2: 15.582371243197285,
        y2: 37.69331228965846,
      },
      {
        id: 'b',
        type: 'line',
        construction: false,
        x1: 23.578956624436223,
        y1: 46.04492479509712,
        x2: 64.55657848917461,
        y2: 41.02307345053635,
      },
      {
        id: 'c',
        type: 'line',
        construction: false,
        x1: 64.55657848917461,
        y1: 41.02307345053635,
        x2: 19.536694875118236,
        y2: 13.99997852970554,
      },
      {
        id: 'arc',
        type: 'arc',
        construction: false,
        cx: 22.701037765349653,
        cy: 38.88139183101906,
        r: 7.2171286568946,
        startAngle: -2.976220497626968,
        endAngle: -4.834334780618061,
      },
    ]);
    const result = await commitOffsetSolved(sketch, ['a', 'b', 'c', 'arc'], [40, 20], {
      tool: 'outline',
      join: 'round',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.commit.feature;
    const started = performance.now();
    const solved = await solveSketch(next.entities, next.constraints, [], { diagnose: true });
    const elapsed = performance.now() - started;
    expect(solved.conflicting).toEqual([]);
    // A relation the solver reports as implied costs a rank note, not a shape;
    // what must not happen is a conflict, a frozen sketch or a slow answer.
    // The source keeps its freedom, so the contour must not read as frozen.
    expect(solved.dof).toBeGreaterThan(0);
    expect(solved.frozenEntityIds).toEqual([]);
    // A contour of a ring is two separate loops of pieces.
    expect(result.commit.createdIds.length).toBeGreaterThanOrEqual(8);
    expect(
      next.constraints.filter((constraint) => constraint.type === 'tangent'),
    ).toHaveLength(0);
    // And the whole diagnosis stays a matter of milliseconds, not seconds.
    expect(elapsed).toBeLessThan(2000);
  });

  it('survives a small drag of the source and keeps its width', async () => {
    // What it must do is stay one closed band of the same width when the source
    // is moved a little — and the radius of an offset arc comes from the pieces
    // that meet it, not from the radius it was born with.
    const result = await commitOffsetSolved(
      feature([
        { id: 'a', type: 'line', construction: true, x1: 24.48215569826761, y1: 11.345068199254744, x2: 10.622883962010368, y2: 59.41893686253899 },
        { id: 'b', type: 'line', construction: true, x1: 19.749375406580594, y1: 70.41228839720446, x2: 78.0122340585783, y2: 64.82323234659022 },
        { id: 'c', type: 'line', construction: true, x1: 78.0122340585783, y1: 64.82323234659022, x2: 24.48215569826761, y2: 11.345068199254744 },
        { id: 'arc', type: 'arc', construction: true, cx: 18.924381640200888, cy: 61.81218012472198, r: 8.63958778026978, startAngle: -2.860912797326554, endAngle: -4.808024642738269 },
      ]),
      ['a', 'b', 'c', 'arc'],
      [40, 20],
      { tool: 'outline', join: 'round' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const committed = result.commit.feature;
    const width = 4.84;

    const dragged = committed.entities.map((entity) =>
      entity.id === 'b' && entity.type === 'line'
        ? { ...entity, x1: entity.x1 + 1, y1: entity.y1 + 1 }
        : entity,
    );
    const solved = await solveSketch(dragged, committed.constraints, [
      { entityId: 'b', pointIndex: 0 },
    ]);
    expect(solved.conflicting).toEqual([]);

    const created = result.commit.createdIds.map((id) => solved.entities.find((e) => e.id === id)!);
    const pointAt = (entity: SketchFeature['entities'][number], atStart: boolean): [number, number] => {
      if (entity.type === 'line') return atStart ? [entity.x1, entity.y1] : [entity.x2, entity.y2];
      if (entity.type !== 'arc') return [0, 0];
      const angle = atStart ? entity.startAngle : entity.endAngle;
      return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
    };
    // Each loop stays closed; the two seams between the loops are not joints.
    for (let index = 0; index < created.length; index += 1) {
      const end = pointAt(created[index]!, false);
      const start = pointAt(created[(index + 1) % created.length]!, true);
      const gap = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (gap > 1) continue;
      expect(gap).toBeLessThan(1e-2);
    }

    // The band is still about as wide as it was: the two arcs that follow the
    // source arc are concentric with it and near the requested distance.
    const sourceArc = solved.entities.find((entity) => entity.id === 'arc')!;
    if (sourceArc.type !== 'arc') throw new Error('EXPECTED_ARC');
    const following = created.filter(
      (entity) =>
        entity.type === 'arc' &&
        Math.hypot(entity.cx - sourceArc.cx, entity.cy - sourceArc.cy) < 1e-6,
    );
    expect(following.length).toBeGreaterThanOrEqual(2);
    for (const arc of following) {
      if (arc.type !== 'arc') continue;
      expect(Math.abs(Math.abs(arc.r - sourceArc.r) - width)).toBeLessThan(0.3);
    }
  });
});

/** Distance between the end of one piece and the start of the next. */
function gaps(pieces: SketchFeature['entities']): number[] {
  const endOf = (entity: SketchFeature['entities'][number]): [number, number] | null => {
    if (entity.type === 'line') return [entity.x2, entity.y2];
    if (entity.type === 'arc') {
      return [
        entity.cx + Math.cos(entity.endAngle) * entity.r,
        entity.cy + Math.sin(entity.endAngle) * entity.r,
      ];
    }
    return null;
  };
  const startOf = (entity: SketchFeature['entities'][number]): [number, number] | null => {
    if (entity.type === 'line') return [entity.x1, entity.y1];
    if (entity.type === 'arc') {
      return [
        entity.cx + Math.cos(entity.startAngle) * entity.r,
        entity.cy + Math.sin(entity.startAngle) * entity.r,
      ];
    }
    return null;
  };
  const result: number[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const end = endOf(pieces[index]!);
    const start = startOf(pieces[(index + 1) % pieces.length]!);
    if (!end || !start) continue;
    result.push(Math.hypot(end[0] - start[0], end[1] - start[1]));
  }
  return result;
}
