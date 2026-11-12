import type { TessellationResult } from '@icancad/kernel';
import { createProject, type Project } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { edgeBisector, edgePose, treatedEdges } from '../src/kernel/edgeTreatment';
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

  it('turns selected edges into a target with a leader geometry', () => {
    const mesh = edgedCube(SIZE);
    const target = targetFor(mesh, ['0']);
    const geometry = edgeTreatmentGeometry(target);
    expect(geometry?.leader).toBe(true);
    expect(geometry?.origin[0]).toBeCloseTo(SIZE / 2, 9);
    expect(geometry?.origin[1]).toBeCloseTo(0, 9);
    expect(geometry?.origin[2]).toBeCloseTo(0, 9);
    expect(geometry?.direction[1]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(geometry?.direction[2]).toBeCloseTo(-Math.SQRT1_2, 9);
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
    const geometry = edgeTreatmentGeometry(resolved!);
    expect(geometry?.leader).toBe(false);
    expect(geometry?.direction).toEqual([0, 0, 1]);
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
