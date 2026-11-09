import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { liveMeasures, measureInfo, measureValue, measuresForEntity } from '../src/sketch/measure';

const line: SketchEntity = {
  id: 'l',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 30,
  y2: 40,
};

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

describe('reference measurements', () => {
  it('lists available measures per entity type', () => {
    expect(measuresForEntity(line)).toEqual(['length', 'angle']);
    expect(measuresForEntity(arc)).toEqual(['radius', 'diameter', 'angle']);
    expect(liveMeasures(line)).toEqual(['length']);
    expect(liveMeasures(arc)).toEqual(['radius', 'angle']);
  });

  it('computes line length and undirected angle', () => {
    expect(measureValue(line, 'length')).toBeCloseTo(50, 6);
    expect(measureValue(line, 'angle')).toBeCloseTo(53.13, 2);
    expect(measureValue({ ...line, x2: -30, y2: -40 }, 'angle')).toBeCloseTo(53.13, 2);
  });

  it('computes arc radius, diameter and sweep', () => {
    expect(measureValue(arc, 'radius')).toBe(10);
    expect(measureValue(arc, 'diameter')).toBe(20);
    expect(measureValue(arc, 'angle')).toBeCloseTo(90, 2);
  });

  it('formats values with units', () => {
    expect(measureInfo(line, 'length', 'en', 'mm')?.text).toBe('50 mm');
    expect(measureInfo(arc, 'radius', 'en', 'mm')?.text).toBe('R 10 mm');
    expect(measureInfo(arc, 'angle', 'en', 'mm')?.text).toBe('90°');
  });
});
