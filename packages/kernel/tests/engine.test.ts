import { beforeAll, describe, expect, it } from 'vitest';
import { KernelEngine, KernelOpError } from '../src/engine';
import { loadOcctNode } from '../src/occt-node';
import type { TessellationResult } from '../src/protocol';

function meshSignedVolume(mesh: TessellationResult): number {
  const { positions, indices } = mesh;
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    const az = positions[a + 2]!;
    const bx = positions[b]!;
    const by = positions[b + 1]!;
    const bz = positions[b + 2]!;
    const cx = positions[c]!;
    const cy = positions[c + 1]!;
    const cz = positions[c + 2]!;
    volume +=
      ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return volume / 6;
}

describe('OCCT kernel engine', () => {
  const engine = new KernelEngine(() => loadOcctNode());

  beforeAll(async () => {
    await engine.init();
  });

  it('reports a ready kernel', async () => {
    const health = await engine.init();
    expect(health.occtVersion).toBeTruthy();
    expect(health.loadMs).toBeGreaterThan(0);
  });

  it('creates a box with the expected topology', () => {
    const result = engine.makeBox({ shapeId: 'box-1', dx: 20, dy: 10, dz: 5 });
    expect(result.stats).toEqual({ faces: 6, edges: 12 });
  });

  it('tessellates a box into a closed mesh', () => {
    const mesh = engine.tessellate('box-1');
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.vertexCount).toBeGreaterThanOrEqual(8);
    expect(mesh.indices.length).toBe(36);
    expect(mesh.faceIds.length).toBe(12);
    expect(mesh.positions.length).toBe(mesh.vertexCount * 3);
    expect(mesh.normals.length).toBe(mesh.vertexCount * 3);

    expect(mesh.bbox.min).toEqual([0, 0, 0]);
    expect(mesh.bbox.max[0]).toBeCloseTo(20, 5);
    expect(mesh.bbox.max[1]).toBeCloseTo(10, 5);
    expect(mesh.bbox.max[2]).toBeCloseTo(5, 5);
    expect(meshSignedVolume(mesh)).toBeCloseTo(20 * 10 * 5, 3);
  });

  it('supports finer tessellation quality', () => {
    const coarse = engine.tessellate('box-1', {
      linearDeflection: 1,
      angularDeflection: 1,
    });
    const fine = engine.tessellate('box-1', {
      linearDeflection: 0.01,
      angularDeflection: 0.1,
    });
    expect(fine.triangleCount).toBe(12);
    expect(coarse.triangleCount).toBe(12);
  });

  it('rejects unknown shapes and invalid box parameters', () => {
    expect(() => engine.tessellate('missing')).toThrowError(KernelOpError);
    try {
      engine.tessellate('missing');
    } catch (error) {
      expect((error as KernelOpError).code).toBe('SHAPE_NOT_FOUND');
    }
    expect(() => engine.makeBox({ shapeId: 'bad', dx: 0, dy: 10, dz: 5 })).toThrowError(
      KernelOpError,
    );
  });

  it('disposes shapes', () => {
    expect(engine.dispose('box-1')).toBe(true);
    expect(engine.dispose('box-1')).toBe(false);
    expect(engine.shapeCount).toBe(0);
  });
});
