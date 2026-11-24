import type { SketchConstraint, SketchFeature } from '@icancad/model';
import { polygonApothem } from '@icancad/sketch';
import { describe, expect, it, vi } from 'vitest';
import { solveSketch } from '../src/sketch/client';
import { polygonGeometry, polygonSides } from '../src/sketch/sketchPolygon';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

/** The sketch a tool builds is not a feature yet; a solve only needs the parts. */
function sketchOf(entities: SketchFeature['entities'], constraints: SketchConstraint[]): SketchFeature {
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

const hexagon = () => polygonGeometry({ centre: [0, 0], corner: [10, 0], cursor: [5, 8.66] })!;
const square = () => polygonGeometry({ centre: [0, 0], corner: [10, 0], cursor: [0, 10] })!;

const sideLength = (line: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(line.x2 - line.x1, line.y2 - line.y1);

describe('polygon tool', () => {
  it('draws one line per edge and one construction circle', () => {
    const geometry = hexagon();
    expect(geometry.sides).toBe(6);
    expect(geometry.lines).toHaveLength(6);
    expect(geometry.circle).toMatchObject({ type: 'circle', construction: true, r: 10 });
    // The circle is a helper; the figure itself is the lines.
    expect(geometry.entities).toHaveLength(7);
    expect(geometry.entities.filter((entity) => !entity.construction)).toHaveLength(6);
  });

  it('says the figure stays itself: closed, equal edges, one circle', () => {
    const geometry = hexagon();
    const types = geometry.constraints.map((constraint) => constraint.type);
    expect(types.filter((type) => type === 'coincident')).toHaveLength(6);
    expect(types.filter((type) => type === 'equal')).toHaveLength(5);
    expect(types.filter((type) => type === 'point-on-circle')).toHaveLength(6);
    expect(types.filter((type) => type === 'tangent')).toHaveLength(0);
  });

  it('draws the shape a square is, with its first corner where the radius points', () => {
    const geometry = square();
    expect(geometry.sides).toBe(4);
    const corners = geometry.lines.map((line) => {
      if (line.type !== 'line') throw new Error('EXPECTED_LINE');
      return [Number(line.x1.toFixed(6)) + 0, Number(line.y1.toFixed(6)) + 0];
    });
    expect(corners).toEqual([
      [10, 0],
      [0, 10],
      [-10, 0],
      [0, -10],
    ]);
    // The circle the corners lie on is the radius that was pointed at.
    expect(geometry.circle).toMatchObject({ cx: 0, cy: 0, r: 10 });
  });

  it('puts the corners outside when the radius pointed at is the internal one', () => {
    const geometry = polygonGeometry({
      centre: [0, 0],
      corner: [10, 0],
      cursor: [0, 10],
      internal: true,
    })!;
    const line = geometry.lines[0]!;
    if (line.type !== 'line') throw new Error('EXPECTED_LINE');
    // A square's corners stand √2 further out than its edges do.
    expect(Math.hypot(line.x1, line.y1)).toBeCloseTo(10 * Math.SQRT2, 9);
    expect(polygonApothem(Math.hypot(line.x1, line.y1), 4)).toBeCloseTo(10, 9);
    // The figure is held by the circle its corners lie on, whichever radius was
    // pointed at: the radius only says what it was measured to.
    if (geometry.circle.type !== 'circle') throw new Error('EXPECTED_CIRCLE');
    expect(geometry.circle.construction).toBe(true);
    expect(geometry.circle.r).toBeCloseTo(10 * Math.SQRT2, 9);
    for (const other of geometry.lines) {
      if (other.type !== 'line') continue;
      expect(Math.hypot(other.x1, other.y1)).toBeCloseTo(10 * Math.SQRT2, 9);
    }
  });

  it('ties the figure to what its clicks snapped to', () => {
    const geometry = polygonGeometry({
      centre: [0, 0],
      corner: [10, 0],
      cursor: [0, 10],
      inputs: [
        {
          snap: {
            point: [0, 0],
            pointSnap: { entityId: 'origin', pointIndex: 0, point: [0, 0] },
            curveSnap: null,
            midpointSnap: null,
          },
          mode: 'free',
        },
        {
          snap: {
            point: [10, 0],
            pointSnap: { entityId: 'other', pointIndex: 1, point: [10, 0] },
            curveSnap: null,
            midpointSnap: null,
          },
          mode: 'free',
        },
      ],
    })!;
    const joints = geometry.constraints.filter((constraint) => constraint.type === 'coincident');
    // The closing joints of the figure, and the two the clicks made.
    expect(joints).toHaveLength(6);
    expect(joints.slice(4).map((joint) => joint.refs)).toEqual([
      [
        { entityId: geometry.circle.id, pointIndex: 0 },
        { entityId: 'origin', pointIndex: 0 },
      ],
      [
        { entityId: geometry.lines[0]!.id, pointIndex: 0 },
        { entityId: 'other', pointIndex: 1 },
      ],
    ]);
  });

  it('refuses a radius of nothing', () => {
    expect(polygonGeometry({ centre: [3, 3], corner: [3, 3], cursor: [5, 5] })).toBeNull();
  });

  it('reads the number of corners from the pointer alone', () => {
    expect(polygonSides({ centre: [0, 0], corner: [10, 0], cursor: [0, 10] })).toBe(4);
    expect(polygonSides({ centre: [0, 0], corner: [10, 0], cursor: [-10, 0] })).toBe(3);
  });

  it('solves without moving and without a redundant relation', async () => {
    const geometry = hexagon();
    const feature = sketchOf(geometry.entities, geometry.constraints);
    const solved = await solveSketch(feature.entities, feature.constraints, [], {
      diagnose: true,
    });
    expect(solved.conflicting).toEqual([]);
    expect(solved.redundant).toEqual([]);
    // The figure is exact as drawn, so nothing moves.
    for (const [index, line] of solved.entities.entries()) {
      const before = feature.entities[index]!;
      if (line.type !== 'line' || before.type !== 'line') continue;
      expect(line.x1).toBeCloseTo(before.x1, 6);
      expect(line.y2).toBeCloseTo(before.y2, 6);
    }
  });

  it('solves the internal radius without a redundant relation either', async () => {
    // Every edge touches the circle: the tangencies have to be independent, or
    // the sketch would show the figure as over-constrained.
    const geometry = polygonGeometry({
      centre: [0, 0],
      corner: [10, 0],
      cursor: [0, 10],
      internal: true,
    })!;
    const solved = await solveSketch(geometry.entities, geometry.constraints, [], {
      diagnose: true,
    });
    expect(solved.conflicting).toEqual([]);
    expect(solved.redundant).toEqual([]);
  });

  it('comes back to itself after a corner is dragged away', async () => {
    const geometry = hexagon();
    const feature = sketchOf(geometry.entities, geometry.constraints);
    // Pull one line's end out of place; the relations must put the figure back
    // into a regular hexagon rather than leaving it sheared.
    const disturbed = feature.entities.map((entity) =>
      entity.id === geometry.lines[1]!.id && entity.type === 'line'
        ? { ...entity, x2: entity.x2 + 3, y2: entity.y2 + 2 }
        : entity,
    );
    const solved = await solveSketch(disturbed, feature.constraints, [], {});
    const lines = solved.entities.filter((entity) => entity.type === 'line');
    expect(lines).toHaveLength(6);
    const lengths = lines.map((line) => {
      if (line.type !== 'line') throw new Error('EXPECTED_LINE');
      return sideLength(line);
    });
    for (const length of lengths) expect(length).toBeCloseTo(10, 4);
    // Every corner stands on the one circle: the same distance from the centre.
    const circle = solved.entities.find((entity) => entity.type === 'circle');
    if (circle?.type !== 'circle') throw new Error('EXPECTED_CIRCLE');
    for (const line of lines) {
      if (line.type !== 'line') continue;
      expect(Math.hypot(line.x1 - circle.cx, line.y1 - circle.cy)).toBeCloseTo(10, 4);
    }
  });
});
