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
              { type: 'arc', cx: 0, cy: 0, r: 10, startAngle: -Math.PI / 2, endAngle: 0, reversed: true },
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
              { type: 'line', x1: -54.19636757449335, y1: -47.860781122154016, x2: 6.960966347011371, y2: -47.860781122154016 },
              { type: 'arc', cx: 6.960966577512058, cy: -13.647069516322679, r: 34.213711605831335, startAngle: -1.5707963335319817, endAngle: 3.2696327140518344e-8 },
              { type: 'line', x1: 41.174678183343396, y1: -13.647068397659972, x2: 41.174678183343396, y2: 43.48162904284042 },
              { type: 'line', x1: 41.174678183343396, y1: 43.48162904284042, x2: -54.19636757449335, y2: -47.860781122154016 },
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
    const frames: Record<string, { origin: [number, number, number]; xAxis: [number, number, number]; yAxis: [number, number, number] }> = {
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

  it('disposes shapes', () => {
    engine.clear();
    engine.makeBox({ shapeId: 'box-1', dx: 20, dy: 10, dz: 5 });
    expect(engine.dispose('box-1')).toBe(true);
    expect(engine.dispose('box-1')).toBe(false);
    expect(engine.shapeCount).toBe(0);
  });
});
