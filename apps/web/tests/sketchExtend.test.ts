import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import {
  commitExtend,
  extendPreviewEntities,
  extendTargets,
  planExtend,
} from '../src/sketch/sketchExtend';
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

describe('extend tool', () => {
  it('stretches the end of a line to the pointer, keeping its id', async () => {
    const result = await commitExtend(feature([line('a', 0, 0, 10, 0)]), [25, 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const grown = lineOf(result.commit.feature.entities.find((entity) => entity.id === 'a'));
    expect([grown.x1, grown.x2]).toEqual([0, 25]);
    // Nothing was in the way, so nothing holds the new end.
    expect(result.commit.feature.constraints).toEqual([]);
    expect(result.commit.pointId).toBeNull();
  });

  it('crosses what it passes instead of stopping at it', async () => {
    // The pointer asks for thirty, and the wall at twenty is only on the way.
    const wall = line('wall', 20, -5, 20, 5);
    const result = await commitExtend(feature([line('a', 0, 0, 10, 0), wall]), [30, 0], {
      grip: { entityId: 'a', end: 'end' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const grown = lineOf(result.commit.feature.entities.find((entity) => entity.id === 'a'));
    expect(grown.x2).toBeCloseTo(30, 9);
    // Nothing holds the end: it did not stop on the wall, it went through it.
    expect(result.commit.feature.constraints).toEqual([]);
  });

  it('lands exactly on the curve the pointer is on', async () => {
    // The magnet names the wall, so the end meets it rather than nearly
    // meeting it.
    const wall = line('wall', 20, -5, 20, 5);
    const result = await commitExtend(feature([line('a', 0, 0, 10, 0), wall]), [20.4, 3], {
      grip: { entityId: 'a', end: 'end' },
      snapTo: 'wall',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const grown = lineOf(result.commit.feature.entities.find((entity) => entity.id === 'a'));
    expect(grown.x2).toBeCloseTo(20, 9);
    expect(result.commit.feature.constraints).toEqual([
      expect.objectContaining({
        type: 'point-on-line',
        refs: [
          { entityId: 'a', pointIndex: 1 },
          { entityId: 'wall' },
        ],
      }),
    ]);
  });

  it('joins the end to a point that already stands there', async () => {
    const up = line('up', 20, 0, 20, 5);
    const result = await commitExtend(feature([line('a', 0, 0, 10, 0), up]), [20, 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commit.feature.constraints).toEqual([
      expect.objectContaining({
        type: 'coincident',
        refs: [
          { entityId: 'a', pointIndex: 1 },
          { entityId: 'up', pointIndex: 0 },
        ],
      }),
    ]);
  });

  it('leaves the relations of the old end standing where that end was', async () => {
    // A corner: the line ends on the foot of another one. Stretching the line
    // must not drag the other one, and must not drag the joint either.
    const up = line('up', 10, 0, 10, 10);
    const corner: SketchConstraint = {
      id: 'con-corner',
      type: 'coincident',
      refs: [
        { entityId: 'a', pointIndex: 1 },
        { entityId: 'up', pointIndex: 0 },
      ],
    };
    const result = await commitExtend(
      feature([line('a', 0, 0, 10, 0), up], [corner]),
      [25, 0],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { feature: next, pointId } = result.commit;
    const grown = lineOf(next.entities.find((entity) => entity.id === 'a'));
    expect(grown.x2).toBeCloseTo(25, 9);
    // The corner that was there is now a point of its own, where it stood.
    expect(pointId).not.toBeNull();
    const point = next.entities.find((entity) => entity.id === pointId);
    expect(point).toMatchObject({ type: 'point', x: 10, y: 0 });
    // The joint follows that point, not the end that walked away.
    const joint = next.constraints.find((constraint) => constraint.id === 'con-corner');
    expect(joint?.refs).toEqual([
      { entityId: pointId, pointIndex: 0 },
      { entityId: 'up', pointIndex: 0 },
    ]);
    expect(
      next.constraints.some((constraint) =>
        constraint.refs.some((ref) => ref.entityId === 'a' && ref.pointIndex === 1),
      ),
    ).toBe(false);
  });

  it('holds a dimension of the old end on the point it leaves behind', async () => {
    const length: SketchConstraint = {
      id: 'con-length',
      type: 'distance',
      value: 120,
      refs: [{ entityId: 'a', pointIndex: 1 }],
    };
    const result = await commitExtend(feature([line('a', 0, 0, 10, 0)], [length]), [25, 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { feature: next, pointId } = result.commit;
    expect(next.constraints).toHaveLength(1);
    expect(next.constraints[0]).toMatchObject({
      id: 'con-length',
      value: 120,
      refs: [{ entityId: pointId, pointIndex: 0 }],
    });
    // The sketch still solves where the stretch left it: the dimension holds
    // the point it kept, not the curve that grew.
    const solved = await solveSketch(next.entities, next.constraints, [], {});
    const grown = lineOf(solved.entities.find((entity) => entity.id === 'a'));
    expect(grown.x2).toBeCloseTo(25, 6);
  });

  it('stretches only the end the gesture took hold of', async () => {
    const result = await commitExtend(feature([line('a', 0, 0, 10, 0)]), [-5, 0], {
      grip: { entityId: 'a', end: 'end' },
    });
    // The pointer went the other way, so nothing grows.
    expect(result).toEqual({ ok: false, error: 'inside' });
  });

  it('refuses a pointer over the curve, and a sketch with nothing to stretch', () => {
    expect(planExtend(feature([line('a', 0, 0, 10, 0)]), [5, 1])).toEqual({
      ok: false,
      error: 'inside',
    });
    expect(planExtend(feature([]), [0, 0])).toEqual({ ok: false, error: 'selection' });
  });

  it('leaves construction curves out unless they are asked for', () => {
    const entities = [line('a', 0, 0, 10, 0), line('helper', 0, 5, 10, 5, true)];
    expect(extendTargets(feature(entities)).map((entity) => entity.id)).toEqual(['a']);
    expect(extendTargets(feature(entities), { construction: true }).map((entity) => entity.id)).toEqual(
      ['a', 'helper'],
    );
    // The helper is not in the way of the stretch either.
    const result = planExtend(feature([line('a', 0, 0, 10, 0), line('wall', 20, -5, 20, 5, true)]), [30, 0], {
      grip: { entityId: 'a', end: 'end' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(lineOf(result.plan.entity).x2).toBeCloseTo(30, 9);
    expect(result.plan.landing).toEqual({ points: [], curveIds: [] });
  });

  it('picks the end whose own course runs under the pointer', async () => {
    const entities = [line('a', 0, 0, 10, 0), line('b', 0, 5, 10, 5)];
    const result = planExtend(feature(entities), [25, 5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.source.id).toBe('b');
    expect(result.plan.to[1]).toBeCloseTo(5, 9);
  });

  it('previews the stretched curve in place of the source', () => {
    const result = planExtend(feature([line('a', 0, 0, 10, 0)]), [25, 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preview = extendPreviewEntities(result.plan);
    expect(preview).toHaveLength(1);
    expect(lineOf(preview[0]).x2).toBeCloseTo(25, 9);
  });

  it('grows an arc round its own circle', async () => {
    const arc: SketchEntity = {
      id: 'arc',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0,
      r: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const result = await commitExtend(feature([arc]), [-20, 20], {
      grip: { entityId: 'arc', end: 'end' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const grown = result.commit.feature.entities.find((entity) => entity.id === 'arc');
    expect(grown).toMatchObject({ type: 'arc', cx: 0, cy: 0, r: 10 });
    expect(grown?.type === 'arc' && grown.endAngle).toBeCloseTo((3 * Math.PI) / 4, 9);
  });
});
