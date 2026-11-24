import { describe, expect, it } from 'vitest';
import type { SketchEntity } from '@icancad/model';
import {
  curveCrossings,
  curveIntervals,
  curveParameterAt,
  curvePointAt,
  isWholeCurve,
  trimPiece,
} from '../src/index';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

const arc = (
  id: string,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): SketchEntity => ({ id, type: 'arc', construction: false, cx, cy, r, startAngle, endAngle });

const circle = (id: string, cx: number, cy: number, r: number): SketchEntity => ({
  id,
  type: 'circle',
  construction: false,
  cx,
  cy,
  r,
});

const ellipse = (id: string, cx: number, cy: number, rx: number, ry: number): SketchEntity => ({
  id,
  type: 'ellipse',
  construction: false,
  cx,
  cy,
  rx,
  ry,
  rotation: 0,
});

const near = (actual: number | null, expected: number, digits = 6) =>
  expect(actual).toBeCloseTo(expected, digits);

describe('trim parameters', () => {
  it('reads a point of a line, an arc and a circle as a parameter', () => {
    const segment = line('a', 0, 0, 10, 0);
    near(curveParameterAt(segment, [2.5, 0]), 0.25);
    expect(curvePointAt(segment, 0.25)).toEqual([2.5, 0]);

    const quarter = arc('b', 0, 0, 5, 0, Math.PI / 2);
    const middle = curvePointAt(quarter, 0.5)!;
    near(curveParameterAt(quarter, middle), 0.5);
    near(middle[0], 5 * Math.cos(Math.PI / 4));

    // An arc drawn the other way round keeps its own direction.
    const backwards = arc('c', 0, 0, 5, Math.PI / 2, 0);
    const halfway = curvePointAt(backwards, 0.5)!;
    near(curveParameterAt(backwards, halfway), 0.5);

    // A circle runs once round from its own angle zero.
    near(curveParameterAt(circle('d', 0, 0, 4), [0, 4]), 0.25);
  });

  it('cuts an exact piece of the same kind of curve', () => {
    const cut = trimPiece(line('a', 0, 0, 10, 0), 0.2, 0.6);
    if (cut?.type !== 'line') throw new Error('EXPECTED_LINE');
    expect([cut.x1, cut.y1, cut.x2, cut.y2]).toEqual([2, 0, 6, 0]);

    const piece = trimPiece(arc('b', 0, 0, 5, 0, Math.PI), 0.25, 0.5);
    if (piece?.type !== 'arc') throw new Error('EXPECTED_ARC');
    near(piece.startAngle, Math.PI / 4);
    near(piece.endAngle, Math.PI / 2);
    expect(piece.r).toBe(5);
    expect(piece.cx).toBe(0);

    // A piece of a circle is an arc of that circle, and a piece of an ellipse is
    // an elliptical arc of that ellipse: nothing is approximated.
    const fromCircle = trimPiece(circle('c', 0, 0, 4), 0, 0.25);
    if (fromCircle?.type !== 'arc') throw new Error('EXPECTED_ARC');
    near(fromCircle.startAngle, 0);
    near(fromCircle.endAngle, Math.PI / 2);
    expect(fromCircle.r).toBe(4);

    const fromEllipse = trimPiece(ellipse('e', 0, 0, 6, 3), 0, 0.5);
    if (fromEllipse?.type !== 'elliptical-arc') throw new Error('EXPECTED_ELLIPTICAL_ARC');
    expect(fromEllipse.rx).toBe(6);
    expect(fromEllipse.ry).toBe(3);
    near(fromEllipse.endAngle, Math.PI);
  });
});

describe('trim crossings', () => {
  it('finds where other curves cross, as parameters along the curve', () => {
    const segment = line('a', 0, 0, 10, 0);
    const parameters = curveCrossings(segment, [
      line('b', 3, -5, 3, 5),
      line('c', 7, 5, 7, -5),
      // A curve that misses the line says nothing, and a circle is cut where it
      // really crosses.
      line('d', 3, 1, 7, 1),
      circle('e', 5, 0, 2),
    ]);
    // The circle crosses at 3 and 7 as well, so both points are the same cuts.
    expect(parameters).toHaveLength(2);
    near(parameters[0] ?? null, 0.3);
    near(parameters[1] ?? null, 0.7);
  });

  it('cuts a line where an ellipse crosses it', () => {
    // An ellipse has no exact solution against a line, so the crossing is found
    // by walking the ellipse: the line is still cut at the right place on it.
    const segment = line('a', -10, 0, 10, 0);
    const parameters = curveCrossings(segment, [ellipse('e', 0, 0, 4, 2)]);
    expect(parameters).toHaveLength(2);
    near(parameters[0] ?? null, 0.3, 4);
    near(parameters[1] ?? null, 0.7, 4);
  });

  it('turns crossings into the pieces a curve is cut into', () => {
    const segment = line('a', 0, 0, 10, 0);
    const intervals = curveIntervals(segment, [0.3, 0.7]);
    if ('error' in intervals) throw new Error(intervals.error);
    expect(intervals.intervals).toHaveLength(3);
    expect(intervals.intervals[1]).toEqual([0.3, 0.7]);

    // A crossing at an end is the joint the curve already has, not a cut: with
    // no cut left the curve is one whole piece.
    expect(curveIntervals(segment, [0, 1])).toEqual({
      from: 0,
      to: 1,
      intervals: [[0, 1]],
      closed: false,
    });

    // A circle has no ends: its pieces run from crossing to crossing, all the
    // way round.
    const loop = curveIntervals(circle('b', 0, 0, 5), [0.1, 0.6]);
    if ('error' in loop) throw new Error(loop.error);
    expect(loop.closed).toBe(true);
    expect(loop.intervals[0]).toEqual([0.1, 0.6]);
    expect(loop.intervals[1]).toEqual([0.6, 1.1]);
  });

  it('hands a curve nothing crosses back as one whole piece', () => {
    // A lone curve is its own piece: the scissors take it whole rather than
    // refusing to act, and a loop one curve crosses is in the same place.
    const alone = curveIntervals(line('a', 0, 0, 10, 0), []);
    expect(alone).toEqual({ from: 0, to: 1, intervals: [[0, 1]], closed: false });
    const touched = curveIntervals(circle('b', 0, 0, 5), [0.2]);
    expect(touched).toEqual({ from: 0, to: 1, intervals: [[0, 1]], closed: true });
    const whole: [number, number] = [0, 1];
    expect(isWholeCurve(whole)).toBe(true);
    expect(isWholeCurve([0.3, 0.7])).toBe(false);
  });
});
