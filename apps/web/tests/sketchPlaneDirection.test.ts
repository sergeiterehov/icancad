import type { SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { computeSketchFrame, sketchFrameOf } from '../src/sketch/sectionPlane';
import { cubeMesh } from './cubeMesh';

function sketch(plane: SketchFeature['plane']): SketchFeature {
  return {
    id: 'feat-sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane,
    entities: [],
    constraints: [],
    references: [],
  } as SketchFeature;
}

describe('sketch plane direction', () => {
  it('keeps a datum sketch where it is and turns it around when inverted', () => {
    const normal = sketchFrameOf(sketch({ type: 'datum', plane: 'XY', offset: 10 }));
    const inverted = sketchFrameOf(
      sketch({ type: 'datum', plane: 'XY', offset: 10, inverted: true }),
    );

    expect(normal.origin).toEqual([0, 0, 10]);
    expect(normal.normal).toEqual([0, 0, 1]);
    expect(inverted.origin).toEqual([0, 0, 10]);
    expect(inverted.normal).toEqual([0, 0, -1]);
    expect(inverted.yAxis).toEqual([0, -1, 0]);
  });

  it('turns a sketch on a face around without moving it', () => {
    const plane = { type: 'face' as const, bodyId: 'body-1', topoId: '1', offset: 0 };
    const normal = computeSketchFrame(sketch(plane), cubeMesh());
    const inverted = computeSketchFrame(sketch({ ...plane, inverted: true }), cubeMesh());

    expect(inverted.origin).toEqual(normal.origin);
    expect(inverted.normal).toEqual([-1, 0, 0]);
    expect(normal.normal).toEqual([1, 0, 0]);
  });
});
