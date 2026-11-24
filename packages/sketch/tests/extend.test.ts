import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { extendCurve } from '../src/extend';

const line = (x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id: 'a',
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

const arc = (startAngle: number, endAngle: number): SketchEntity => ({
  id: 'a',
  type: 'arc',
  construction: false,
  cx: 0,
  cy: 0,
  r: 10,
  startAngle,
  endAngle,
});

describe('extend geometry', () => {
  it('stretches the end of a line along the line itself', () => {
    const result = extendCurve(line(0, 0, 10, 0), [25, 3]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The pointer only says how far: the new end is on the line's course.
    expect(result.shape.end).toBe('end');
    expect(result.shape.entity).toMatchObject({ x1: 0, y1: 0, x2: 25, y2: 0 });
    expect(result.shape.to).toEqual([25, 0]);
    expect(result.shape.from).toEqual([10, 0]);
    // The curve keeps its own identity.
    expect(result.shape.entity.id).toBe('a');
  });

  it('stretches the start when the pointer stands before it', () => {
    const result = extendCurve(line(0, 0, 10, 0), [-4, 2]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.end).toBe('start');
    expect(result.shape.entity).toMatchObject({ x1: -4, y1: 0, x2: 10, y2: 0 });
  });

  it('refuses a pointer that stands over the curve', () => {
    expect(extendCurve(line(0, 0, 10, 0), [5, 2])).toEqual({ ok: false, error: 'inside' });
  });

  it('stretches only the end a gesture named', () => {
    // The pointer is behind the start, but the gesture holds the far end.
    expect(extendCurve(line(0, 0, 10, 0), [-4, 0], 'end')).toEqual({
      ok: false,
      error: 'inside',
    });
    const end = extendCurve(line(0, 0, 10, 0), [18, 0], 'end');
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    expect(end.shape.entity).toMatchObject({ x1: 0, x2: 18 });
  });

  it('stretches an arc round its own circle, keeping its centre and radius', () => {
    // Up and to the left: three eighths of a turn round from the arc's start.
    const result = extendCurve(arc(0, Math.PI / 2), [-20, 20]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.end).toBe('end');
    // The pointer only says how far round: the arc keeps its own circle.
    expect(result.shape.entity).toMatchObject({ cx: 0, cy: 0, r: 10 });
    const entity = result.shape.entity;
    expect(entity.type === 'arc' && entity.endAngle).toBeCloseTo((3 * Math.PI) / 4, 9);
    expect(result.shape.to[0]).toBeCloseTo(-Math.SQRT1_2 * 10, 9);
    expect(result.shape.to[1]).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    expect(result.shape.from).toEqual([Math.cos(Math.PI / 2) * 10, Math.sin(Math.PI / 2) * 10]);
  });

  it('stretches the start of an arc backwards', () => {
    // Down and to the left: the pointer leaves the arc past its start, so the
    // start is the short way out and the end stays where it is.
    const result = extendCurve(arc(0, Math.PI / 2), [10, -10]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.end).toBe('start');
    const entity = result.shape.entity;
    expect(entity.type === 'arc' && entity.startAngle).toBeCloseTo(-Math.PI / 4, 9);
    expect(result.shape.to[0]).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    expect(result.shape.to[1]).toBeCloseTo(-Math.SQRT1_2 * 10, 9);
  });

  it('refuses a pointer that stands over the arc', () => {
    expect(extendCurve(arc(0, Math.PI / 2), [5, 5])).toEqual({ ok: false, error: 'inside' });
  });

  it('stretches an arc drawn the other way round', () => {
    // Clockwise: from 0 down to a quarter turn below it.
    const result = extendCurve(arc(0, -Math.PI / 2), [-20, 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entity = result.shape.entity;
    expect(entity.type === 'arc' && entity.endAngle).toBeCloseTo(-Math.PI, 9);
    expect(result.shape.to[0]).toBeCloseTo(-10, 9);
    expect(result.shape.to[1]).toBeCloseTo(0, 9);
  });

  it('stretches an elliptical arc round its own ellipse', () => {
    const ellipse: SketchEntity = {
      id: 'e',
      type: 'elliptical-arc',
      construction: false,
      cx: 0,
      cy: 0,
      rx: 20,
      ry: 10,
      rotation: 0,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    // The ray up and to the left, in the ellipse's own frame.
    const result = extendCurve(ellipse, [-40, 20]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entity = result.shape.entity;
    expect(entity.type === 'elliptical-arc' && entity.endAngle).toBeCloseTo((3 * Math.PI) / 4, 9);
    expect(result.shape.to[0]).toBeCloseTo(-Math.SQRT1_2 * 20, 9);
    expect(result.shape.to[1]).toBeCloseTo(Math.SQRT1_2 * 10, 9);
  });

  it('refuses the curves that have no end to stretch', () => {
    const circle: SketchEntity = {
      id: 'c',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 5,
    };
    const ellipse: SketchEntity = {
      id: 'e',
      type: 'ellipse',
      construction: false,
      cx: 0,
      cy: 0,
      rx: 5,
      ry: 3,
      rotation: 0,
    };
    const bezier: SketchEntity = {
      id: 'b',
      type: 'bezier',
      construction: false,
      points: [
        [0, 0],
        [5, 10],
        [10, 0],
      ],
    };
    expect(extendCurve(circle, [20, 0])).toEqual({ ok: false, error: 'unsupported' });
    expect(extendCurve(ellipse, [20, 0])).toEqual({ ok: false, error: 'unsupported' });
    expect(extendCurve(bezier, [20, 0])).toEqual({ ok: false, error: 'unsupported' });
  });
});
