import type { TessellationResult } from '@icancad/kernel';
import { createProject, type Project } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { edgeBisector, edgeCorner, edgePose, treatedEdges } from '../src/kernel/edgeTreatment';
import {
  edgeTreatmentGeometry,
  edgeTreatmentLimit,
  edgeTreatmentTargetFromSelection,
  treatmentSelection,
  type EdgeTreatmentTarget,
} from '../src/quick/edgeTreatment';
import type { SelectionItem } from '../src/stores/documentStore';
import { edgedCube } from './edgedCube';

const SIZE = 20;

function project(): Project {
  return {
    ...createProject(),
    features: [
      {
        id: 'box',
        name: 'Box',
        suppressed: false,
        type: 'primitive',
        kind: 'box',
        params: { dx: SIZE, dy: SIZE, dz: SIZE },
        transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      },
    ],
    bodies: [{ id: 'body-1', createdBy: 'box' }],
  };
}

function edgeSelection(mesh: TessellationResult, ids: string[]): SelectionItem[] {
  return ids.map((id) => ({ kind: 'edge' as const, id: `body-1#${id}` }));
}

function targetFor(mesh: TessellationResult, ids: string[]): EdgeTreatmentTarget {
  const resolved = edgeTreatmentTargetFromSelection(project(), edgeSelection(mesh, ids), {
    'body-1': mesh,
  });
  expect(resolved).not.toBeNull();
  return resolved!;
}

