import type { SectionPlane, Vec3 } from '@icancad/model';
import type { TessellationResult } from '@icancad/kernel';
import { describe, expect, it } from 'vitest';
import {
  resolveSectionPlane,
  sectionFaceFrame,
  sectionPlaneActive,
} from '../src/sketch/sectionPlane';

/** Unit square in a plane at height `z`, with the given face id. */
function quad(z: number, faceId = 3): TessellationResult {
  const positions = new Float32Array([0, 0, z, 1, 0, z, 1, 1, z, 0, 1, z]);
  return {
    positions,
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    faceIds: new Uint32Array([faceId, faceId]),
    triangleCount: 2,
    vertexCount: 4,
    bbox: { min: [0, 0, z], max: [1, 1, z] },
  };
}

function plane(patch: Partial<SectionPlane> = {}): SectionPlane {
  return {
    id: 'section-1',
    name: 'Plane 1',
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    offset: 0,
    visible: true,
    ...patch,
  };
}

const pointOf = (origin: Vec3, normal: Vec3, offset: number): Vec3 => [
  origin[0] + normal[0] * offset,
  origin[1] + normal[1] * offset,
  origin[2] + normal[2] * offset,
];

describe('section plane resolution', () => {
  it('leaves a plane that is not bound to a face alone', () => {
    const resolved = resolveSectionPlane(plane({ offset: 4 }), {});
    expect(resolved.normal).toEqual([0, 0, 1]);
    expect(resolved.offset).toBe(4);
    expect(resolved.faceLinked).toBe(false);
  });

  it('takes the pose of the linked face and cuts into the material', () => {
    const resolved = resolveSectionPlane(
      plane({ face: { bodyId: 'body-1', topoId: '3' }, offset: 2 }),
      { 'body-1': quad(0) },
    );
    expect(resolved.faceLinked).toBe(true);
    expect(resolved.origin[2]).toBe(0);
    // The face normal points out of the body, so the section keeps what is behind it.
    expect(resolved.normal).toEqual([0, 0, -1]);
    expect(resolved.offset).toBe(2);
  });

  it('follows the face when the body is rebuilt', () => {
    const bound = plane({ face: { bodyId: 'body-1', topoId: '3' } });
    expect(resolveSectionPlane(bound, { 'body-1': quad(0) }).origin[2]).toBe(0);
    expect(resolveSectionPlane(bound, { 'body-1': quad(10) }).origin[2]).toBe(10);
  });

  it('falls back to the stored pose when the face is gone', () => {
    const resolved = resolveSectionPlane(
      plane({ origin: [0, 0, 7], normal: [0, 0, -1], face: { bodyId: 'body-1', topoId: '3' } }),
      {},
    );
    expect(resolved.faceLinked).toBe(false);
    expect(resolved.origin).toEqual([0, 0, 7]);
    expect(resolved.normal).toEqual([0, 0, -1]);
  });

  it('treats a lost face id as gone', () => {
    expect(sectionFaceFrame(quad(0, 3), '9')).toBeNull();
    expect(sectionFaceFrame(quad(0, 3), '3')).not.toBeNull();
  });

  it('only cuts once a plane waiting for a face has one', () => {
    expect(sectionPlaneActive(plane())).toBe(true);
    expect(sectionPlaneActive(plane({ face: null }))).toBe(false);
    expect(sectionPlaneActive(plane({ face: { bodyId: 'b', topoId: '1' } }))).toBe(true);
  });

  it('keeps the plane in place when the direction is inverted', () => {
    const forward = resolveSectionPlane(plane({ offset: 5 }), {});
    const inverted = resolveSectionPlane(plane({ offset: 5, inverted: true }), {});
    expect(inverted.normal).toEqual([0, 0, -1]);
    expect(pointOf(inverted.origin, inverted.normal, inverted.offset)).toEqual(
      pointOf(forward.origin, forward.normal, forward.offset),
    );
  });
});
