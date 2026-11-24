import { describe, expect, it } from 'vitest';
import type { SketchEntity } from '@icancad/model';
import { findFilletCorner, findFilletCorners, filletShape, radiusAtPointer } from '../src/index';

function line(id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity {
  return { id, type: 'line', construction: false, x1, y1, x2, y2 };
}

function corner(lines: SketchEntity[]) {
  const found = findFilletCorner(lines);
  if ('error' in found) throw new Error(found.error);
  return found;
}

describe('fillet corners', () => {
  it('collects the corners a selection names, from lines and from points', () => {
    // A U of three lines: the middle one has a corner at each of its ends.
    const lines = [line('a', 0, 0, 10, 0), line('b', 10, 0, 10, 10), line('c', 10, 10, 0, 10)];

    // One segment names both of its corners; the neighbours need not be picked.
    expect(findFilletCorners({ lines, lineIds: ['b'] })).toHaveLength(2);
    // A line whose other end meets nothing names one corner only.
    expect(findFilletCorners({ lines, lineIds: ['a'] })).toHaveLength(1);
    // A point at a corner names it, and a second pick of the same corner — the
    // line that ends there — must not name it twice.
    expect(findFilletCorners({ lines, points: [[10, 0]] })).toHaveLength(1);
    expect(findFilletCorners({ lines, points: [[10, 0]], lineIds: ['a', 'b'] })).toHaveLength(2);
    // Nothing selected, and a corner-free selection, are both empty.
    expect(findFilletCorners({ lines })).toEqual([]);
    expect(findFilletCorners({ lines: [line('a', 0, 0, 10, 0)], lineIds: ['a'] })).toEqual([]);
  });

  it('leaves a junction of three lines and a straight continuation alone', () => {
    const junction = [
      line('a', -10, 0, 0, 0),
      line('b', 0, 0, 0, 10),
      line('c', 0, 0, 10, 10),
    ];
    // There is no telling which pair of three the arc would replace.
    expect(findFilletCorners({ lines: junction, points: [[0, 0]] })).toEqual([]);

    const straight = [line('a', 0, 0, 10, 0), line('b', 10, 0, 20, 0)];
    expect(findFilletCorners({ lines: straight, lineIds: ['a'] })).toEqual([]);
  });

  it('finds the corner two lines share, whichever way each was drawn', () => {
    const selection = corner([line('a', 10, 0, 0, 0), line('b', 0, 0, 0, 10)]);
    expect(selection.corner[0]).toBeCloseTo(0, 9);
    expect(selection.corner[1]).toBeCloseTo(0, 9);
    expect(selection.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(selection.firstLength).toBeCloseTo(10, 9);
    expect(selection.secondLength).toBeCloseTo(10, 9);
  });

  it('refuses a selection that is not two lines meeting at an end', () => {
    expect(findFilletCorner([line('a', 0, 0, 10, 0)])).toEqual({ error: 'selection' });
    expect(
      findFilletCorner([
        line('a', 0, 0, 10, 0),
        { id: 'arc', type: 'arc', construction: false, cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: 1 },
      ]),
    ).toEqual({ error: 'selection' });
    expect(findFilletCorner([line('a', 0, 0, 10, 0), line('b', 0, 5, 10, 5)])).toEqual({
      error: 'not-connected',
    });
    expect(findFilletCorner([line('a', 0, 0, 10, 0), line('b', 10, 0, 20, 0)])).toEqual({
      error: 'collinear',
    });
  });

  it('cuts a quarter corner into a tangent arc of the asked radius', () => {
    const selection = corner([line('a', 0, 0, 10, 0), line('b', 0, 0, 0, 10)]);
    const shape = filletShape(selection, 3);
    if ('error' in shape) throw new Error(shape.error);

    // The tangent points sit three millimetres along each line, the centre at
    // (3, 3), and the arc runs a quarter turn from one to the other.
    expect(shape.firstJoint[0]).toBeCloseTo(3, 9);
    expect(shape.firstJoint[1]).toBeCloseTo(0, 9);
    expect(shape.secondJoint[0]).toBeCloseTo(0, 9);
    expect(shape.secondJoint[1]).toBeCloseTo(3, 9);
    expect(shape.arc.cx).toBeCloseTo(3, 9);
    expect(shape.arc.cy).toBeCloseTo(3, 9);
    expect(shape.arc.r).toBeCloseTo(3, 9);
    expect(Math.abs(shape.arc.endAngle - shape.arc.startAngle)).toBeCloseTo(Math.PI / 2, 9);

    // The lines lost the corner and kept their far ends.
    const first = shape.first as Extract<SketchEntity, { type: 'line' }>;
    const second = shape.second as Extract<SketchEntity, { type: 'line' }>;
    expect(first.x2).toBeCloseTo(10, 9);
    expect(first.y2).toBeCloseTo(0, 9);
    expect(first.x1).toBeCloseTo(3, 9);
    expect(first.y1).toBeCloseTo(0, 9);
    expect(second.x2).toBeCloseTo(0, 9);
    expect(second.y2).toBeCloseTo(10, 9);
    expect(second.x1).toBeCloseTo(0, 9);
    expect(second.y1).toBeCloseTo(3, 9);
  });

  it('puts the centre on the bisector of a corner away from the origin', () => {
    // The same quarter corner, moved: the bisector is a direction from the
    // corner, so nothing may be measured from the origin by accident.
    const selection = corner([line('a', 10, 0, 20, 0), line('b', 10, 0, 10, 10)]);
    const shape = filletShape(selection, 3);
    if ('error' in shape) throw new Error(shape.error);
    const at = (point: readonly [number, number], expected: [number, number]) => {
      expect(point[0]).toBeCloseTo(expected[0], 9);
      expect(point[1]).toBeCloseTo(expected[1], 9);
    };
    at(shape.firstJoint, [13, 0]);
    at(shape.secondJoint, [10, 3]);
    at([shape.arc.cx, shape.arc.cy], [13, 3]);
    expect(Math.abs(shape.arc.endAngle - shape.arc.startAngle)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('keeps the arc on the inside of a shallow corner', () => {
    // 30° between the lines: the tangent points are far from the corner and the
    // arc bulges towards it, not away through the shape.
    const selection = corner([line('a', 0, 0, 100, 0), line('b', 0, 0, 100, 57.735)]);
    const shape = filletShape(selection, 5);
    if ('error' in shape) throw new Error(shape.error);
    const trim = 5 / Math.tan(selection.angle / 2);
    expect(shape.firstJoint[0]).toBeCloseTo(trim, 6);
    expect(shape.arc.r).toBeCloseTo(5, 9);
    // The arc stays near the corner: every point of it is within the centre
    // distance plus the radius.
    const centreDistance = Math.hypot(shape.arc.cx, shape.arc.cy);
    expect(centreDistance).toBeCloseTo(5 / Math.sin(selection.angle / 2), 6);
    expect(Math.abs(shape.arc.endAngle - shape.arc.startAngle)).toBeLessThanOrEqual(Math.PI);
  });

  it('refuses a radius the lines cannot give', () => {
    const selection = corner([line('a', 0, 0, 10, 0), line('b', 0, 0, 0, 10)]);
    expect(filletShape(selection, 20)).toEqual({ error: 'too-large' });
    expect(filletShape(selection, 0)).toEqual({ error: 'radius' });
  });

  it('reads the radius a pointer describes off the arc it rides', () => {
    const selection = corner([line('a', 0, 0, 10, 0), line('b', 0, 0, 0, 10)]);
    const shape = filletShape(selection, 3);
    if ('error' in shape) throw new Error(shape.error);
    // The middle of that arc: a pointer there asks for the same radius back.
    const middle: [number, number] = [
      shape.arc.cx + Math.cos((shape.arc.startAngle + shape.arc.endAngle) / 2) * shape.arc.r,
      shape.arc.cy + Math.sin((shape.arc.startAngle + shape.arc.endAngle) / 2) * shape.arc.r,
    ];
    expect(radiusAtPointer(selection, middle)).toBeCloseTo(3, 6);
    // And a pointer at the corner asks for none.
    expect(radiusAtPointer(selection, [0, 0])).toBeCloseTo(0, 6);
  });
});
