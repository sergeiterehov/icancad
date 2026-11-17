import { describe, expect, it } from 'vitest';
import type { PrimitiveFeature } from '@icancad/model';
import { defaultPrimitiveFeature } from '../src/primitive/params';
import { primitivePreviewMesh } from '../src/primitive/mesh';
import { primitivePreview } from '../src/primitive/preview';
import { createProject } from '@icancad/model';
import { resolved, resolvedModelOf } from './resolvedFixture';

function mesh(kind: PrimitiveFeature['kind']) {
  return primitivePreviewMesh(resolved(defaultPrimitiveFeature(kind, kind, kind)));
}

describe('primitive delta meshes', () => {
  it('builds a closed triangle mesh for every kind', () => {
    for (const kind of [
      'box',
      'sphere',
      'cylinder',
      'cone',
      'torus',
      'pyramid',
      'capsule',
    ] as const) {
      const preview = mesh(kind);
      expect(preview.positions.length).toBeGreaterThan(0);
      expect(preview.normals.length).toBe(preview.positions.length);
      expect(preview.indices.length).toBeGreaterThan(0);
      expect(preview.indices.length % 3).toBe(0);
      expect(preview.triangleCount).toBe(preview.indices.length / 3);
      expect(preview.vertexCount).toBe(preview.positions.length / 3);
      expect(preview.faceIds.length).toBe(preview.triangleCount);
    }
  });

  it('stands round primitives on Z and keeps the box at its corner', () => {
    const box = mesh('box');
    expect(box.bbox.min.map((value) => Math.round(value))).toEqual([0, 0, 0]);
    expect(box.bbox.max.map((value) => Math.round(value))).toEqual([20, 20, 20]);

    const cylinder = mesh('cylinder');
    expect(cylinder.bbox.min[2]).toBeCloseTo(0, 1);
    expect(cylinder.bbox.max[2]).toBeCloseTo(20, 1);
    expect(cylinder.bbox.min[0]).toBeLessThan(-9);
    expect(cylinder.bbox.max[0]).toBeGreaterThan(9);

    const torus = mesh('torus');
    expect(torus.bbox.min[2]).toBeCloseTo(-5, 1);
    expect(torus.bbox.max[2]).toBeCloseTo(5, 1);

    const pyramid = mesh('pyramid');
    expect(pyramid.bbox.min[2]).toBeCloseTo(0, 1);
    expect(pyramid.bbox.max[2]).toBeCloseTo(20, 1);

    const capsule = mesh('capsule');
    expect(capsule.bbox.min[2]).toBeCloseTo(-5, 1);
    expect(capsule.bbox.max[2]).toBeCloseTo(25, 1);
  });

  it('marks the primitive delta as a ghost-only body', () => {
    const feature = defaultPrimitiveFeature('box', 'Cube', 'box');
    const preview = primitivePreview(resolved(feature), resolvedModelOf(createProject()));
    expect(preview.featureId).toBe('box');
    expect(preview.bodies).toHaveLength(1);
    expect(preview.bodies[0]).toMatchObject({ kind: 'added', ghostOnly: true, name: 'Cube' });
    expect(preview.ghosts).toHaveLength(1);
    expect(preview.ghosts[0]?.mesh.triangleCount).toBeGreaterThan(0);
  });
});
