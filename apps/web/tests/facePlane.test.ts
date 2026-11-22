import type { TessellationResult } from '@icancad/kernel';
import { describe, expect, it } from 'vitest';
import {
  computeSketchFrame,
  faceBoundsInFrame,
  faceFrameFromMesh,
  sketchFrameOf,
} from '../src/sketch/sectionPlane';
import type { SketchFeature } from '@icancad/model';
import { outwardNormal } from '../src/quick/geometry';
import { sketchPlaneFromSelection } from '../src/sketch/facePlane';

function quad(z: number): TessellationResult {
  return {
    positions: new Float32Array([-1, -1, z, 1, -1, z, 1, 1, z, -1, -1, z, 1, 1, z, -1, 1, z]),
    normals: new Float32Array(18),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    faceIds: new Uint32Array([0, 0]),
    triangleCount: 2,
    vertexCount: 6,
    bbox: { min: [-1, -1, z], max: [1, 1, z] },
    faceNames: ['fixture/face'],
    faceAliases: [['fixture/face']],
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
      name: 'fixture/face',
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

  it('returns the bounding corners of the picked face in the sketch plane', () => {
    const frame = sketchFrameOf(faceSketch());
    expect(faceBoundsInFrame(quad(5), 0, frame)).toEqual([
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]);
    expect(faceBoundsInFrame(quad(5), 1, frame)).toEqual([]);
    expect(faceBoundsInFrame(undefined, 0, frame)).toEqual([]);
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

/** A concave L-shaped planar face: its area centroid is not its extent middle. */
function lShape(): TessellationResult {
  const points: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 2],
    [2, 2],
    [2, 10],
    [0, 10],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  for (const [x, y] of points) {
    positions.push(x, y, 0);
    normals.push(0, 0, 1);
  }
  // Triangles of the L: (0,1,2), (0,2,3), (0,3,4), (0,4,5) is concave, so split
  // it into the arm and the upright explicitly.
  const indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceIds: new Uint32Array(indices.length / 3).fill(0),
    triangleCount: indices.length / 3,
    vertexCount: points.length,
    bbox: { min: [0, 0, 0], max: [10, 10, 0] },
    faceNames: ['fixture/face'],
    faceAliases: [['fixture/face']],
  };
}

describe('face middle shared with the sketch', () => {
  it('uses the area centroid, not the middle of the extent', () => {
    const mesh = lShape();
    const frame = faceFrameFromMesh(mesh, 0)!;
    const region = outwardNormal(mesh, 0)!;
    expect(frame.origin[0]).toBeCloseTo(region.centroid[0], 6);
    expect(frame.origin[1]).toBeCloseTo(region.centroid[1], 6);
    // The bounding box would put the middle at (5, 5).
    expect(frame.origin[0]).not.toBeCloseTo(5, 1);
    expect(frame.origin[1]).not.toBeCloseTo(5, 1);
  });

  it('gives the sketch plane and the array axis the same pose', () => {
    const mesh = lShape();
    const plane = sketchPlaneFromSelection([{ kind: 'body-face', id: 'body#0' }], {
      body: mesh,
    });
    const region = outwardNormal(mesh, 0)!;
    expect(plane?.frame.origin[0]).toBeCloseTo(region.centroid[0], 6);
    expect(plane?.frame.origin[1]).toBeCloseTo(region.centroid[1], 6);
    expect(plane?.frame.normal).toEqual(region.normal);
  });
});
