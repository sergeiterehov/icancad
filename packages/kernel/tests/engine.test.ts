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
    const placements = [0, 10, -10].map(
      (x) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0] as number[],
    );
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
});