describe('edge treatment targets', () => {
  it('describes an edge by its pose and the two faces around it', () => {
    const mesh = edgedCube(SIZE);
    const edge = mesh.edges![0]!;
    const pose = edgePose(edge.points);
    expect(pose.start).toEqual([0, 0, 0]);
    expect(pose.end).toEqual([SIZE, 0, 0]);
    // Faces -Y and -Z meet along the bottom-front edge.
    const bisector = edgeBisector(mesh, edge.faceIds)!;
    expect(bisector[0]).toBeCloseTo(0, 9);
    expect(bisector[1]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(bisector[2]).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('turns selected edges into an arrow that points into the corner', () => {
    const mesh = edgedCube(SIZE);
    const target = targetFor(mesh, ['0']);
    const geometry = edgeTreatmentGeometry(target);
    expect(geometry?.origin[0]).toBeCloseTo(SIZE / 2, 9);
    expect(geometry?.origin[1]).toBeCloseTo(0, 9);
    expect(geometry?.origin[2]).toBeCloseTo(0, 9);
    // The bisector points away from the material, the arrow back into it.
    expect(geometry?.direction[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(geometry?.direction[2]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(geometry?.wedge).toBeCloseTo(Math.PI / 2, 9);
  });

  it('turns a selected face into a target anchored at the face', () => {
    const mesh = edgedCube(SIZE);
    const resolved = edgeTreatmentTargetFromSelection(
      project(),
      [{ kind: 'body-face', id: 'body-1#5' }],
      { 'body-1': mesh },
    );
    expect(resolved?.faceRefs).toHaveLength(1);
    expect(resolved?.faceRefs[0]?.origin[0]).toBeCloseTo(SIZE / 2, 6);
    expect(resolved?.faceRefs[0]?.origin[1]).toBeCloseTo(SIZE / 2, 6);
    expect(resolved?.faceRefs[0]?.origin[2]).toBeCloseTo(SIZE, 6);
    // A face is treated along its rim, so the arrow stands on the first rim
    // edge and points into the body, where the chamfer or round appears.
    const geometry = edgeTreatmentGeometry(resolved!);
    expect(geometry?.origin[2]).toBeCloseTo(SIZE, 6);
    expect(geometry?.direction[2]).toBeLessThan(-0.5);
    expect(geometry?.wedge).toBeCloseTo(Math.PI / 2, 6);
  });

  it('takes the rim of a face as the treated edges', () => {
    const mesh = edgedCube(SIZE);
    const resolved = edgeTreatmentTargetFromSelection(
      project(),
      [{ kind: 'body-face', id: 'body-1#5' }],
      { 'body-1': mesh },
    );
    const edges = treatedEdges(mesh, treatmentSelection(resolved!, 'body-1'));
    // The top face has four boundary edges and shares none with another
    // selected face.
    expect(edges).toHaveLength(4);
    for (const edge of edges) expect(edge.faceIds).toContain(5);
  });

  it('leaves the edge between two selected faces alone', () => {
    const mesh = edgedCube(SIZE);
    const resolved = edgeTreatmentTargetFromSelection(
      project(),
      [
        { kind: 'body-face', id: 'body-1#5' },
        { kind: 'body-face', id: 'body-1#3' },
      ],
      { 'body-1': mesh },
    );
    const edges = treatedEdges(mesh, treatmentSelection(resolved!, 'body-1'));
    // Two neighbouring faces share one edge; it is inside the selection.
    expect(edges.some((edge) => edge.faceIds.includes(5) && edge.faceIds.includes(3))).toBe(false);
  });

  it('ignores meshes and unknown bodies', () => {
    const mesh = edgedCube(SIZE);
    const withMeshBody: Project = {
      ...project(),
      bodies: [
        { id: 'body-1', createdBy: 'box' },
        { id: 'mesh-1', createdBy: 'box', kind: 'mesh' },
      ],
    };
    expect(
      edgeTreatmentTargetFromSelection(
        withMeshBody,
        [{ kind: 'edge', id: 'mesh-1#0' }],
        { 'mesh-1': mesh },
      ),
    ).toBeNull();
    expect(
      edgeTreatmentTargetFromSelection(project(), [{ kind: 'body', id: 'body-1' }], {
        'body-1': mesh,
      }),
    ).toBeNull();
  });
});

describe('edge treatment size limit', () => {
  it('uses the face width for a single edge', () => {
    const mesh = edgedCube(SIZE);
    expect(edgeTreatmentLimit(targetFor(mesh, ['0']), { 'body-1': mesh })).toBe(SIZE);
  });

  it('splits the face between two parallel edges', () => {
    const mesh = edgedCube(SIZE);
    // Edge 0 and edge 2 are the two parallel edges of the bottom face.
    const target = targetFor(mesh, ['0', '2']);
    expect(target.edgeRefs).toHaveLength(2);
    expect(edgeTreatmentLimit(target, { 'body-1': mesh })).toBe(SIZE / 2);
  });

  it('is not lowered by perpendicular edges on the same face', () => {
    const mesh = edgedCube(SIZE);
    const target = targetFor(mesh, ['0', '4']);
    const first = mesh.edges![0]!;
    const second = mesh.edges![4]!;
    // They share the -Y face but run along different axes, so they consume
    // different parts of it.
    expect(first.faceIds.some((face) => second.faceIds.includes(face))).toBe(true);
    expect(edgeTreatmentLimit(target, { 'body-1': mesh })).toBe(SIZE);
  });

  it('has no limit without edges', () => {
    const mesh = { ...edgedCube(SIZE), edges: [] };
    expect(
      edgeTreatmentTargetFromSelection(
        project(),
        [{ kind: 'body-face', id: 'body-1#5' }],
        { 'body-1': mesh },
      ),
    ).not.toBeNull();
    expect(edgeTreatmentLimit({ faceRefs: [], edgeRefs: [] }, { 'body-1': mesh })).toBeNull();
  });
});

/** Closed L-shaped solid, the simplest body with a concave edge. */
function notchMesh(size = 20): TessellationResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];
  const triangle = (points: Array<[number, number, number]>, normal: [number, number, number], faceId: number) => {
    const base = positions.length / 3;
    for (const point of points) {
      positions.push(...point);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2);
    faceIds.push(faceId);
  };
  const half = size / 2;

  // Top and bottom of the L, whose outline runs (0,0) (S,0) (S,S/2) (S/2,S/2) (S/2,S) (0,S).
  const outline: Array<[number, number]> = [
    [0, 0],
    [size, 0],
    [size, half],
    [half, half],
    [half, size],
    [0, size],
  ];
  for (let index = 0; index < outline.length; index += 1) {
    const [ax, ay] = outline[index]!;
    const [bx, by] = outline[(index + 1) % outline.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const normal: [number, number, number] = [dy / length, -dx / length, 0];
    triangle(
      [
        [ax, ay, 0],
        [bx, by, 0],
        [bx, by, size],
      ],
      normal,
      2 + index,
    );
    triangle(
      [
        [ax, ay, 0],
        [bx, by, size],
        [ax, ay, size],
      ],
      normal,
      2 + index,
    );
  }
  const fan = (z: number, normal: [number, number, number]) => {
    for (let index = 1; index + 1 < outline.length; index += 1) {
      const [ax, ay] = outline[0]!;
      const [bx, by] = outline[index]!;
      const [cx, cy] = outline[index + 1]!;
      const points: Array<[number, number, number]> =
        z === size
          ? [
              [ax, ay, z],
              [bx, by, z],
              [cx, cy, z],
            ]
          : [
              [ax, ay, z],
              [cx, cy, z],
              [bx, by, z],
            ];
      triangle(points, normal, z === size ? 0 : 1);
    }
  };
  fan(size, [0, 0, 1]);
  fan(0, [0, 0, -1]);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceIds: new Uint32Array(faceIds),
    triangleCount: faceIds.length,
    vertexCount: positions.length / 3,
    bbox: { min: [0, 0, 0], max: [size, size, size] },
    edges: [],
  };
}

describe('edge corners', () => {
  it('fills a body edge, so the new face lands inside it', () => {
    const mesh = edgedCube(SIZE);
    const edge = mesh.edges![0]!;
    const corner = edgeCorner(mesh, edge.faceIds, edgePose(edge.points).mid);
    expect(corner?.convex).toBe(true);
    expect(corner?.wedge).toBeCloseTo(Math.PI / 2, 6);
  });

  it('leaves a notch edge empty, so the new face lands in free space', () => {
    const mesh = notchMesh(SIZE);
    const corner = edgeCorner(mesh, [4, 5], [SIZE / 2, SIZE / 2, SIZE / 2]);
    expect(corner?.convex).toBe(false);
    expect(corner?.wedge).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('older references', () => {
  /** A concave edge of the notch, as a document saved before the corner. */
  function legacyRef() {
    const mesh: TessellationResult = {
      ...notchMesh(SIZE),
      edges: [{ id: '7', faceIds: [4, 5], points: [10, 10, 0, 10, 10, SIZE], closed: false }],
    };
    const target: EdgeTreatmentTarget = {
      faceRefs: [],
      edgeRefs: [
        {
          bodyId: 'body-1',
          edgeId: '7',
          faceIds: [4, 5],
          start: [10, 10, 0],
          mid: [10, 10, SIZE / 2],
          end: [10, 10, SIZE],
          bisector: [Math.SQRT1_2, Math.SQRT1_2, 0],
        },
      ],
    };
    return { mesh, target };
  }

  it('reads the corner from the mesh when the reference does not carry it', () => {
    const { mesh, target } = legacyRef();
    const geometry = edgeTreatmentGeometry(target, { 'body-1': mesh });
    // The notch is open, so the created face lies in the free space.
    expect(geometry?.direction[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(geometry?.direction[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(geometry?.wedge).toBeCloseTo(Math.PI / 2, 6);
  });

  it('keeps the stored corner once the reference has one', () => {
    const { mesh, target } = legacyRef();
    const ref = target.edgeRefs[0]!;
    const stored: EdgeTreatmentTarget = {
      faceRefs: [],
      edgeRefs: [{ ...ref, wedge: Math.PI / 2, convex: true }],
    };
    const geometry = edgeTreatmentGeometry(stored, { 'body-1': mesh });
    // The stored side wins even where the mesh would say otherwise.
    expect(geometry?.direction[0]).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});
