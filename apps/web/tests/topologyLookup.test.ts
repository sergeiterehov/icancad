import { describe, expect, it } from 'vitest';
import type { TessellationResult } from '@icancad/kernel';
import type { BodyEdgeRef } from '@icancad/model';
import { resolveEdgeRef, resolveFaceRef } from '../src/kernel/topologyLookup';
import { cubeMesh } from './cubeMesh';
import { edgedCube } from './edgedCube';

function translated(mesh: TessellationResult, offset: [number, number, number]): TessellationResult {
  const positions = new Float32Array(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = positions[index]! + offset[0];
    positions[index + 1] = positions[index + 1]! + offset[1];
    positions[index + 2] = positions[index + 2]! + offset[2];
  }
  return {
    ...mesh,
    positions,
    bbox: {
      min: [
        mesh.bbox.min[0] + offset[0],
        mesh.bbox.min[1] + offset[1],
        mesh.bbox.min[2] + offset[2],
      ],
      max: [
        mesh.bbox.max[0] + offset[0],
        mesh.bbox.max[1] + offset[1],
        mesh.bbox.max[2] + offset[2],
      ],
    },
  };
}

const bodyShapes = new Map([
  ['a', 'shape-a'],
  ['b', 'shape-b'],
]);

describe('face refs resolve by persistent name', () => {
  it('finds the same face after the traversal is renumbered', () => {
    const mesh = cubeMesh();
    // The same body with its faces in another order.
    mesh.faceNames = [
      'fixture/+z',
      'fixture/-z',
      'fixture/+y',
      'fixture/-y',
      'fixture/+x',
      'fixture/-x',
    ];
    mesh.faceAliases = mesh.faceNames.map((name) => [name]);
    const resolved = resolveFaceRef(
      { bodyShapes: new Map([['a', 'shape-a']]), meshes: { a: mesh } },
      { bodyId: 'a', name: 'fixture/+x', normal: [1, 0, 0], origin: [20, 10, 10] },
    );
    expect(resolved).toEqual({ bodyId: 'a', faceId: 4 });
  });

  it('finds a face that a split moved to another body', () => {
    const left = cubeMesh();
    // The face is gone from the body the reference names; its name lives on
    // the body the split moved it to.
    left.faceNames = ['fixture/other', ...left.faceNames!.slice(1)];
    left.faceAliases = [['fixture/other'], ...left.faceAliases!.slice(1)];
    const meshes = { a: left, b: translated(cubeMesh(), [40, 0, 0]) };
    expect(
      resolveFaceRef(
        { bodyShapes, meshes },
        { bodyId: 'a', name: 'fixture/-x', normal: [-1, 0, 0], origin: [40, 10, 10] },
      ),
    ).toEqual({ bodyId: 'b', faceId: 0 });
  });

  it('matches a name a merge recorded only as an alias', () => {
    const mesh = cubeMesh();
    mesh.faceNames = ['fixture/merged', ...mesh.faceNames!.slice(1)];
    mesh.faceAliases = [['fixture/merged', 'fixture/-x'], ...mesh.faceAliases!.slice(1)];
    expect(
      resolveFaceRef(
        { bodyShapes, meshes: { a: mesh } },
        { bodyId: 'a', name: 'fixture/-x', normal: [-1, 0, 0], origin: [0, 10, 10] },
      ),
    ).toEqual({ bodyId: 'a', faceId: 0 });
  });

  it('uses the pose to pick between pieces a split left with one name', () => {
    const mesh = cubeMesh();
    mesh.faceNames = ['fixture/-x', 'fixture/-x', ...mesh.faceNames!.slice(2)];
    mesh.faceAliases = [['fixture/-x'], ['fixture/-x'], ...mesh.faceAliases!.slice(2)];
    expect(
      resolveFaceRef(
        { bodyShapes, meshes: { a: mesh } },
        { bodyId: 'a', name: 'fixture/-x', normal: [1, 0, 0], origin: [20, 10, 10] },
      ),
    ).toEqual({ bodyId: 'a', faceId: 1 });
  });

  it('recovers a schema 8 face by its stored pose when its name moved', () => {
    expect(
      resolveFaceRef(
        { bodyShapes, meshes: { a: cubeMesh() } },
        {
          bodyId: 'a',
          name: 'fixture/new/face/old',
          normal: [1, 0, 0],
          origin: [20, 10, 10],
          legacyPose: true,
        },
      ),
    ).toEqual({ bodyId: 'a', faceId: 1 });
  });

  it('reports a face whose name is gone', () => {
    expect(
      resolveFaceRef(
        { bodyShapes, meshes: { a: cubeMesh() } },
        { bodyId: 'a', name: 'missing', normal: [1, 0, 0], origin: [20, 10, 10] },
      ),
    ).toBeNull();
  });
});

