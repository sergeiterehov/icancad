import { beforeAll, describe, expect, it } from 'vitest';
import { KernelEngine, KernelOpError } from '../src/engine';
import { loadOcctNode } from '../src/occt-node';
import type { TessellationResult } from '../src/protocol';

/** Face whose area-weighted normal points most in the given direction. */
function faceFacing(mesh: TessellationResult, normal: [number, number, number]): number {
  const sums = new Map<number, [number, number, number]>();
  const { positions, indices, faceIds } = mesh;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    const a = indices[triangle * 3]! * 3;
    const b = indices[triangle * 3 + 1]! * 3;
    const c = indices[triangle * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const sum = sums.get(faceIds[triangle]!) ?? [0, 0, 0];
    sum[0]! += uy * vz - uz * vy;
    sum[1]! += uz * vx - ux * vz;
    sum[2]! += ux * vy - uy * vx;
    sums.set(faceIds[triangle]!, sum);
  }
  let best = -1;
  let bestDot = -Infinity;
  for (const [faceId, sum] of sums) {
    const dot = sum[0] * normal[0] + sum[1] * normal[1] + sum[2] * normal[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = faceId;
    }
  }
  return best;
}

/** Outward normal of every tessellated face, keyed by face id. */
function faceNormals(mesh: TessellationResult): Map<number, [number, number, number]> {
  const sums = new Map<number, number[]>();
  const { positions, indices, faceIds } = mesh;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    const a = indices[triangle * 3]! * 3;
    const b = indices[triangle * 3 + 1]! * 3;
    const c = indices[triangle * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const sum = sums.get(faceIds[triangle]!) ?? [0, 0, 0];
    sum[0] = (sum[0] ?? 0) + uy * vz - uz * vy;
    sum[1] = (sum[1] ?? 0) + uz * vx - ux * vz;
    sum[2] = (sum[2] ?? 0) + ux * vy - uy * vx;
    sums.set(faceIds[triangle]!, sum);
  }
  const normals = new Map<number, [number, number, number]>();
  for (const [faceId, sum] of sums) {
    const length = Math.hypot(sum[0]!, sum[1]!, sum[2]!);
    normals.set(faceId, [sum[0]! / length, sum[1]! / length, sum[2]! / length]);
  }
  return normals;
}

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
    volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
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
    expect(result.stats).toEqual({ faces: 6, edges: 12, solids: 1 });
  });

  it('creates a box at the requested position', () => {
    engine.makeBox({ shapeId: 'box-offset', dx: 2, dy: 3, dz: 4, at: [10, -20, 30] });
    const mesh = engine.tessellate('box-offset');
    expect(mesh.bbox.min[0]).toBeCloseTo(10, 5);
    expect(mesh.bbox.min[1]).toBeCloseTo(-20, 5);
    expect(mesh.bbox.min[2]).toBeCloseTo(30, 5);
    expect(mesh.bbox.max[0]).toBeCloseTo(12, 5);
    expect(mesh.bbox.max[1]).toBeCloseTo(-17, 5);
    expect(mesh.bbox.max[2]).toBeCloseTo(34, 5);
  });

  it('copies a shape at a placement and keeps the source', () => {
    engine.makeBox({ shapeId: 'array-source', dx: 2, dy: 3, dz: 4 });
    const result = engine.transformShape({
      shapeId: 'array-copy',
      sourceShapeId: 'array-source',
      matrix: [1, 0, 0, 10, 0, 1, 0, -5, 0, 0, 1, 2],
    });
    expect(result.stats).toEqual({ faces: 6, edges: 12, solids: 1 });
    const copy = engine.tessellate('array-copy');
    expect(copy.bbox.min[0]).toBeCloseTo(10, 5);
    expect(copy.bbox.min[1]).toBeCloseTo(-5, 5);
    expect(copy.bbox.min[2]).toBeCloseTo(2, 5);
    // The array repeats the input instead of moving it.
    const source = engine.tessellate('array-source');
    expect(source.bbox.min[0]).toBeCloseTo(0, 5);
  });

  it('creates every primitive kind', () => {
    expect(
      engine.makePrimitive({ kind: 'sphere', shapeId: 'sphere-1', radius: 10, at: [0, 20, 0] })
        .stats,
    ).toMatchObject({ faces: 1, solids: 1 });
    expect(
      engine.makePrimitive({
        kind: 'cylinder',
        shapeId: 'cylinder-1',
        radius: 10,
        height: 20,
        at: [0, 20, 0],
      }).stats,
    ).toMatchObject({ faces: 3, solids: 1 });
    expect(
      engine.makePrimitive({
        kind: 'cone',
        shapeId: 'cone-1',
        bottomRadius: 10,
        topRadius: 0,
        height: 20,
        at: [0, 20, 0],
      }).stats,
    ).toMatchObject({ faces: 2, solids: 1 });
    expect(
      engine.makePrimitive({
        kind: 'torus',
        shapeId: 'torus-1',
        majorRadius: 20,
        tubeRadius: 5,
        at: [0, 20, 0],
      }).stats,
    ).toMatchObject({ faces: 1, solids: 1 });
    expect(
      engine.makePrimitive({
        kind: 'pyramid',
        shapeId: 'pyramid-1',
        sides: 4,
        radius: 10,
        height: 20,
        at: [0, 20, 0],
      }).stats,
    ).toMatchObject({ faces: 5, solids: 1 });
    expect(
      engine.makePrimitive({
        kind: 'capsule',
        shapeId: 'capsule-1',
        radius: 5,
        height: 20,
        at: [0, 20, 0],
      }).stats,
    ).toMatchObject({ faces: 3, solids: 1 });
  });

  it('stands round primitives on the Z axis', () => {
    engine.makePrimitive({ kind: 'cylinder', shapeId: 'cylinder-z', radius: 5, height: 10 });
    const cylinder = engine.tessellate('cylinder-z');
    expect(cylinder.bbox.min[2]).toBeCloseTo(0, 2);
    expect(cylinder.bbox.max[2]).toBeCloseTo(10, 2);
    expect(cylinder.bbox.min[0]).toBeLessThan(-4);
    expect(cylinder.bbox.max[0]).toBeGreaterThan(4);
    expect(cylinder.bbox.min[1]).toBeLessThan(-4);
    expect(cylinder.bbox.max[1]).toBeGreaterThan(4);

    engine.makePrimitive({
      kind: 'cone',
      shapeId: 'cone-z',
      bottomRadius: 5,
      topRadius: 0,
      height: 10,
    });
    const cone = engine.tessellate('cone-z');
    expect(cone.bbox.min[2]).toBeCloseTo(0, 2);
    expect(cone.bbox.max[2]).toBeCloseTo(10, 2);

    engine.makePrimitive({ kind: 'torus', shapeId: 'torus-z', majorRadius: 20, tubeRadius: 5 });
    const torus = engine.tessellate('torus-z');
    expect(torus.bbox.min[2]).toBeCloseTo(-5, 1);
    expect(torus.bbox.max[2]).toBeCloseTo(5, 1);
    expect(torus.bbox.max[0]).toBeGreaterThan(24);

    engine.makePrimitive({
      kind: 'pyramid',
      shapeId: 'pyramid-z',
      sides: 4,
      radius: 10,
      height: 15,
    });
    const pyramid = engine.tessellate('pyramid-z');
    expect(pyramid.bbox.min[2]).toBeCloseTo(0, 2);
    expect(pyramid.bbox.max[2]).toBeCloseTo(15, 2);

    engine.makePrimitive({ kind: 'capsule', shapeId: 'capsule-z', radius: 4, height: 10 });
    const capsule = engine.tessellate('capsule-z');
    expect(capsule.bbox.min[2]).toBeCloseTo(-4, 1);
    expect(capsule.bbox.max[2]).toBeCloseTo(14, 1);
  });

  it('joins a prism from every flat face to its body', () => {
    // A slanted face is the hard case: the tool reaches back into the material
    // to overlap it, and a seam there used to keep the union from merging.
    engine.makePrimitive({ kind: 'box', shapeId: 'extrude-box', dx: 20, dy: 20, dz: 20 });
    engine.makePrimitive({
      kind: 'pyramid',
      shapeId: 'extrude-pyramid',
      sides: 4,
      radius: 10,
      height: 20,
    });
    for (const bodyId of ['extrude-box', 'extrude-pyramid']) {
      const { faceIds } = engine.tessellate(bodyId);
      const normals = faceNormals(engine.tessellate(bodyId));
      expect(faceIds.length).toBeGreaterThan(0);
      for (const [faceId, normal] of normals) {
        const toolId = `${bodyId}-tool-${faceId}`;
        engine.makeFacePrism({
          shapeId: toolId,
          sourceShapeId: bodyId,
          faceId,
          normal,
          distances: [15.7],
          embed: true,
        });
        const fused = engine.booleanShape({
          shapeId: `${bodyId}-fused-${faceId}`,
          baseShapeId: bodyId,
          toolShapeId: toolId,
          op: 'fuse',
        });
        expect(fused.stats.solids).toBe(1);
      }
    }
  });

  it('rejects primitive parameters the makers cannot build', () => {
    expect(() =>
      engine.makePrimitive({
        kind: 'torus',
        shapeId: 'torus-bad',
        majorRadius: 5,
        tubeRadius: 5,
      }),
    ).toThrow(/tube radius/i);
    expect(() =>
      engine.makePrimitive({
        kind: 'pyramid',
        shapeId: 'pyramid-bad',
        sides: 2,
        radius: 10,
        height: 10,
      }),
    ).toThrow(/3 to 120/);
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

  it('reports selectable B-rep edges without seams', () => {
    const box = engine.tessellate('box-1');
    expect(box.edges).toHaveLength(12);
    for (const edge of box.edges ?? []) {
      expect(edge.faceIds).toHaveLength(2);
      expect(new Set(edge.faceIds).size).toBe(2);
      expect(edge.points.length).toBeGreaterThanOrEqual(6);
      expect(edge.closed).toBe(false);
    }
    // Every edge joins a different pair of faces.
    const pairs = new Set((box.edges ?? []).map((edge) => [...edge.faceIds].sort().join('-')));
    expect(pairs.size).toBe(12);
  });

  it('filters the seam of a cylindrical face from edges', () => {
    engine.makePrism({
      shapeId: 'prism-cylinder',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [{ outer: { curves: [{ type: 'circle', cx: 0, cy: 0, r: 10 }] }, holes: [] }],
      distances: [5],
    });
    const mesh = engine.tessellate('prism-cylinder');
    // Two circles: the cap boundary is one closed edge each, the seam is gone.
    expect(mesh.edges).toHaveLength(2);
    for (const edge of mesh.edges ?? []) {
      expect(edge.closed).toBe(true);
      expect(edge.faceIds).toHaveLength(2);
      expect(new Set(edge.faceIds).size).toBe(2);
    }
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

  it('extrudes a rectangular region with a hole into a solid', () => {
    const result = engine.makePrism({
      shapeId: 'prism-1',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line', x1: 0, y1: 0, x2: 20, y2: 0 },
              { type: 'line', x1: 20, y1: 0, x2: 20, y2: 10 },
              { type: 'line', x1: 20, y1: 10, x2: 0, y2: 10 },
              { type: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
            ],
          },
          holes: [{ curves: [{ type: 'circle', cx: 10, cy: 5, r: 2 }] }],
        },
      ],
      distances: [5],
    });
    expect(result.stats.faces).toBeGreaterThanOrEqual(6);

    const mesh = engine.tessellate('prism-1');
    const volume = meshSignedVolume(mesh);
    const expected = (20 * 10 - Math.PI * 4) * 5;
    expect(volume).toBeGreaterThan(expected * 0.97);
    expect(volume).toBeLessThan(expected * 1.03);
    expect(mesh.bbox.max[2]).toBeCloseTo(5, 5);
  });

  it('revolves a region into a ring', () => {
    const region = {
      outer: {
        curves: [
          { type: 'line' as const, x1: 10, y1: 0, x2: 20, y2: 0 },
          { type: 'line' as const, x1: 20, y1: 0, x2: 20, y2: 5 },
          { type: 'line' as const, x1: 20, y1: 5, x2: 10, y2: 5 },
          { type: 'line' as const, x1: 10, y1: 5, x2: 10, y2: 0 },
        ],
      },
      holes: [],
    };
    const full = engine.makeRevolve({
      shapeId: 'revolve-full',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      regions: [region],
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      startAngle: 0,
      endAngle: Math.PI * 2,
    });
    expect(full.stats.solids).toBe(1);
    const mesh = engine.tessellate('revolve-full');
    // A ring 10..20 mm around Z, 5 mm tall.
    const expected = Math.PI * (20 * 20 - 10 * 10) * 5;
    expect(meshSignedVolume(mesh)).toBeGreaterThan(expected * 0.95);
    expect(meshSignedVolume(mesh)).toBeLessThan(expected * 1.05);
    expect(mesh.bbox.min[2]).toBeCloseTo(0, 5);
    expect(mesh.bbox.max[2]).toBeCloseTo(5, 5);
  });

  it('revolves part of a turn between the two angles', () => {
    const region = {
      outer: {
        curves: [
          { type: 'line' as const, x1: 10, y1: 0, x2: 20, y2: 0 },
          { type: 'line' as const, x1: 20, y1: 0, x2: 20, y2: 5 },
          { type: 'line' as const, x1: 20, y1: 5, x2: 10, y2: 5 },
          { type: 'line' as const, x1: 10, y1: 5, x2: 10, y2: 0 },
        ],
      },
      holes: [],
    };
    engine.makeRevolve({
      shapeId: 'revolve-quarter',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      regions: [region],
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      startAngle: 0,
      endAngle: Math.PI / 2,
    });
    const mesh = engine.tessellate('revolve-quarter');
    const expected = (Math.PI * (20 * 20 - 10 * 10) * 5) / 4;
    expect(meshSignedVolume(mesh)).toBeGreaterThan(expected * 0.95);
    expect(meshSignedVolume(mesh)).toBeLessThan(expected * 1.05);
    // The quarter runs from +X to +Y.
    expect(mesh.bbox.max[0]).toBeCloseTo(20, 0);
    expect(mesh.bbox.min[2]).toBeCloseTo(0, 5);
    expect(mesh.bbox.max[2]).toBeCloseTo(5, 5);
  });

  it('places the sweep of a revolve at its start angle', () => {
    engine.makeRevolve({
      shapeId: 'revolve-offset',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line', x1: 10, y1: 0, x2: 20, y2: 0 },
              { type: 'line', x1: 20, y1: 0, x2: 20, y2: 5 },
              { type: 'line', x1: 20, y1: 5, x2: 10, y2: 5 },
              { type: 'line', x1: 10, y1: 5, x2: 10, y2: 0 },
            ],
          },
          holes: [],
        },
      ],
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      startAngle: Math.PI / 2,
      endAngle: Math.PI,
    });
    const mesh = engine.tessellate('revolve-offset');
    // A quarter turn from +Y to -X: it lies on the negative X side.
    expect(mesh.bbox.min[0]).toBeCloseTo(-20, 0);
    expect(mesh.bbox.max[0]).toBeLessThan(1);
    expect(mesh.bbox.min[1]).toBeGreaterThan(-1);
  });

  it('revolves a face of a body', () => {
    engine.makeBox({ shapeId: 'revolve-source', dx: 20, dy: 10, dz: 5 });
    const result = engine.makeFaceRevolve({
      shapeId: 'revolve-face',
      sourceShapeId: 'revolve-source',
      faceId: 0,
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      startAngle: 0,
      endAngle: Math.PI * 2,
    });
    expect(result.stats.solids).toBe(1);
    const mesh = engine.tessellate('revolve-face');
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0);
  });

  it('extrudes arcs and builds symmetric solids', () => {
    const result = engine.makePrism({
      shapeId: 'prism-arc',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line', x1: 0, y1: 0, x2: 20, y2: 0 },
              { type: 'arc', cx: 10, cy: 0, r: 10, startAngle: 0, endAngle: Math.PI },
            ],
          },
          holes: [],
        },
      ],
      distances: [2, -2],
    });
    expect(result.stats.faces).toBeGreaterThanOrEqual(3);
    const mesh = engine.tessellate('prism-arc');
    expect(mesh.bbox.min[2]).toBeCloseTo(-2, 5);
    expect(mesh.bbox.max[2]).toBeCloseTo(2, 5);
  });

  it('extrudes a profile with a clockwise (reversed) arc', () => {
    const result = engine.makePrism({
      shapeId: 'prism-reversed',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
              {
                type: 'arc',
                cx: 0,
                cy: 0,
                r: 10,
                startAngle: -Math.PI / 2,
                endAngle: 0,
                reversed: true,
              },
              { type: 'line', x1: 0, y1: -10, x2: 0, y2: 0 },
            ],
          },
          holes: [],
        },
      ],
      distances: [6],
    });
    expect(result.stats.faces).toBeGreaterThanOrEqual(3);
    const mesh = engine.tessellate('prism-reversed');
    expect(mesh.bbox.max[2]).toBeCloseTo(6, 5);
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0);
  });

  it('extrudes a contour whose arcs come from a real sketch drawing', () => {
    const result = engine.makePrism({
      shapeId: 'prism-drawing',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        {
          outer: {
            curves: [
              {
                type: 'line',
                x1: -54.19636757449335,
                y1: -47.860781122154016,
                x2: 6.960966347011371,
                y2: -47.860781122154016,
              },
              {
                type: 'arc',
                cx: 6.960966577512058,
                cy: -13.647069516322679,
                r: 34.213711605831335,
                startAngle: -1.5707963335319817,
                endAngle: 3.2696327140518344e-8,
              },
              {
                type: 'line',
                x1: 41.174678183343396,
                y1: -13.647068397659972,
                x2: 41.174678183343396,
                y2: 43.48162904284042,
              },
              {
                type: 'line',
                x1: 41.174678183343396,
                y1: 43.48162904284042,
                x2: -54.19636757449335,
                y2: -47.860781122154016,
              },
            ],
          },
          holes: [],
        },
      ],
      distances: [3],
    });
    expect(result.stats.faces).toBe(6);
    const mesh = engine.tessellate('prism-drawing');
    expect(mesh.bbox.max[2]).toBeCloseTo(3, 5);
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0);
  });

  it('extrudes the same region in every datum plane', () => {
    const frames: Record<
      string,
      {
        origin: [number, number, number];
        xAxis: [number, number, number];
        yAxis: [number, number, number];
      }
    > = {
      xy: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0] },
      xz: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1] },
      yz: { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1] },
    };
    for (const [name, frame] of Object.entries(frames)) {
      const shapeId = `prism-${name}`;
      engine.makePrism({
        shapeId,
        ...frame,
        regions: [{ outer: { curves: [{ type: 'circle', cx: 0, cy: 0, r: 10 }] }, holes: [] }],
        distances: [4],
      });
      const mesh = engine.tessellate(shapeId);
      const spans = [0, 1, 2].map((axis) => mesh.bbox.max[axis]! - mesh.bbox.min[axis]!);
      // Two axes hold the circle, the third one holds the extrusion.
      const thin = spans.reduce((total, span) => total + (span < 5 ? 1 : 0), 0);
      expect(thin).toBe(1);
      expect(Math.max(...spans)).toBeCloseTo(20, 1);
      expect(meshSignedVolume(mesh)).toBeGreaterThan(0);
    }
  });

  it('extrudes a face of an existing solid', () => {
    engine.makeBox({ shapeId: 'face-source', dx: 20, dy: 20, dz: 20 });
    const source = engine.tessellate('face-source');
    const faceId = source.faceIds[0]!;
    const triangle = source.faceIds.findIndex((id) => id === faceId);
    expect(triangle).toBeGreaterThanOrEqual(0);

    const corners = [0, 1, 2].map((corner) => {
      const vertex = source.indices[triangle * 3 + corner]!;
      return [
        source.positions[vertex * 3]!,
        source.positions[vertex * 3 + 1]!,
        source.positions[vertex * 3 + 2]!,
      ] as const;
    });
    const a = corners[0]!;
    const b = corners[1]!;
    const c = corners[2]!;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal: [number, number, number] = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];

    const result = engine.makeFacePrism({
      shapeId: 'face-prism',
      sourceShapeId: 'face-source',
      faceId,
      normal,
      distances: [5],
    });
    expect(result.stats.faces).toBeGreaterThan(0);

    const prism = engine.tessellate('face-prism');
    expect(prism.triangleCount).toBeGreaterThan(0);
    expect(prism.indices.length).toBe(prism.triangleCount * 3);
    expect(Math.abs(meshSignedVolume(prism))).toBeGreaterThan(0);
  });

  it('rejects extruding a curved body face', () => {
    engine.makePrism({
      shapeId: 'curved-face-source',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [{ outer: { curves: [{ type: 'circle', cx: 0, cy: 0, r: 5 }] }, holes: [] }],
      distances: [10],
    });
    // A cylinder has one curved side and two planar caps.
    const outcomes: string[] = [];
    for (let faceId = 0; faceId < 3; faceId += 1) {
      try {
        engine.makeFacePrism({
          shapeId: `curved-face-${faceId}`,
          sourceShapeId: 'curved-face-source',
          faceId,
          normal: [0, 0, 1],
          distances: [2],
        });
        outcomes.push('ok');
      } catch (error) {
        outcomes.push(error instanceof KernelOpError ? error.code : 'unknown');
      }
    }
    expect(outcomes.filter((code) => code === 'FACE_NOT_PLANAR')).toHaveLength(1);
    expect(outcomes.filter((code) => code === 'ok')).toHaveLength(2);
  });

  it('reports disjoint solids when fused regions do not touch', () => {
    const square = (x: number) => ({
      curves: [
        { type: 'line' as const, x1: x, y1: 0, x2: x + 10, y2: 0 },
        { type: 'line' as const, x1: x + 10, y1: 0, x2: x + 10, y2: 10 },
        { type: 'line' as const, x1: x + 10, y1: 10, x2: x, y2: 10 },
        { type: 'line' as const, x1: x, y1: 10, x2: x, y2: 0 },
      ],
    });
    const result = engine.makePrism({
      shapeId: 'disjoint',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        { outer: square(0), holes: [] },
        { outer: square(20), holes: [] },
      ],
      distances: [5],
    });
    expect(result.stats.solids).toBe(2);
  });

  it('merges coplanar faces when fused regions share an edge', () => {
    const square = (x: number) => ({
      curves: [
        { type: 'line' as const, x1: x, y1: 0, x2: x + 10, y2: 0 },
        { type: 'line' as const, x1: x + 10, y1: 0, x2: x + 10, y2: 10 },
        { type: 'line' as const, x1: x + 10, y1: 10, x2: x, y2: 10 },
        { type: 'line' as const, x1: x, y1: 10, x2: x, y2: 0 },
      ],
    });
    // Two 10x10 squares side by side make one 20x10 box: the shared edge must
    // not leave the top and bottom split into two coplanar faces.
    const result = engine.makePrism({
      shapeId: 'joined',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        { outer: square(0), holes: [] },
        { outer: square(10), holes: [] },
      ],
      distances: [5],
    });
    expect(result.stats.solids).toBe(1);
    expect(result.stats.faces).toBe(6);
  });

  it('reports which faces a cut left untouched', () => {
    engine.makeBox({ shapeId: 'face-base', dx: 20, dy: 20, dz: 5, at: [-10, -10, 0] });
    engine.makeBox({ shapeId: 'face-tool', dx: 4, dy: 4, dz: 5, at: [-2, -2, 0] });
    const result = engine.booleanShape({
      shapeId: 'face-cut',
      baseShapeId: 'face-base',
      toolShapeId: 'face-tool',
      op: 'cut',
      trackFaces: true,
    });
    const map = result.facesFromBase;
    expect(map).toBeDefined();
    expect(map).toHaveLength(result.stats.faces);
    // The four sides of the plate survive the hole as they are; its top and
    // bottom are rebuilt around the hole but still belong to the plate. Only the
    // walls of the hole are new, so every base face is accounted for once.
    expect([...new Set(map!.filter((index) => index >= 0))].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    const created = map!.filter((index) => index < 0).length;
    expect(created).toBeGreaterThan(0);
    expect(created).toBeLessThan(result.stats.faces);
  });

  it('applies every placement of a tool in one boolean', () => {
    engine.makeBox({ shapeId: 'all-base', dx: 40, dy: 20, dz: 5, at: [-20, -10, 0] });
    engine.makeBox({ shapeId: 'all-tool', dx: 4, dy: 4, dz: 10, at: [-2, -2, 0] });
    const placements = [0, 10, -10].map((x) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0] as number[]);
    const together = engine.booleanAll({
      shapeId: 'all-one',
      baseShapeId: 'all-base',
      tools: placements.map((matrix) => ({ sourceShapeId: 'all-tool', matrix })),
      op: 'fuse',
      trackFaces: true,
    });
    expect(together.stats.solids).toBe(1);
    const mesh = engine.tessellate('all-one');
    // The plate plus three bosses standing 5 mm out of it.
    expect(meshSignedVolume(mesh)).toBeCloseTo(40 * 20 * 5 + 3 * (4 * 4 * 5), 0);

    // One call must mean the same as one call per placement.
    let current = 'all-base';
    for (const [index, matrix] of placements.entries()) {
      engine.transformShape({ shapeId: `seq-tool-${index}`, sourceShapeId: 'all-tool', matrix });
      const result = engine.booleanShape({
        shapeId: `seq-${index}`,
        baseShapeId: current,
        toolShapeId: `seq-tool-${index}`,
        op: 'fuse',
      });
      expect(result.stats.solids).toBe(1);
      current = `seq-${index}`;
    }
    expect(meshSignedVolume(engine.tessellate(current))).toBeCloseTo(meshSignedVolume(mesh), 3);
  });

  it('applies every placement even when the copies overlap', () => {
    // A row of cubes closer than their own size. A boolean reads its arguments
    // as shapes that keep apart, so a copy hidden inside another would drop out
    // and the row would come out short.
    engine.makeBox({ shapeId: 'row-box', dx: 20, dy: 20, dz: 20 });
    const placements = [10, 20].map((x) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0] as number[]);
    const fused = engine.booleanAll({
      shapeId: 'row-all',
      baseShapeId: 'row-box',
      tools: placements.map((matrix) => ({ sourceShapeId: 'row-box', matrix })),
      op: 'fuse',
      trackFaces: true,
    });
    expect(fused.stats.solids).toBe(1);
    const mesh = engine.tessellate('row-all');
    expect(mesh.bbox.max[0]).toBeCloseTo(40, 6);
    expect(meshSignedVolume(mesh)).toBeCloseTo(40 * 20 * 20, 0);
  });

  it('leaves a copy that lands away from the body a solid of its own', () => {
    engine.makeBox({ shapeId: 'apart-box', dx: 20, dy: 20, dz: 20 });
    const placements = [10, 60].map((x) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0] as number[]);
    const fused = engine.booleanAll({
      shapeId: 'apart-all',
      baseShapeId: 'apart-box',
      tools: placements.map((matrix) => ({ sourceShapeId: 'apart-box', matrix })),
      op: 'fuse',
    });
    expect(fused.stats.solids).toBe(2);
    const mesh = engine.tessellate('apart-all');
    expect(mesh.bbox.max[0]).toBeCloseTo(80, 6);
    // The near copy grows the body into a 30 mm bar; the far one stays alone.
    expect(meshSignedVolume(mesh)).toBeCloseTo(30 * 20 * 20 + 20 * 20 * 20, 0);
  });

  it('keeps a fused pair of rings a whole body', () => {
    // Two rings of one tube share their surface in two separate regions, and
    // merging those regions into one face tears the body open: the union has to
    // stay closed, with every face drawn.
    engine.makePrimitive({
      shapeId: 'ring-a',
      kind: 'torus',
      majorRadius: 20,
      tubeRadius: 5,
    });
    engine.makePrimitive({
      shapeId: 'ring-b',
      kind: 'torus',
      majorRadius: 20,
      tubeRadius: 5,
    });
    engine.transformShape({
      shapeId: 'ring-b-moved',
      sourceShapeId: 'ring-b',
      matrix: [1, 0, 0, 26.6, 0, 1, 0, 0, 0, 0, 1, 0],
    });
    const fused = engine.booleanShape({
      shapeId: 'rings',
      baseShapeId: 'ring-a',
      toolShapeId: 'ring-b-moved',
      op: 'fuse',
    });
    expect(fused.stats.solids).toBe(1);
    const mesh = engine.tessellate('rings');
    expect(mesh.bbox.max[0]).toBeCloseTo(51.6, 3);
    expect(new Set(mesh.faceIds).size).toBe(fused.stats.faces);
    // Both rings, less the crust they get from each other.
    expect(Math.abs(meshSignedVolume(mesh))).toBeGreaterThan(18000);
    expect(Math.abs(meshSignedVolume(mesh))).toBeLessThan(2 * 9870);
  });

  it('splits a cut that separates a body into independent solids', () => {
    engine.makeBox({ shapeId: 'split-base', dx: 20, dy: 20, dz: 20 });
    engine.makeBox({ shapeId: 'split-tool', dx: 22, dy: 2, dz: 22, at: [-1, 9, -1] });
    const cut = engine.booleanShape({
      shapeId: 'split-cut',
      baseShapeId: 'split-base',
      toolShapeId: 'split-tool',
      op: 'cut',
      trackFaces: true,
    });
    expect(cut.stats.solids).toBe(2);

    const split = engine.splitSolids({ shapeId: 'split-cut', prefix: 'split-part' });
    expect(split.solids).toHaveLength(2);
    expect(split.solids.map((solid) => solid.shapeId)).toEqual([
      'split-part:solid-0',
      'split-part:solid-1',
    ]);

    const totals: number[] = [];
    for (const solid of split.solids) {
      expect(solid.stats.solids).toBe(1);
      expect(solid.facesFromShape).toHaveLength(solid.stats.faces);
      expect(solid.volume).toBeGreaterThan(0);
      totals.push(solid.volume);
      const mesh = engine.tessellate(solid.shapeId);
      expect(Math.abs(meshSignedVolume(mesh))).toBeCloseTo(solid.volume, 2);
    }
    expect(totals[0]! + totals[1]!).toBeCloseTo(20 * 20 * 20 - 20 * 2 * 20, 3);

    // Faces the cut left untouched are the same B-rep faces and belong to
    // exactly one part; rebuilt faces report -1.
    const moved = split.solids.flatMap((solid) =>
      solid.facesFromShape.filter((index) => index >= 0),
    );
    expect(moved.length).toBeGreaterThan(0);
    expect(new Set(moved).size).toBe(moved.length);
  });

  it('fillets one edge of a box', () => {
    engine.makeBox({ shapeId: 'fillet-box', dx: 10, dy: 10, dz: 10 });
    const mesh = engine.tessellate('fillet-box');
    const edge = mesh.edges![0]!;
    const result = engine.treatEdges({
      shapeId: 'fillet-result',
      sourceShapeId: 'fillet-box',
      kind: 'fillet',
      faceIds: [],
      edgeIds: [edge.id],
      size: 2,
    });
    expect(result.applied).toBe(2);
    expect(result.edgeCount).toBe(1);
    // Two faces get a rounded corner, the operation adds the third.
    expect(result.stats.faces).toBe(7);
    // The faces the fillet only trimmed keep their source; the rounded surface
    // is the only new one.
    const trimmed = result.facesFromBase.filter((from) => from >= 0);
    expect(trimmed).toHaveLength(6);
    expect(result.facesFromBase.filter((from) => from < 0)).toHaveLength(1);
    expect(result.stats.solids).toBe(1);
    const rounded = engine.tessellate('fillet-result');
    // The rounded corner removes (1 − π/4)·r² per unit of length.
    expect(meshSignedVolume(rounded)).toBeLessThan(1000);
    expect(meshSignedVolume(rounded)).toBeGreaterThan(990);
  });

  it('keeps every trimmed face when two rounds meet', () => {
    engine.makeBox({ shapeId: 'pair-box', dx: 10, dy: 10, dz: 10 });
    const mesh = engine.tessellate('pair-box');
    const edges = mesh.edges!;
    const point = (edge: (typeof edges)[number], index: number) =>
      edge.points.slice(index * 3, index * 3 + 3).join(',');
    const first = edges[0]!;
    // Two edges that share a corner: their rounds meet, which trims the faces
    // between them from both sides.
    const second = edges.find(
      (edge) =>
        edge !== first &&
        [0, edge.points.length / 3 - 1].some((index) =>
          [point(first, 0), point(first, first.points.length / 3 - 1)].includes(point(edge, index)),
        ),
    )!;
    const result = engine.treatEdges({
      shapeId: 'pair-fillet',
      sourceShapeId: 'pair-box',
      kind: 'fillet',
      faceIds: [],
      edgeIds: [first.id, second.id],
      size: 2,
    });
    expect(result.applied).toBe(2);
    // No face of the box may be reported as new: every one of them still says
    // where it came from, and only the surfaces the rounds create are new.
    expect(result.facesFromBase.filter((from) => from >= 0).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.facesFromBase.filter((from) => from < 0).length).toBeGreaterThanOrEqual(2);
    expect(result.stats.solids).toBe(1);
  });

  it('rounds a chain the kernel rejects as one set', () => {
    // An L-shaped wall: the notch has a concave floor edge that meets a convex
    // edge at either end. Asked for together, OCCT rejects the whole set.
    const outline: Array<[number, number]> = [
      [-23.5, 0.5],
      [-23.5, -9],
      [30, -9],
      [30, 34],
      [22.5, 34],
      [22.5, 0.5],
    ];
    engine.makePrism({
      shapeId: 'chain-prism',
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      distances: [35.8],
      regions: [
        {
          outer: {
            curves: outline.map((point, index) => {
              const next = outline[(index + 1) % outline.length]!;
              return {
                type: 'line' as const,
                x1: point[0],
                y1: point[1],
                x2: next[0],
                y2: next[1],
              };
            }),
          },
          holes: [],
        },
      ],
    });
    const mesh = engine.tessellate('chain-prism');
    const middle = (edge: NonNullable<typeof mesh.edges>[number]) => {
      const points = edge.points;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let index = 0; index < points.length; index += 3) {
        x += points[index]!;
        y += points[index + 1]!;
        z += points[index + 2]!;
      }
      const count = points.length / 3;
      return [x / count, y / count, z / count];
    };
    const edgeThrough = (x: number, y: number, z: number) => {
      const found = mesh.edges!.find((edge) => {
        const [mx, my, mz] = middle(edge);
        return Math.hypot(mx! - x, my! - y, mz! - z) < 0.5;
      });
      expect(found, `edge near ${x},${y},${z}`).toBeDefined();
      return found!;
    };
    const chain = [
      edgeThrough(17.9, 22.5, 0.5),
      edgeThrough(0, -0.5, 0.5),
      edgeThrough(35.8, -0.5, 0.5),
    ];

    const result = engine.treatEdges({
      shapeId: 'chain-fillet',
      sourceShapeId: 'chain-prism',
      kind: 'fillet',
      faceIds: [],
      edgeIds: chain.map((edge) => edge.id),
      size: 2,
    });
    expect(result.applied).toBe(2);
    expect(result.stats.solids).toBe(1);
    const rounded = engine.tessellate('chain-fillet');
    const plain = meshSignedVolume(mesh);
    expect(meshSignedVolume(rounded)).toBeLessThan(plain);
    // Each round shaves a corner off, so the body only loses volume.
    expect(meshSignedVolume(rounded)).toBeGreaterThan(plain * 0.95);

    // A rebuild of the same selection keeps working below the limit.
    const again = engine.treatEdges({
      shapeId: 'chain-again',
      sourceShapeId: 'chain-prism',
      kind: 'fillet',
      faceIds: [],
      edgeIds: chain.map((edge) => edge.id),
      size: 2.5,
    });
    expect(again.applied).toBe(2.5);

    // A size that does not fit is still reduced rather than reported as fatal.
    const limited = engine.treatEdges({
      shapeId: 'chain-limited',
      sourceShapeId: 'chain-prism',
      kind: 'fillet',
      faceIds: [],
      edgeIds: chain.map((edge) => edge.id),
      size: 40,
    });
    expect(limited.applied).toBeGreaterThan(7);
    expect(limited.applied).toBeLessThan(40);
    expect(limited.stats.solids).toBe(1);
  });

  it('reads the corner of every edge it tessellates', () => {
    engine.makeBox({ shapeId: 'corner-box', dx: 10, dy: 10, dz: 10 });
    const mesh = engine.tessellate('corner-box');
    // Every edge of a box is convex and turns a right angle.
    for (const edge of mesh.edges!) {
      expect(edge.convex, edge.id).toBe(true);
      expect(edge.wedge).toBeCloseTo(Math.PI / 2, 3);
    }

    engine.makePrism({
      shapeId: 'corner-notch',
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      distances: [35.8],
      regions: [
        {
          outer: {
            curves: [
              [-23.5, 0.5],
              [-23.5, -9],
              [30, -9],
              [30, 34],
              [22.5, 34],
              [22.5, 0.5],
            ].map((point, index, all) => {
              const next = all[(index + 1) % all.length]!;
              return {
                type: 'line' as const,
                x1: point[0]!,
                y1: point[1]!,
                x2: next[0]!,
                y2: next[1]!,
              };
            }),
          },
          holes: [],
        },
      ],
    });
    const notch = engine.tessellate('corner-notch');
    // The floor of the notch is the one edge the material fills in behind.
    const concave = notch.edges!.filter((edge) => edge.convex === false);
    expect(concave).toHaveLength(1);
    expect(concave[0]!.points.slice(0, 3)).toEqual([0, 22.5, 0.5]);
    expect(concave[0]!.points.slice(-3)).toEqual([35.8, 22.5, 0.5]);
  });

  it('chamfers a chain of mixed corners in passes', () => {
    // A chamfer cannot be built across a corner it has to both fill in and
    // break: OCCT accepts that build and returns a chamfer folded over the
    // body. The engine builds such a set in passes, so the result keeps the
    // material the two kinds of chamfer leave.
    const outline: Array<[number, number]> = [
      [-23.5, 0.5],
      [-23.5, -9],
      [30, -9],
      [30, 34],
      [22.5, 34],
      [22.5, 0.5],
    ];
    engine.makePrism({
      shapeId: 'mixed-prism',
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      distances: [35.8],
      regions: [
        {
          outer: {
            curves: outline.map((point, index) => {
              const next = outline[(index + 1) % outline.length]!;
              return {
                type: 'line' as const,
                x1: point[0],
                y1: point[1],
                x2: next[0],
                y2: next[1],
              };
            }),
          },
          holes: [],
        },
      ],
    });
    const mesh = engine.tessellate('mixed-prism');
    const plain = meshSignedVolume(mesh);
    const chain = mesh.edges!.filter((edge) =>
      [
        [17.9, 22.5, 0.5],
        [0, -0.5, 0.5],
        [35.8, -0.5, 0.5],
      ].some((target) => {
        const middle = [0, 0, 0];
        for (let index = 0; index < edge.points.length; index += 3) {
          middle[0]! += edge.points[index]! / (edge.points.length / 3);
          middle[1]! += edge.points[index + 1]! / (edge.points.length / 3);
          middle[2]! += edge.points[index + 2]! / (edge.points.length / 3);
        }
        return (
          Math.hypot(middle[0]! - target[0]!, middle[1]! - target[1]!, middle[2]! - target[2]!) <
          0.5
        );
      }),
    );
    expect(chain).toHaveLength(3);

    const size = 4;
    const result = engine.treatEdges({
      shapeId: 'mixed-chamfer',
      sourceShapeId: 'mixed-prism',
      kind: 'chamfer',
      faceIds: [],
      edgeIds: chain.map((edge) => edge.id),
      size,
    });
    expect(result.applied).toBe(size);
    expect(result.stats.solids).toBe(1);
    // The concave edge fills in, the two convex ones break off: a right-angle
    // chamfer of `size` moves size²/2 per unit of length either way.
    const filled = size * size * 0.5 * 35.8;
    const broken = size * size * 0.5 * 46 * 2;
    const expected = plain + filled - broken;
    const volume = meshSignedVolume(engine.tessellate('mixed-chamfer'));
    // The corners where the chamfers meet account for a fraction of a percent.
    expect(Math.abs(volume - expected) / expected).toBeLessThan(0.005);
    // A build that folds a chamfer over the body loses several percent, which
    // is what this test is here for.
    expect(volume).toBeGreaterThan(expected * 0.99);
  });

  it('rounds the rim of a cylindrical boss', () => {
    engine.makePrism({
      shapeId: 'boss',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [{ outer: { curves: [{ type: 'circle', cx: 0, cy: 0, r: 10 }] }, holes: [] }],
      distances: [10],
    });
    const mesh = engine.tessellate('boss');
    // The rim is a closed polyline: start and end are the same point.
    const rim = mesh.edges!.find((edge) => edge.closed)!;
    const result = engine.treatEdges({
      shapeId: 'boss-fillet',
      sourceShapeId: 'boss',
      kind: 'fillet',
      faceIds: [],
      edgeIds: [rim.id],
      size: 1,
    });
    expect(result.applied).toBe(1);
    expect(result.stats.solids).toBe(1);
    // The fillet surface is new, the cap and the wall keep their identity.
    expect(result.facesFromBase.filter((from) => from < 0)).toHaveLength(1);
    const rounded = engine.tessellate('boss-fillet');
    expect(meshSignedVolume(rounded)).toBeLessThan(Math.PI * 100 * 10);
  });

  it('chamfers one edge of a box', () => {
    engine.makeBox({ shapeId: 'chamfer-box', dx: 10, dy: 10, dz: 10 });
    const mesh = engine.tessellate('chamfer-box');
    const edge = mesh.edges![0]!;
    const result = engine.treatEdges({
      shapeId: 'chamfer-result',
      sourceShapeId: 'chamfer-box',
      kind: 'chamfer',
      faceIds: [],
      edgeIds: [edge.id],
      size: 2,
    });
    expect(result.applied).toBe(2);
    expect(result.stats.faces).toBe(7);
    const chamfered = engine.tessellate('chamfer-result');
    // A 2 mm chamfer cuts a right triangle of 2×2/2 over the 10 mm edge.
    expect(meshSignedVolume(chamfered)).toBeCloseTo(1000 - 20, 1);
  });

  it('reduces a treatment that does not fit instead of failing', () => {
    engine.makeBox({ shapeId: 'oversize-box', dx: 10, dy: 10, dz: 10 });
    const mesh = engine.tessellate('oversize-box');
    const edges = mesh.edges!.map((edge) => edge.id);
    const result = engine.treatEdges({
      shapeId: 'oversize-result',
      sourceShapeId: 'oversize-box',
      kind: 'fillet',
      faceIds: [],
      edgeIds: edges,
      size: 50,
    });
    expect(result.applied).toBeGreaterThan(0);
    expect(result.applied).toBeLessThan(50);
    expect(result.limit).toBe(result.applied);
    expect(result.edgeCount).toBe(12);
    expect(result.stats.solids).toBe(1);
    const rounded = engine.tessellate('oversize-result');
    expect(meshSignedVolume(rounded)).toBeGreaterThan(500);
  });

  it('treats the boundary edges of a face', () => {
    engine.makeBox({ shapeId: 'face-box', dx: 10, dy: 10, dz: 10 });
    const mesh = engine.tessellate('face-box');
    // Pick the face of the first edge and treat only its rim.
    const faceId = mesh.edges![0]!.faceIds[0]!;
    const result = engine.treatEdges({
      shapeId: 'face-result',
      sourceShapeId: 'face-box',
      kind: 'chamfer',
      faceIds: [faceId],
      edgeIds: [],
      size: 1,
    });
    expect(result.edgeCount).toBe(4);
    expect(result.stats.faces).toBe(10);
  });

  it('rejects a treatment without edges and without a tessellated body', () => {
    engine.makeBox({ shapeId: 'empty-box', dx: 10, dy: 10, dz: 10 });
    engine.tessellate('empty-box');
    expect(() =>
      engine.treatEdges({
        shapeId: 'empty-result',
        sourceShapeId: 'empty-box',
        kind: 'fillet',
        faceIds: [],
        edgeIds: [],
        size: 1,
      }),
    ).toThrowError(KernelOpError);
    engine.makeBox({ shapeId: 'untessellated-box', dx: 10, dy: 10, dz: 10 });
    expect(() =>
      engine.treatEdges({
        shapeId: 'empty-result',
        sourceShapeId: 'untessellated-box',
        kind: 'fillet',
        faceIds: [],
        edgeIds: ['0'],
        size: 1,
      }),
    ).toThrowError(KernelOpError);
  });

  it('cuts one solid with another', () => {
    engine.makePrism({
      shapeId: 'plate',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line', x1: 0, y1: 0, x2: 20, y2: 0 },
              { type: 'line', x1: 20, y1: 0, x2: 20, y2: 20 },
              { type: 'line', x1: 20, y1: 20, x2: 0, y2: 20 },
              { type: 'line', x1: 0, y1: 20, x2: 0, y2: 0 },
            ],
          },
          holes: [],
        },
      ],
      distances: [5],
    });
    engine.makeBox({ shapeId: 'cutter', dx: 5, dy: 5, dz: 5 });
    const cut = engine.booleanShape({
      shapeId: 'cut-result',
      baseShapeId: 'plate',
      toolShapeId: 'cutter',
      op: 'cut',
    });
    expect(cut.stats.faces).toBeGreaterThan(6);
    const mesh = engine.tessellate('cut-result');
    expect(meshSignedVolume(mesh)).toBeCloseTo(20 * 20 * 5 - 5 * 5 * 5, -1);
  });

  it('rejects open sketch contours', () => {
    expect(() =>
      engine.makePrism({
        shapeId: 'open',
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        regions: [
          {
            outer: {
              curves: [
                { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
                { type: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
              ],
            },
            holes: [],
          },
        ],
        distances: [5],
      }),
    ).toThrowError(KernelOpError);
  });

  it('hollows a box into a closed cavity', () => {
    engine.makeBox({ shapeId: 'shell-cavity-box', dx: 20, dy: 20, dz: 20 });
    const result = engine.shell({
      shapeId: 'shell-cavity',
      sourceShapeId: 'shell-cavity-box',
      removeFaceIds: [],
      thickness: 2,
      offset: 0,
      direction: 'inward',
    });
    expect(result.applied).toBeCloseTo(2, 5);
    expect(result.stats.solids).toBe(1);
    // The wall has the outer and the inner faces of the box.
    expect(result.stats.faces).toBe(12);
    // The outside of the body is not the shell's: its six faces still name the
    // faces of the box, and only the six cavity faces are new.
    const map = result.facesFromBase;
    expect(map).toHaveLength(12);
    expect([...new Set(map!.filter((index) => index >= 0))].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(map!.filter((index) => index < 0)).toHaveLength(6);
    const mesh = engine.tessellate('shell-cavity');
    expect(meshSignedVolume(mesh)).toBeCloseTo(20 * 20 * 20 - 16 * 16 * 16, 0);
    expect(mesh.bbox.min).toEqual([0, 0, 0]);
    expect(mesh.bbox.max[0]).toBeCloseTo(20, 5);
  });

  it('leaves the picked face open in a cavity', () => {
    engine.makeBox({ shapeId: 'shell-open-box', dx: 20, dy: 20, dz: 20 });
    const box = engine.tessellate('shell-open-box');
    const top = faceFacing(box, [0, 0, 1]);
    expect(top).toBeGreaterThanOrEqual(0);
    const result = engine.shell({
      shapeId: 'shell-open',
      sourceShapeId: 'shell-open-box',
      removeFaceIds: [top],
      thickness: 2,
      offset: 0,
      direction: 'inward',
    });
    expect(result.applied).toBeCloseTo(2, 5);
    const mesh = engine.tessellate('shell-open');
    // 20³ minus the 16×16×18 cavity that reaches the open top.
    expect(meshSignedVolume(mesh)).toBeCloseTo(20 * 20 * 20 - 16 * 16 * 18, 0);
  });

  it('grows an outward shell around a body', () => {
    engine.makeBox({ shapeId: 'shell-out-box', dx: 20, dy: 20, dz: 20 });
    const result = engine.shell({
      shapeId: 'shell-out',
      sourceShapeId: 'shell-out-box',
      removeFaceIds: [],
      thickness: 2,
      offset: 0,
      direction: 'outward',
    });
    expect(result.applied).toBeCloseTo(2, 5);
    const mesh = engine.tessellate('shell-out');
    expect(mesh.bbox.min[0]).toBeCloseTo(-2, 3);
    expect(mesh.bbox.max[0]).toBeCloseTo(22, 3);
    expect(meshSignedVolume(mesh)).toBeCloseTo(24 * 24 * 24 - 20 * 20 * 20, -1);
  });

  it('keeps the requested gap between a body and its outward shell', () => {
    engine.makeBox({ shapeId: 'shell-gap-box', dx: 20, dy: 20, dz: 20 });
    engine.shell({
      shapeId: 'shell-gap',
      sourceShapeId: 'shell-gap-box',
      removeFaceIds: [],
      thickness: 2,
      offset: 2,
      direction: 'outward',
    });
    const mesh = engine.tessellate('shell-gap');
    expect(mesh.bbox.min[0]).toBeCloseTo(-4, 3);
    expect(mesh.bbox.max[0]).toBeCloseTo(24, 3);
    expect(meshSignedVolume(mesh)).toBeCloseTo(28 * 28 * 28 - 24 * 24 * 24, -1);
  });

  it('reduces a shell thickness that does not fit instead of failing', () => {
    engine.makeBox({ shapeId: 'shell-thick-box', dx: 20, dy: 20, dz: 20 });
    const result = engine.shell({
      shapeId: 'shell-thick',
      sourceShapeId: 'shell-thick-box',
      removeFaceIds: [],
      thickness: 50,
      offset: 0,
      direction: 'inward',
    });
    expect(result.applied).toBeGreaterThan(0.01);
    expect(result.applied).toBeLessThan(10);
    const mesh = engine.tessellate('shell-thick');
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0);
    expect(meshSignedVolume(mesh)).toBeLessThan(20 * 20 * 20);
  });

  it('disposes shapes', () => {
    engine.clear();
    engine.makeBox({ shapeId: 'box-1', dx: 20, dy: 10, dz: 5 });
    expect(engine.dispose('box-1')).toBe(true);
    expect(engine.dispose('box-1')).toBe(false);
    expect(engine.shapeCount).toBe(0);
  });

  it('centres a face on the middle of its extent, not on its material', () => {
    // A square plate with a corner notched out: the material sits in the
    // remaining L, so its centre of mass is at 13.57 in both axes, while the
    // middle of the face — where a turn around it belongs — is at 20.
    engine.makeBox({ shapeId: 'notch-plate', dx: 40, dy: 40, dz: 5 });
    engine.makeBox({ shapeId: 'notch-tool', dx: 30, dy: 30, dz: 10, at: [10, 10, -2] });
    engine.booleanShape({
      shapeId: 'notched',
      baseShapeId: 'notch-plate',
      toolShapeId: 'notch-tool',
      op: 'cut',
    });
    const mesh = engine.tessellate('notched');
    const faceId = faceFacing(mesh, [0, 0, 1]);
    const { origin } = engine.faceCentre({
      shapeId: 'notched',
      faceId,
      normal: faceNormals(mesh).get(faceId)!,
    });
    expect(origin[0]).toBeCloseTo(20, 9);
    expect(origin[1]).toBeCloseTo(20, 9);
    expect(origin[2]).toBeCloseTo(5, 9);
  });

  it('centres a flat face whose surface an offset re-stored as a spline', () => {
    // Hollowing a body turns its flat faces into B-spline surfaces that still
    // lie exactly in a plane, so asking a face for its surface type would refuse
    // the very faces of a shelled part. The boundary curves stay lines and
    // circles, and they are what the extent is measured from.
    engine.makeBox({ shapeId: 'offset-box', dx: 40, dy: 20, dz: 10 });
    engine.shell({
      shapeId: 'offset-shell',
      sourceShapeId: 'offset-box',
      removeFaceIds: [],
      thickness: 2,
      offset: 0,
      direction: 'inward',
    });
    const mesh = engine.tessellate('offset-shell');
    // The outer top face is the largest one facing up; the cavity's own top face
    // is smaller and sits lower.
    const faceId = faceFacing(mesh, [0, 0, 1]);
    const { origin } = engine.faceCentre({
      shapeId: 'offset-shell',
      faceId,
      normal: faceNormals(mesh).get(faceId)!,
    });
    expect(origin[0]).toBeCloseTo(20, 6);
    expect(origin[1]).toBeCloseTo(10, 6);
    expect(origin[2]).toBeCloseTo(10, 6);
  });

  it('reaches the exact extreme of an arc when it centres a face', () => {
    // A disc with a slice cut off: the face is a circular segment whose
    // bounding box runs from -10 to 3 in x, so its middle is -3.5. A
    // tessellated arc stops short of its own extreme by the sagitta of its
    // chords, which is what this cannot afford.
    engine.makePrimitive({ shapeId: 'slice-disc', kind: 'cylinder', radius: 10, height: 5 });
    engine.makeBox({ shapeId: 'slice-tool', dx: 20, dy: 40, dz: 20, at: [3, -20, -5] });
    engine.booleanShape({
      shapeId: 'sliced',
      baseShapeId: 'slice-disc',
      toolShapeId: 'slice-tool',
      op: 'cut',
    });
    const mesh = engine.tessellate('sliced');
    const faceId = faceFacing(mesh, [0, 0, 1]);
    const { origin } = engine.faceCentre({
      shapeId: 'sliced',
      faceId,
      normal: faceNormals(mesh).get(faceId)!,
    });
    expect(origin[0]).toBeCloseTo(-3.5, 6);
    // The segment is still symmetric across the x axis, and its top and bottom
    // are the middle of the arc, far from any chord end.
    expect(Math.abs(origin[1])).toBeLessThan(1e-9);
    expect(origin[2]).toBeCloseTo(5, 6);
  });

  it('measures a slanted face in the axes of its own plane', () => {
    engine.makeBox({ shapeId: 'slanted-box', dx: 40, dy: 40, dz: 5 });
    const angle = Math.PI / 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const matrix = [cos, 0, sin, 0, 0, 1, 0, 0, -sin, 0, cos, 0];
    engine.transformShape({ shapeId: 'slanted', sourceShapeId: 'slanted-box', matrix });
    const mesh = engine.tessellate('slanted');
    const faceId = faceFacing(mesh, [sin, 0, cos]);
    const { origin } = engine.faceCentre({
      shapeId: 'slanted',
      faceId,
      normal: faceNormals(mesh).get(faceId)!,
    });
    // The middle of the face follows the solid, so the placement carries it.
    const expected = [20 * cos + 5 * sin, 20, 5 * cos - 20 * sin];
    for (const [index, value] of expected.entries()) {
      expect(origin[index]).toBeCloseTo(value, 9);
    }
  });

  it('refuses to centre a face that is not flat', () => {
    engine.makePrimitive({ shapeId: 'round-body', kind: 'cylinder', radius: 10, height: 5 });
    const mesh = engine.tessellate('round-body');
    const side = faceFacing(mesh, [1, 0, 0]);
    expect(() =>
      engine.faceCentre({
        shapeId: 'round-body',
        faceId: side,
        normal: faceNormals(mesh).get(side)!,
      }),
    ).toThrow(KernelOpError);
  });
  // "To body" extrudes trim their tool against the body they end on instead of
  // cutting it with a plane, so the end face follows any surface (ADR 0035).
  // The recipe a "to body" extent follows: cut the prism with the body whose
  // surface is moved out by the gap, drop what the prism keeps behind it, and
  // read the ending face off the result.
  describe('extrude to a body', () => {
    /** A cylinder of radius 20 standing between z = 0 and z = 40. */
    const cylinder = () =>
      engine.makePrimitive({
        shapeId: 'probe-cylinder',
        kind: 'cylinder',
        radius: 20,
        height: 40,
        at: [0, 0, 0],
      });

    /** A 10 by 10 column sweeping along +X from x = -60 through the cylinder. */
    const profile = (shapeId: string, distances: number[]) =>
      engine.makePrism({
        shapeId,
        origin: [-60, 0, 20],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        regions: [
          {
            outer: {
              curves: [
                { type: 'line', x1: -5, y1: -5, x2: 5, y2: -5 },
                { type: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
                { type: 'line', x1: 5, y1: 5, x2: -5, y2: 5 },
                { type: 'line', x1: -5, y1: 5, x2: -5, y2: -5 },
              ],
            },
            holes: [],
          },
        ],
        distances,
      });

    /** Where the cylinder's surface stands at the profile's edge. */
    const surfaceAt = Math.sqrt(20 * 20 - 5 * 5);
    /** Reach from the profile plane past the whole body. */
    const fullReach = 60 + 20 + 1;

    it('moves the surface of a body out by the same distance everywhere', () => {
      cylinder();
      engine.offsetShape({ shapeId: 'grown', sourceShapeId: 'probe-cylinder', distance: 2.5 });
      const mesh = engine.tessellate('grown');
      // Radius 22.5 and a height that grew at both ends.
      expect(mesh.bbox.min[0]).toBeCloseTo(-22.5, 1);
      expect(mesh.bbox.min[2]).toBeCloseTo(-2.5, 2);
      expect(mesh.bbox.max[2]).toBeCloseTo(42.5, 2);
      engine.offsetShape({ shapeId: 'shrunk', sourceShapeId: 'probe-cylinder', distance: -2.5 });
      expect(engine.tessellate('shrunk').bbox.max[0]).toBeCloseTo(17.5, 1);
    });

    it('ends a front extent on the face that looks at the profile', () => {
      cylinder();
      profile('front-prism', [fullReach]);
      const air = engine.booleanShape({
        shapeId: 'front-air',
        baseShapeId: 'front-prism',
        toolShapeId: 'probe-cylinder',
        op: 'cut',
      });
      // The prism passes the body, so what it keeps behind it is a solid of its
      // own: only the part at the profile plane belongs to the extent.
      expect(air.stats.solids).toBe(2);
      const parts = engine.splitSolids({ shapeId: 'front-air', prefix: 'front' });
      const atPlane = parts.solids.filter(
        (solid) => engine.tessellate(solid.shapeId).bbox.min[0] < -60 + 0.01,
      );
      expect(atPlane).toHaveLength(1);
      const mesh = engine.tessellate(atPlane[0]!.shapeId);
      // The column stops on the near side of the cylinder, following it.
      expect(mesh.bbox.min[0]).toBeCloseTo(-60, 5);
      expect(mesh.bbox.max[0]).toBeCloseTo(-surfaceAt, 4);
    });

    it('leaves the gap it is asked for in front of the face', () => {
      cylinder();
      for (const gap of [2, 5]) {
        engine.offsetShape({
          shapeId: `grown-${gap}`,
          sourceShapeId: 'probe-cylinder',
          distance: gap,
        });
        profile(`gap-prism-${gap}`, [fullReach]);
        engine.booleanShape({
          shapeId: `gap-air-${gap}`,
          baseShapeId: `gap-prism-${gap}`,
          toolShapeId: `grown-${gap}`,
          op: 'cut',
        });
        const parts = engine.splitSolids({ shapeId: `gap-air-${gap}`, prefix: `gap-${gap}` });
        const kept = parts.solids.find(
          (solid) => engine.tessellate(solid.shapeId).bbox.min[0] < -60 + 0.01,
        )!;
        // The end is the cylinder's surface moved out by the gap, which is not
        // the same as the surface pushed along one axis: the offset grows the
        // radius, so the end sits a little further out at the profile's edge.
        const mesh = engine.tessellate(kept.shapeId);
        expect(mesh.bbox.max[0]).toBeCloseTo(-Math.sqrt((20 + gap) ** 2 - 25), 1);
      }
    });

    it('reaches the far face for a back extent', () => {
      cylinder();
      profile('back-prism', [fullReach]);
      engine.booleanShape({
        shapeId: 'back-front',
        baseShapeId: 'back-prism',
        toolShapeId: 'probe-cylinder',
        op: 'cut',
      });
      engine.booleanShape({
        shapeId: 'back-material',
        baseShapeId: 'back-prism',
        toolShapeId: 'probe-cylinder',
        op: 'common',
      });
      const front = engine
        .splitSolids({ shapeId: 'back-front', prefix: 'back' })
        .solids.find((solid) => engine.tessellate(solid.shapeId).bbox.min[0] < -60 + 0.01)!;
      const result = engine.booleanShape({
        shapeId: 'back-column',
        baseShapeId: front.shapeId,
        toolShapeId: 'back-material',
        op: 'fuse',
      });
      expect(result.stats.solids).toBe(1);
      const mesh = engine.tessellate('back-column');
      // From the profile plane to the far side, in one piece.
      expect(mesh.bbox.min[0]).toBeCloseTo(-60, 5);
      expect(mesh.bbox.max[0]).toBeCloseTo(20, 4);
    });

    it('joins a front extent to the body it ends on', () => {
      cylinder();
      // The face the union lands on is passed by a hair, so the tool shares
      // material with the body instead of only touching it.
      engine.offsetShape({ shapeId: 'shrunk', sourceShapeId: 'probe-cylinder', distance: -0.01 });
      profile('union-prism', [fullReach]);
      engine.booleanShape({
        shapeId: 'union-air',
        baseShapeId: 'union-prism',
        toolShapeId: 'shrunk',
        op: 'cut',
      });
      const parts = engine.splitSolids({ shapeId: 'union-air', prefix: 'union' });
      const kept = parts.solids.find(
        (solid) => engine.tessellate(solid.shapeId).bbox.min[0] < -60 + 0.01,
      )!;
      const joined = engine.booleanShape({
        shapeId: 'union-body',
        baseShapeId: 'probe-cylinder',
        toolShapeId: kept.shapeId,
        op: 'fuse',
      });
      // A boss standing on the wall is one body with it.
      expect(joined.stats.solids).toBe(1);
      expect(engine.tessellate('union-body').bbox.min[0]).toBeCloseTo(-60, 5);
    });

    it('leaves a layer of the requested thickness on the face', () => {
      cylinder();
      engine.offsetShape({ shapeId: 'grown', sourceShapeId: 'probe-cylinder', distance: 2 });
      profile('layer-prism', [fullReach]);
      engine.booleanShape({
        shapeId: 'layer-air',
        baseShapeId: 'layer-prism',
        toolShapeId: 'probe-cylinder',
        op: 'cut',
      });
      const parts = engine.splitSolids({ shapeId: 'layer-air', prefix: 'layer' });
      const near = parts.solids.find(
        (solid) => engine.tessellate(solid.shapeId).bbox.min[0] < -60 + 0.01,
      )!;
      engine.booleanShape({
        shapeId: 'layer-air-outer',
        baseShapeId: 'layer-prism',
        toolShapeId: 'grown',
        op: 'cut',
      });
      const layer = engine.booleanShape({
        shapeId: 'layer-shell',
        baseShapeId: near.shapeId,
        toolShapeId: 'layer-air-outer',
        op: 'cut',
      });
      expect(layer.stats.solids).toBe(1);
      // Two millimetres of wall standing on the cylinder's near side, over the
      // whole profile: the shell between radius 20 and radius 22.
      let expected = 0;
      const steps = 400;
      for (let step = 0; step < steps; step += 1) {
        const y = -5 + (10 * (step + 0.5)) / steps;
        expected += Math.sqrt(484 - y * y) - Math.sqrt(400 - y * y);
      }
      // Ten millimetres of the profile along the cylinder's axis.
      expected *= (10 / steps) * 10;
      expect(meshSignedVolume(engine.tessellate('layer-shell')) / expected).toBeCloseTo(1, 1);
    });
  });

  // A sphere is met at uneven depths under one profile, which is where a single
  // prism reach fails: it keeps a sliver of air behind the body.
  describe('extrude to a curved body', () => {
    /** A ball of radius 10 at the origin. */
    const ball = () =>
      engine.makePrimitive({ shapeId: 'probe-ball', kind: 'sphere', radius: 10, at: [0, 0, 0] });

    /** A 12 by 12 square 30 mm above the ball, sweeping down through it. */
    const sweep = (shapeId: string, distances: number[]) =>
      engine.makePrism({
        shapeId,
        origin: [0, 0, 30],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        regions: [
          {
            outer: {
              curves: [
                { type: 'line', x1: -6, y1: -6, x2: 6, y2: -6 },
                { type: 'line', x1: 6, y1: -6, x2: 6, y2: 6 },
                { type: 'line', x1: 6, y1: 6, x2: -6, y2: 6 },
                { type: 'line', x1: -6, y1: 6, x2: -6, y2: -6 },
              ],
            },
            holes: [],
          },
        ],
        distances,
      });

    /** Volume of the column from the profile down to a sphere of this radius. */
    const columnDownTo = (radius: number) => {
      const steps = 200;
      let expected = 0;
      for (let x = 0; x < steps; x += 1) {
        for (let y = 0; y < steps; y += 1) {
          const px = -6 + (12 * (x + 0.5)) / steps;
          const py = -6 + (12 * (y + 0.5)) / steps;
          expected += 30 - Math.sqrt(radius * radius - px * px - py * py);
        }
      }
      return expected * (12 / steps) * (12 / steps);
    };

    it('keeps nothing behind the ball it ends on', () => {
      ball();
      sweep('curved-prism', [-41]);
      const tool = engine.booleanShape({
        shapeId: 'curved-air',
        baseShapeId: 'curved-prism',
        toolShapeId: 'probe-ball',
        op: 'cut',
      });
      // The prism passes the ball, so what it keeps beyond it is a solid of its
      // own, cut off by the ball: an extent keeps only the part at the plane.
      expect(tool.stats.solids).toBe(2);
      const split = engine.splitSolids({ shapeId: 'curved-air', prefix: 'curved' });
      const front = split.solids.find(
        (solid) => engine.tessellate(solid.shapeId).bbox.max[2] > 29,
      )!;
      const behind = split.solids.find((solid) => solid !== front)!;
      const mesh = engine.tessellate(front.shapeId);
      // The column from the profile down to the ball, over the whole profile.
      expect(mesh.bbox.max[2]).toBeCloseTo(30, 6);
      // Faceting of the sphere, not geometry from behind it, is the difference.
      expect(meshSignedVolume(mesh) / columnDownTo(10)).toBeCloseTo(1, 2);
      // What is behind the ball, and must not reach the result.
      expect(engine.tessellate(behind.shapeId).bbox.max[2]).toBeCloseTo(-5.29, 2);
    });

    it('leaves a gap of the same size all round a sphere', () => {
      ball();
      engine.offsetShape({ shapeId: 'probe-ball-grown', sourceShapeId: 'probe-ball', distance: 2 });
      sweep('gap-prism', [-41]);
      engine.booleanShape({
        shapeId: 'gap-air',
        baseShapeId: 'gap-prism',
        toolShapeId: 'probe-ball-grown',
        op: 'cut',
      });
      const split = engine.splitSolids({ shapeId: 'gap-air', prefix: 'gap' });
      const front = split.solids.find(
        (solid) => engine.tessellate(solid.shapeId).bbox.max[2] > 29,
      )!;
      // The gap is a sphere of its own: the surface of the ball moved out by two,
      // so the distance is two everywhere and not just under the middle.
      expect(meshSignedVolume(engine.tessellate(front.shapeId)) / columnDownTo(12)).toBeCloseTo(
        1,
        2,
      );
    });

    it('leaves a layer on a curved face: a shell, not a flat-ended cap', () => {
      ball();
      engine.offsetShape({ shapeId: 'probe-ball-out', sourceShapeId: 'probe-ball', distance: 3 });
      sweep('layer-prism', [-41]);
      engine.booleanShape({
        shapeId: 'layer-air',
        baseShapeId: 'layer-prism',
        toolShapeId: 'probe-ball',
        op: 'cut',
      });
      engine.booleanShape({
        shapeId: 'layer-air-outer',
        baseShapeId: 'layer-prism',
        toolShapeId: 'probe-ball-out',
        op: 'cut',
      });
      const split = engine.splitSolids({ shapeId: 'layer-air', prefix: 'layer' });
      const near = split.solids.find((solid) => engine.tessellate(solid.shapeId).bbox.max[2] > 29)!;
      const layer = engine.booleanShape({
        shapeId: 'curved-layer',
        baseShapeId: near.shapeId,
        toolShapeId: 'layer-air-outer',
        op: 'cut',
      });
      expect(layer.stats.solids).toBe(1);
      // The shell between radius 10 and radius 13 over the profile's shadow.
      const steps = 200;
      let expected = 0;
      for (let x = 0; x < steps; x += 1) {
        for (let y = 0; y < steps; y += 1) {
          const px = -6 + (12 * (x + 0.5)) / steps;
          const py = -6 + (12 * (y + 0.5)) / steps;
          const rho = px * px + py * py;
          expected += Math.sqrt(169 - rho) - Math.sqrt(100 - rho);
        }
      }
      expected *= (12 / steps) * (12 / steps);
      expect(meshSignedVolume(engine.tessellate('curved-layer')) / expected).toBeCloseTo(1, 1);
    });
  });

  it('refuses to centre a face that is not flat', () => {
    engine.makePrimitive({ shapeId: 'round-body', kind: 'cylinder', radius: 10, height: 5 });
    const mesh = engine.tessellate('round-body');
    const side = faceFacing(mesh, [1, 0, 0]);
    expect(() =>
      engine.faceCentre({
        shapeId: 'round-body',
        faceId: side,
        normal: faceNormals(mesh).get(side)!,
      }),
    ).toThrow(KernelOpError);
  });
  // "To body" extrudes trim their tool against the body they end on instead of
  // cutting it with a plane, so the end face follows any surface (ADR 0035).
  describe('extrude to a body', () => {
    /** A cylinder of radius 20 standing between z = 0 and z = 40. */
    const cylinder = () =>
      engine.makePrimitive({
        shapeId: 'probe-cylinder',
        kind: 'cylinder',
        radius: 20,
        height: 40,
        at: [0, 0, 0],
      });

    /** A 10 by 10 column sweeping along +X from x = -60 through the cylinder. */
    const profile = () => ({
      shapeId: 'probe-prism',
      origin: [-60, 0, 20] as [number, number, number],
      xAxis: [0, 1, 0] as [number, number, number],
      yAxis: [0, 0, 1] as [number, number, number],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line' as const, x1: -5, y1: -5, x2: 5, y2: -5 },
              { type: 'line' as const, x1: 5, y1: -5, x2: 5, y2: 5 },
              { type: 'line' as const, x1: 5, y1: 5, x2: -5, y2: 5 },
              { type: 'line' as const, x1: -5, y1: 5, x2: -5, y2: -5 },
            ],
          },
          holes: [],
        },
      ],
      distances: [120],
    });

    /** Where the cylinder's surface stands at the profile's edge. */
    const surfaceAt = Math.sqrt(20 * 20 - 5 * 5);
    /** Reach from the profile plane to the deepest point of the near face. */
    const frontReach = 60 - surfaceAt;

    it('ends a front extent on the face that looks at the profile', () => {
      cylinder();
      engine.makePrism({ ...profile(), distances: [frontReach] });
      engine.booleanShape({
        shapeId: 'front-air',
        baseShapeId: 'probe-prism',
        toolShapeId: 'probe-cylinder',
        op: 'cut',
      });
      const mesh = engine.tessellate('front-air');
      // The column stops on the near side of the cylinder, following it, and
      // leaves nothing behind the far face.
      expect(mesh.bbox.min[0]).toBeCloseTo(-60, 5);
      expect(mesh.bbox.max[0]).toBeCloseTo(-surfaceAt, 4);
      expect(mesh.bbox.max[2]).toBeGreaterThan(20);
    });

    it('reaches the far face for a back extent', () => {
      cylinder();
      engine.makePrism(profile());
      engine.makePrism({ ...profile(), shapeId: 'probe-front', distances: [frontReach] });
      engine.booleanShape({
        shapeId: 'back-front',
        baseShapeId: 'probe-front',
        toolShapeId: 'probe-cylinder',
        op: 'cut',
      });
      engine.booleanShape({
        shapeId: 'back-material',
        baseShapeId: 'probe-prism',
        toolShapeId: 'probe-cylinder',
        op: 'common',
      });
      const result = engine.booleanShape({
        shapeId: 'back-column',
        baseShapeId: 'back-front',
        toolShapeId: 'back-material',
        op: 'fuse',
      });
      expect(result.stats.solids).toBe(1);
      const mesh = engine.tessellate('back-column');
      // From the profile plane to the far side, in one piece.
      expect(mesh.bbox.min[0]).toBeCloseTo(-60, 5);
      expect(mesh.bbox.max[0]).toBeCloseTo(20, 4);
    });

    it('joins a front extent to the body it ends on', () => {
      cylinder();
      engine.makePrism({ ...profile(), distances: [frontReach] });
      engine.booleanShape({
        shapeId: 'union-air',
        baseShapeId: 'probe-prism',
        toolShapeId: 'probe-cylinder',
        op: 'cut',
      });
      const joined = engine.booleanShape({
        shapeId: 'union-body',
        baseShapeId: 'probe-cylinder',
        toolShapeId: 'union-air',
        op: 'fuse',
      });
      // A boss standing on the wall is one body with it.
      expect(joined.stats.solids).toBe(1);
      const mesh = engine.tessellate('union-body');
      expect(mesh.bbox.min[0]).toBeCloseTo(-60, 5);
    });

    it('leaves a layer of the requested thickness on the face', () => {
      cylinder();
      engine.makePrism(profile());
      engine.transformShape({
        shapeId: 'probe-cylinder-moved',
        sourceShapeId: 'probe-cylinder',
        matrix: [1, 0, 0, -2, 0, 1, 0, 0, 0, 0, 1, 0],
      });
      engine.booleanShape({
        shapeId: 'layer-air',
        baseShapeId: 'probe-prism',
        toolShapeId: 'probe-cylinder',
        op: 'cut',
      });
      engine.booleanShape({
        shapeId: 'layer-air-outer',
        baseShapeId: 'probe-prism',
        toolShapeId: 'probe-cylinder-moved',
        op: 'cut',
      });
      const layer = engine.booleanShape({
        shapeId: 'layer-shell',
        baseShapeId: 'layer-air',
        toolShapeId: 'layer-air-outer',
        op: 'cut',
      });
      expect(layer.stats.solids).toBe(1);
      const mesh = engine.tessellate('layer-shell');
      // Two millimetres of wall on the cylinder's near side.
      expect(mesh.bbox.min[0]).toBeCloseTo(-22, 1);
      expect(mesh.bbox.max[0]).toBeCloseTo(-surfaceAt, 1);
    });
  });

  // A sphere is met at uneven depths under one profile, which is where a single
  // prism reach fails: it keeps a sliver of air behind the body.
  describe('extrude to a curved body', () => {
    /** A ball of radius 10 at the origin. */
    const ball = () =>
      engine.makePrimitive({ shapeId: 'probe-ball', kind: 'sphere', radius: 10, at: [0, 0, 0] });

    /** A 12 by 12 square 30 mm above the ball, sweeping down through it. */
    const sweep = (shapeId: string, distances: number[]) =>
      engine.makePrism({
        shapeId,
        origin: [0, 0, 30],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        regions: [
          {
            outer: {
              curves: [
                { type: 'line', x1: -6, y1: -6, x2: 6, y2: -6 },
                { type: 'line', x1: 6, y1: -6, x2: 6, y2: 6 },
                { type: 'line', x1: 6, y1: 6, x2: -6, y2: 6 },
                { type: 'line', x1: -6, y1: 6, x2: -6, y2: -6 },
              ],
            },
            holes: [],
          },
        ],
        distances,
      });

    it('leaves the part behind the ball to be dropped', () => {
      ball();
      sweep('curved-prism', [-41]);
      const tool = engine.booleanShape({
        shapeId: 'curved-air',
        baseShapeId: 'curved-prism',
        toolShapeId: 'probe-ball',
        op: 'cut',
      });
      // The prism passes the ball, so what it keeps beyond it is a solid of its
      // own, cut off by the ball: an extent keeps only the part at the plane.
      expect(tool.stats.solids).toBe(2);
      const split = engine.splitSolids({ shapeId: 'curved-air', prefix: 'curved' });
      const [front, behind] = split.solids.map((solid) => ({
        mesh: engine.tessellate(solid.shapeId),
        volume: meshSignedVolume(engine.tessellate(solid.shapeId)),
      }));
      // The column from the profile down to the ball, over the whole profile.
      let expected = 0;
      const steps = 200;
      for (let x = 0; x < steps; x += 1) {
        for (let y = 0; y < steps; y += 1) {
          const px = -6 + (12 * (x + 0.5)) / steps;
          const py = -6 + (12 * (y + 0.5)) / steps;
          expected += 30 - Math.sqrt(100 - px * px - py * py);
        }
      }
      expected *= (12 / steps) * (12 / steps);
      expect(front!.mesh.bbox.max[2]).toBeCloseTo(30, 6);
      // Faceting of the sphere, not geometry from behind it, is the difference.
      expect(front!.volume / expected).toBeCloseTo(1, 2);
      // What is behind the ball, and must not reach the result.
      expect(behind!.mesh.bbox.max[2]).toBeCloseTo(-5.29, 2);
      expect(behind!.volume).toBeGreaterThan(300);
    });

    it('leaves a layer of the requested thickness on a curved face', () => {
      ball();
      sweep('curved-prism', [-41]);
      engine.transformShape({
        shapeId: 'probe-ball-back',
        sourceShapeId: 'probe-ball',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 3],
      });
      engine.booleanShape({
        shapeId: 'curved-air',
        baseShapeId: 'curved-prism',
        toolShapeId: 'probe-ball',
        op: 'cut',
      });
      engine.booleanShape({
        shapeId: 'curved-air-outer',
        baseShapeId: 'curved-prism',
        toolShapeId: 'probe-ball-back',
        op: 'cut',
      });
      const layer = engine.booleanShape({
        shapeId: 'curved-layer',
        baseShapeId: 'curved-air',
        toolShapeId: 'curved-air-outer',
        op: 'cut',
      });
      // The layer follows the sphere, so its volume is the thickness over the
      // whole profile, not a difference of two flat ends.
      expect(layer.stats.solids).toBe(1);
      expect(meshSignedVolume(engine.tessellate('curved-layer'))).toBeCloseTo(3 * 12 * 12, 3);
    });
  });

  it('refuses to centre a face that is not flat', () => {
    engine.makePrimitive({ shapeId: 'round-body', kind: 'cylinder', radius: 10, height: 5 });
    const mesh = engine.tessellate('round-body');
    const side = faceFacing(mesh, [1, 0, 0]);
    expect(() =>
      engine.faceCentre({
        shapeId: 'round-body',
        faceId: side,
        normal: faceNormals(mesh).get(side)!,
      }),
    ).toThrow(KernelOpError);
  });
  // "To body" extrudes trim their tool against the body they stop at instead of
  // cutting it with a plane, so the end face follows any surface (ADR 0035).
  it('stops a prism on the far side of a body it is intersected with', () => {
    // A block from z = 0 to z = 6, and a prism that starts above it.
    engine.makeBox({ shapeId: 'to-body-block', dx: 20, dy: 20, dz: 6 });
    engine.makePrism({
      shapeId: 'to-body-prism',
      origin: [10, 10, 20],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line', x1: -4, y1: -4, x2: 4, y2: -4 },
              { type: 'line', x1: 4, y1: -4, x2: 4, y2: 4 },
              { type: 'line', x1: 4, y1: 4, x2: -4, y2: 4 },
              { type: 'line', x1: -4, y1: 4, x2: -4, y2: -4 },
            ],
          },
          holes: [],
        },
      ],
      distances: [-30],
    });
    const reached = engine.booleanShape({
      shapeId: 'to-body-last',
      baseShapeId: 'to-body-prism',
      toolShapeId: 'to-body-block',
      op: 'common',
    });
    expect(reached.stats.solids).toBe(1);
    const mesh = engine.tessellate('to-body-last');
    // The column of material inside the block: from its top to its bottom.
    expect(mesh.bbox.min[2]).toBeCloseTo(0, 5);
    expect(mesh.bbox.max[2]).toBeCloseTo(6, 5);
  });

  it('leaves a layer from the surface and the same surface moved along the sweep', () => {
    // A cylinder standing between z = 10 and z = 30, and the column above it.
    engine.makePrimitive({
      shapeId: 'layer-cylinder',
      kind: 'cylinder',
      radius: 10,
      height: 20,
      at: [0, 0, 10],
    });
    engine.transformShape({
      shapeId: 'layer-cylinder-moved',
      sourceShapeId: 'layer-cylinder',
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1],
    });
    engine.makePrism({
      shapeId: 'layer-prism',
      origin: [0, 0, 50],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [
        {
          outer: {
            curves: [
              { type: 'line', x1: -15, y1: -15, x2: 15, y2: -15 },
              { type: 'line', x1: 15, y1: -15, x2: 15, y2: 15 },
              { type: 'line', x1: 15, y1: 15, x2: -15, y2: 15 },
              { type: 'line', x1: -15, y1: 15, x2: -15, y2: -15 },
            ],
          },
          holes: [],
        },
      ],
      distances: [-60],
    });
    // The air above the surface, and the air above the same surface one
    // millimetre further towards the profile.
    engine.booleanShape({
      shapeId: 'layer-air',
      baseShapeId: 'layer-prism',
      toolShapeId: 'layer-cylinder',
      op: 'cut',
    });
    engine.booleanShape({
      shapeId: 'layer-air-outer',
      baseShapeId: 'layer-prism',
      toolShapeId: 'layer-cylinder-moved',
      op: 'cut',
    });
    const layer = engine.booleanShape({
      shapeId: 'layer',
      baseShapeId: 'layer-air',
      toolShapeId: 'layer-air-outer',
      op: 'cut',
    });
    expect(layer.stats.solids).toBe(1);
    const mesh = engine.tessellate('layer');
    // The layer starts on the surface and is one millimetre thick, and its
    // sides follow the cylinder instead of the square the profile grew from.
    expect(mesh.bbox.min[2]).toBeCloseTo(30, 5);
    expect(mesh.bbox.max[2]).toBeCloseTo(31, 5);
    expect(mesh.bbox.max[0]).toBeCloseTo(10, 3);
  });

  it('writes STEP with body names and colours', () => {
    engine.makeBox({ shapeId: 'step-bracket', dx: 10, dy: 20, dz: 30 });
    engine.makeBox({ shapeId: 'step-plate', dx: 50, dy: 10, dz: 5 });
    const { data } = engine.exportStep({
      bodies: [
        { shapeId: 'step-bracket', name: 'Bracket', color: '#3366cc' },
        { shapeId: 'step-plate', name: 'Деталь', color: '#e64d1a' },
      ],
    });
    const text = new TextDecoder().decode(data);
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toContain("PRODUCT('Bracket'");
    expect(text).toContain("PRODUCT('Деталь'");
    expect(text).toMatch(/COLOUR_RGB\('',0\.2\d*,0\.4\d*,0\.8\d*\)/);
    expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(2);
  });

  it('rejects a STEP export of an unknown shape', () => {
    expect(() =>
      engine.exportStep({
        bodies: [{ shapeId: 'step-missing', name: 'Missing', color: '#000000' }],
      }),
    ).toThrowError(KernelOpError);
  });
});
