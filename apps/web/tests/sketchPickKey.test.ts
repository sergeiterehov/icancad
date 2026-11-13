import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { sketchPickKey } from '../src/sketch/pickKey';

const point: SketchEntity = { id: 'p', type: 'point', construction: false, x: 1, y: 2 };
const line: SketchEntity = {
  id: 'l',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
};

describe('sketch pick keys', () => {
  it('names the picked control point', () => {
    expect(sketchPickKey({ entityId: 'l', pointIndex: 1 }, line)).toBe('l#1');
  });

  it('names the whole curve when no point was picked', () => {
    expect(sketchPickKey({ entityId: 'l', pointIndex: null }, line)).toBe('l');
  });

  it('uses the single point of a point entity', () => {
    expect(sketchPickKey({ entityId: 'p', pointIndex: null }, point)).toBe('p#0');
  });

  it('is empty over nothing', () => {
    expect(sketchPickKey(null, undefined)).toBeNull();
    expect(sketchPickKey({ entityId: null, pointIndex: null }, undefined)).toBeNull();
  });
});