describe('edge refs resolve by persistent name', () => {
  const refOf = (edge: NonNullable<TessellationResult['edges']>[number]): BodyEdgeRef => ({
    bodyId: 'a',
    name: edge.name!,
    start: [edge.points[0]!, edge.points[1]!, edge.points[2]!],
    mid: [edge.points[3]!, edge.points[4]!, edge.points[5]!],
    end: [
      edge.points[edge.points.length - 3]!,
      edge.points[edge.points.length - 2]!,
      edge.points[edge.points.length - 1]!,
    ],
    bisector: [0, 0, 1],
  });

  it('follows an edge whose traversal id changed', () => {
    const mesh = edgedCube();
    const edge = mesh.edges![3]!;
    const ref = refOf(edge);
    // The mesh now numbers its edges the other way round.
    mesh.edges = mesh.edges!.map((candidate, index) => ({
      ...candidate,
      id: String(mesh.edges!.length - 1 - index),
    }));
    const resolved = resolveEdgeRef({ bodyShapes, meshes: { a: mesh } }, ref);
    const expected = mesh.edges!.find((candidate) => candidate.name === edge.name)!.id;
    expect(resolved).toEqual({ bodyId: 'a', edgeId: expected });
  });

  it('finds an edge on its own array stamp by its prefixed name', () => {
    const stamp = (prefix: string) => {
      const mesh = edgedCube();
      mesh.edges = mesh.edges!.map((edge) => ({ ...edge, name: `${prefix}/${edge.name}` }));
      return mesh;
    };
    const first = stamp('feat_array/1');
    const second = stamp('feat_array/2');
    const edge = first.edges![0]!;
    const ref = { ...refOf(edge), bodyId: 'a' };
    expect(resolveEdgeRef({ bodyShapes, meshes: { a: first } }, ref)).toEqual({
      bodyId: 'a',
      edgeId: edge.id,
    });
    expect(
      resolveEdgeRef({ bodyShapes, meshes: { a: first, b: second } }, ref),
    ).toEqual({ bodyId: 'a', edgeId: edge.id });
    expect(
      resolveEdgeRef(
        { bodyShapes, meshes: { a: first, b: second } },
        { ...ref, name: `feat_array/2/${edge.name!.split('/').slice(2).join('/')}` },
      ),
    ).toEqual({ bodyId: 'b', edgeId: edge.id });
  });

  it('follows a schema 8 arc that a boundary change shortened', () => {
    const mesh = cubeMesh();
    const radius = 10;
    const points = [7.071, 7.071, 0, 0, 10, 0, -7.071, 7.071, 0];
    mesh.edges = [
      { id: 'arc', faceIds: [0, 1], points, closed: false, name: 'new/edge/arc' },
    ];
    expect(
      resolveEdgeRef(
        { bodyShapes, meshes: { a: mesh } },
        {
          bodyId: 'a',
          name: 'legacy/edge/arc',
          start: [radius, 0, 0],
          mid: [0, radius, 0],
          end: [-radius, 0, 0],
          closed: false,
          bisector: [0, 0, 1],
          legacyPose: true,
        },
      ),
    ).toEqual({ bodyId: 'a', edgeId: 'arc' });
  });

  it('recovers a schema 8 edge by its stored pose when its name moved', () => {
    const edge = edgedCube().edges![3]!;
    expect(
      resolveEdgeRef(
        { bodyShapes, meshes: { a: edgedCube() } },
        { ...refOf(edge), name: 'legacy/edge/old', legacyPose: true },
      ),
    ).toEqual({ bodyId: 'a', edgeId: edge.id });
  });

  it('reports an edge whose name is gone', () => {
    const ref = refOf(edgedCube().edges![0]!);
    expect(resolveEdgeRef({ bodyShapes, meshes: { a: edgedCube() } }, ref)).not.toBeNull();
    expect(
      resolveEdgeRef({ bodyShapes, meshes: { a: cubeMesh() } }, ref),
    ).toBeNull();
  });
});
