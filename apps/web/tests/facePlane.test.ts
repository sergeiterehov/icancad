import type { TessellationResult } from '@icancad/kernel';
import { describe, expect, it } from 'vitest';
import { computeSketchFrame, faceFrameFromMesh, sketchFrameOf } from '../src/sketch/sectionPlane';
import type { SketchFeature } from '@icancad/model';

function quad(z: number): TessellationResult {
  return {
    positions: new Float32Array([
      -1, -1, z,
      1, -1, z,
      1, 1, z,
      -1, -1, z,
      1, 1, z,
      -1, 1, z,
    ]),
    normals: new Float32Array(18),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    faceIds: new Uint32Array([0, 0]),
    triangleCount: 2,
    vertexCount: 6,
    bbox: { min: [-1, -1, z], max: [1, 1, z] },
  };
}

function faceSketch(): SketchFeature {
  return {
    id: 'feat_sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: {
      type: 'face',
      bodyId: 'body',
      topoId: '0',
      frame: {
        origin: [0, 0, 1],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      },
    },
    entities: [],
    constraints: [],
    references: [],
  };
}

describe('face sketch frames', () => {
  it('finds the centre and normal from the current face tessellation', () => {
    expect(faceFrameFromMesh(quad(5), 0)?.origin).toEqual([0, 0, 5]);
    expect(faceFrameFromMesh(quad(9), 0)?.origin).toEqual([0, 0, 9]);
  });

  it('recomputes the plane even when an older frame was stored', () => {
    const feature = faceSketch();
    expect(computeSketchFrame(feature, quad(7)).origin).toEqual([0, 0, 7]);
    expect(sketchFrameOf(feature).origin).toEqual([0, 0, 1]);
  });

  it('uses the frozen frame when one was produced by the rebuild', () => {
    const feature = faceSketch();
    const frozen = computeSketchFrame(feature, quad(11));
    expect(sketchFrameOf(feature, frozen).origin).toEqual([0, 0, 11]);
  });

  it('applies the offset along the current normal', () => {
    const feature = faceSketch();
    feature.plane = { ...feature.plane, offset: 2 };
    expect(computeSketchFrame(feature, quad(7)).origin).toEqual([0, 0, 9]);
  });
});
