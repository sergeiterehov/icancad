import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { entitiesInMarquee, marqueeMode, marqueeRect } from '../src/sketch/regionSelect';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

const circle: SketchEntity = {
  id: 'circle',
  type: 'circle',
  construction: false,
  cx: 0,
  cy: 0,
  r: 5,
};

const arc: SketchEntity = {
  id: 'arc',
  type: 'arc',
  construction: false,
  cx: 20,
  cy: 0,
  r: 5,
  startAngle: 0,
  endAngle: Math.PI,
};

const ellipse: SketchEntity = {
  id: 'ellipse',
  type: 'ellipse',
  construction: false,
  cx: -20,
  cy: 0,
  rx: 6,
  ry: 3,
  rotation: 0,
};

const entities = [line('inside', 1, 1, 3, 3), line('across', 4, 0, 8, 0), circle, arc, ellipse];

describe('marqueeMode', () => {
  it('is a window to the right and a crossing to the left', () => {
    expect(marqueeMode(10, 40)).toBe('window');
    expect(marqueeMode(40, 10)).toBe('crossing');
  });
});

describe('entitiesInMarquee', () => {
  it('takes only what fits completely in a window', () => {
    const rect = marqueeRect([0.5, 0.5], [3.5, 3.5]);
    expect(entitiesInMarquee(entities, rect, 'window')).toEqual(['inside']);
  });

  it('takes anything a crossing box touches', () => {
    const rect = marqueeRect([3.5, -1], [0.5, 1]);
    expect(entitiesInMarquee(entities, rect, 'crossing')).toEqual(['inside']);
  });

  it('takes a circle whose rim the crossing box touches', () => {
    const rect = marqueeRect([3, 3], [5, 5]);
    expect(entitiesInMarquee(entities, rect, 'crossing')).toContain('circle');
    expect(entitiesInMarquee(entities, rect, 'window')).not.toContain('circle');
  });

  it('takes the centre of a circle that only encloses the box', () => {
    const rect = marqueeRect([-1, -1], [1, 1]);
    expect(entitiesInMarquee([circle], rect, 'crossing')).toEqual(['circle#0']);
  });

  it('takes the control points a box covers', () => {
    const target = line('target', 0, 0, 10, 0);
    const end = marqueeRect([8.5, -1], [11, 1]);
    expect(entitiesInMarquee([target], end, 'window')).toEqual(['target#1']);
    // The whole line inside its own box keeps the line, not its two ends.
    const whole = marqueeRect([-1, -1], [11, 1]);
    expect(entitiesInMarquee([target], whole, 'window')).toEqual(['target']);
  });

  it('handles arcs and ellipses by their sampled curve', () => {
    const arcRect = marqueeRect([14.5, -1], [21, 5.5]);
    expect(entitiesInMarquee([arc], arcRect, 'crossing')).toEqual(['arc']);
    const ellipseRect = marqueeRect([-27, -4], [-19, 4]);
    expect(entitiesInMarquee([ellipse], ellipseRect, 'crossing')).toEqual(['ellipse']);
  });

  it('takes point entities, including several at the same place', () => {
    const points: SketchEntity[] = [
      { id: 'p1', type: 'point', construction: false, x: 20, y: 20 },
      { id: 'p2', type: 'point', construction: false, x: 20, y: 20 },
      { id: 'p3', type: 'point', construction: false, x: 40, y: 40 },
    ];
    const rect = marqueeRect([19, 19], [21, 21]);
    expect(entitiesInMarquee(points, rect, 'window').sort()).toEqual(['p1', 'p2']);
    expect(entitiesInMarquee(points, rect, 'crossing').sort()).toEqual(['p1', 'p2']);
  });

  it('never takes the origin or the axes', () => {
    const rect = marqueeRect([-10, -10], [30, 30]);
    const fundamental: SketchEntity[] = [
      { id: 'sketch:origin', type: 'point', construction: true, x: 0, y: 0 },
      line('sketch:x-axis', -10, 0, 10, 0),
    ];
    expect(entitiesInMarquee(fundamental, rect, 'crossing')).toEqual([]);
  });
});
