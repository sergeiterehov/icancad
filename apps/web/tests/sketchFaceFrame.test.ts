import { describe, expect, it } from 'vitest';
import type { TessellationResult } from '@icancad/kernel';
import type { SketchFeature } from '@icancad/model';
import { computeSketchFrame } from '../src/sketch/sectionPlane';
import { cubeMesh } from './cubeMesh';

const picked = {
  origin: [20, 10, 10] as [number, number, number],
  xAxis: [0, 1, 0] as [number, number, number],
  yAxis: [0, 0, 1] as [number, number, number],
  normal: [1, 0, 0] as [number, number, number],
};

function faceSketch(): SketchFeature {
  return {
    id: 'feat_sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: {
      type: 'face',
      bodyId: 'body-1',
      name: 'fixture/+x',
      offset: 0,
      frame: picked,
    },
    entities: [],
    constraints: [],
    references: [],
    projections: [],
  };
}

function moved(mesh: TessellationResult, dx: number): TessellationResult {
  const positions = new Float32Array(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = positions[index]! + dx;
  }
  return {
    ...mesh,
    positions,
    bbox: {
      min: [mesh.bbox.min[0] + dx, mesh.bbox.min[1], mesh.bbox.min[2]],
      max: [mesh.bbox.max[0] + dx, mesh.bbox.max[1], mesh.bbox.max[2]],
    },
  };
}

/**
 * The +X face cut in two halves. Both halves keep the name, the way a boolean
 * leaves the pieces of a face behind, so the whole face is still the face the
 * sketch was drawn on.
 */
function split(mesh: TessellationResult): TessellationResult {
  const faceIds = new Uint32Array(mesh.faceIds);
  // Triangles are written in pairs per face: the second half of +X is a piece.
  faceIds[2] = 6;
  return {
    ...mesh,
    faceIds,
    faceNames: [...mesh.faceNames!, 'fixture/+x/p/2'],
    faceAliases: [...mesh.faceAliases!, ['fixture/+x/p/2', 'fixture/+x']],
    faceOwners: [...mesh.faceOwners!, 'fixture'],
  };
}

describe('sketch frame on a face', () => {
  it('stays at the middle of the whole face when the face is cut into pieces', () => {
    const frame = computeSketchFrame(faceSketch(), split(cubeMesh()));
    expect(frame.origin[0]).toBeCloseTo(20, 6);
    expect(frame.origin[1]).toBeCloseTo(10, 6);
    expect(frame.origin[2]).toBeCloseTo(10, 6);
    expect(frame.normal).toEqual([1, 0, 0]);
  });

  it('follows a face that moved along its own normal', () => {
    const frame = computeSketchFrame(faceSketch(), moved(cubeMesh(), 10));
    expect(frame.origin[0]).toBeCloseTo(30, 6);
    expect(frame.origin[1]).toBeCloseTo(10, 6);
    expect(frame.origin[2]).toBeCloseTo(10, 6);
    expect(frame.normal).toEqual([1, 0, 0]);
    expect(frame.xAxis).toEqual(picked.xAxis);
  });

  it('keeps the last good frame when the name is briefly gone', () => {
    const gone: TessellationResult = {
      ...cubeMesh(),
      faceNames: ['fixture/-x', 'fixture/moved', 'fixture/-y', 'fixture/+y', 'fixture/-z', 'fixture/+z'],
      faceAliases: [
        ['fixture/-x'],
        ['fixture/moved'],
        ['fixture/-y'],
        ['fixture/+y'],
        ['fixture/-z'],
        ['fixture/+z'],
      ],
    };
    const last = { ...picked, origin: [20, 4, 6] as [number, number, number] };
    expect(computeSketchFrame(faceSketch(), gone, last).origin).toEqual(last.origin);
    // Without a frame from the last rebuild the pose captured at the pick is
    // the only thing left to place the sketch at.
    expect(computeSketchFrame(faceSketch(), gone).origin).toEqual(picked.origin);
  });
});
