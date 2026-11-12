import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type EdgeTreatmentFeature, type Project } from '@icancad/model';
import { edgeMatchDistance, resolveEdgeRef } from '../src/kernel/edgeLookup';
import { edgePose } from '../src/kernel/edgeTreatment';
import {
  edgeTreatmentGeometry,
  treatmentFaceOffset,
  treatmentSizeForOffset,
} from '../src/quick/edgeTreatment';
import { QuickEdgeTreatmentDrag } from '../src/quick/controller';
import { useDocumentStore } from '../src/stores/documentStore';
import { edgedCube } from './edgedCube';

const BODY = 'body-1';

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
        params: { dx: 20, dy: 20, dz: 20 },
        transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      },
    ],
    bodies: [{ id: BODY, createdBy: 'box' }],
  };
}

function edgeTarget(mesh: ReturnType<typeof edgedCube>, ids: string[]) {
  const geometry = edgeTreatmentGeometry({
    faceRefs: [],
    edgeRefs: ids.map((id) => {
      const edge = mesh.edges!.find((candidate) => candidate.id === id)!;
      return {
        bodyId: BODY,
        edgeId: edge.id,
        faceIds: [...edge.faceIds],
        ...edgePose(edge.points),
        bisector: [0, 0, 1] as [number, number, number],
        // A right-angled corner: the created face sits at cos(45°) of the size.
        wedge: Math.PI / 2,
        convex: true,
      };
    }),
  });
  expect(geometry).not.toBeNull();
  return geometry!;
}

describe('quick edge treatment drag', () => {
  beforeEach(() => {
    useDocumentStore.getState().hydrate(project());
  });

  const treatments = (): EdgeTreatmentFeature[] =>
    useDocumentStore
      .getState()
      .project.features.filter(
        (feature): feature is EdgeTreatmentFeature => feature.type === 'edge-treatment',
      );

  it('chamfers with a plain drag', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    // The arrow is pulled 3.5 mm into the corner, which is a 5 mm leg.
    drag.update(3.5355);
    const [feature] = treatments();
    expect(feature).toMatchObject({ kind: 'chamfer', size: 5 });
    expect(drag.kind).toBe('chamfer');
    // The grab only starts the operation; the rest belongs to it.
    expect(useDocumentStore.getState().selection).toEqual([
      { kind: 'feature', id: feature!.id },
    ]);
    drag.end();
    expect(treatments()).toHaveLength(1);
  });

  it('rounds the corner while shift is held', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    // A round of radius r reaches r(√2 − 1) into the corner.
    drag.update(1.4645, true);
    expect(treatments()[0]).toMatchObject({ kind: 'fillet', size: 3.5 });
    drag.end();
  });

  it('lets the kind follow shift until the pointer is released', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(3.5355);
    drag.update(3.5355, true);
    expect(treatments()[0]).toMatchObject({ kind: 'fillet' });
    drag.update(3.5355);
    expect(treatments()[0]).toMatchObject({ kind: 'chamfer' });
    drag.end();
  });

  it('keeps the kind once the grab belongs to an operation', () => {
    const target = edgeTarget(edgedCube(), ['0']);
    const opening = new QuickEdgeTreatmentDrag(target, 'Edge');
    opening.start();
    opening.update(1.4645, true);
    opening.end();
    const [feature] = treatments();

    const next = new QuickEdgeTreatmentDrag(target, 'Edge', feature!.id);
    next.start();
    expect(next.isLocked).toBe(true);
    expect(next.kind).toBe('fillet');
    // Shift cannot turn the round into a chamfer any more.
    next.update(2.8284, false);
    next.end();

    expect(treatments()).toHaveLength(1);
    expect(treatments()[0]).toMatchObject({ kind: 'fillet', size: 6.8 });
  });

  it('always opens a new operation from the selection arrow', () => {
    const target = edgeTarget(edgedCube(), ['0']);
    const first = new QuickEdgeTreatmentDrag(target, 'Edge');
    first.start();
    first.update(2.8284);
    first.end();

    const second = new QuickEdgeTreatmentDrag(target, 'Edge');
    second.start();
    expect(second.isLocked).toBe(false);
    second.update(2.8284);
    second.end();

    expect(treatments()).toHaveLength(2);
  });

  it('snaps the size to a tenth of a millimetre', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(2.3456789);
    expect(treatments()[0]?.size).toBe(3.3);
    drag.end();
  });

  it('does not leave an operation below the drag threshold', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(0.01);
    drag.end();
    expect(treatments()).toHaveLength(0);
  });

  it('cancels a created operation', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(2.8284);
    drag.cancel();
    expect(treatments()).toHaveLength(0);
  });
});

describe('treatment face offset', () => {
  const right = Math.PI / 2;

  it('puts a chamfer face at the cosine of the leg distance', () => {
    expect(treatmentFaceOffset('chamfer', 4, right)).toBeCloseTo(2.8284, 4);
    expect(treatmentSizeForOffset('chamfer', 2.8284, right)).toBeCloseTo(4, 4);
  });

  it('puts a round face at the sagitta of its radius', () => {
    // A quarter round of radius r reaches r(√2 − 1) into the corner.
    expect(treatmentFaceOffset('fillet', 5, right)).toBeCloseTo(5 * (Math.SQRT2 - 1), 6);
    expect(treatmentSizeForOffset('fillet', 5 * (Math.SQRT2 - 1), right)).toBeCloseTo(5, 6);
  });

  it('rounds the mapping back to the size it came from', () => {
    for (const kind of ['chamfer', 'fillet'] as const) {
      for (const wedge of [Math.PI / 6, Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3]) {
        for (const size of [0.5, 2, 7.5]) {
          const offset = treatmentFaceOffset(kind, size, wedge);
          expect(treatmentSizeForOffset(kind, offset, wedge)).toBeCloseTo(size, 6);
        }
      }
    }
  });

  it('takes the arrow to the face a flat corner would need', () => {
    // A nearly flat corner has no room for a chamfer: the face stays put.
    expect(treatmentFaceOffset('chamfer', 4, Math.PI - 0.01)).toBeLessThan(0.05);
    expect(Number.isFinite(treatmentSizeForOffset('chamfer', 1, Math.PI - 0.01))).toBe(true);
    expect(Number.isFinite(treatmentFaceOffset('fillet', 4, 0.01))).toBe(true);
  });
});

describe('edge ref lookup', () => {
  it('matches a closed edge such as a cylinder rim', () => {
    // A rim starts and ends at the same point, so the pose needs the middle.
    const points = [5, 0, 0, 0, 5, 0, -5, 0, 0, 0, -5, 0, 5, 0, 0];
    const mesh = {
      ...edgedCube(),
      edges: [{ id: 'rim', faceIds: [0, 1], points, closed: true }],
    };
    const ref = {
      bodyId: BODY,
      edgeId: 'renumbered',
      faceIds: [0, 1],
      start: [5, 0, 0] as [number, number, number],
      mid: [-5, 0, 0] as [number, number, number],
      end: [5, 0, 0] as [number, number, number],
      bisector: [0, 0, 1] as [number, number, number],
    };
    expect(edgeMatchDistance({ points }, ref)).not.toBeNull();
    expect(
      resolveEdgeRef({ bodyShapes: new Map([[BODY, 'shape-1']]), meshes: { [BODY]: mesh } }, ref),
    ).toEqual({ bodyId: BODY, edgeId: 'rim' });
  });

  it('matches an edge by its stored pose', () => {
    const mesh = edgedCube();
    const edge = mesh.edges![0]!;
    const ref = {
      bodyId: BODY,
      edgeId: '99',
      faceIds: [...edge.faceIds],
      start: [0, 0, 0] as [number, number, number],
      mid: [10, 0, 0] as [number, number, number],
      end: [20, 0, 0] as [number, number, number],
      bisector: [0, 0, 1] as [number, number, number],
    };
    expect(edgeMatchDistance(edge, ref)).not.toBeNull();
    // The id was renumbered by a rebuild; the pose still finds the edge.
    expect(
      resolveEdgeRef({ bodyShapes: new Map([[BODY, 'shape-1']]), meshes: { [BODY]: mesh } }, ref),
    ).toEqual({ bodyId: BODY, edgeId: edge.id });
  });

  it('rejects an edge that is not where the ref says', () => {
    const mesh = edgedCube();
    const edge = mesh.edges![0]!;
    expect(
      edgeMatchDistance(edge, {
        mid: [10, 10, 10],
        start: [0, 0, 0],
        end: [20, 0, 0],
      }),
    ).toBeNull();
    expect(
      resolveEdgeRef(
        { bodyShapes: new Map([[BODY, 'shape-1']]), meshes: { [BODY]: mesh } },
        {
          bodyId: BODY,
          edgeId: '0',
          faceIds: [],
          start: [0, 0, 0],
          mid: [10, 10, 10],
          end: [20, 0, 0],
          bisector: [0, 0, 1],
        },
      ),
    ).toBeNull();
  });
});

describe('edge ref lookup by pose', () => {
  it('finds the edge when it was tessellated the other way round', () => {
    const mesh = edgedCube();
    const edge = mesh.edges![0]!;
    // The same edge, listed from its far end: the stored start is now the end.
    const reversed = {
      ...edge,
      points: [20, 0, 0, 0, 0, 0],
    };
    const ref = {
      bodyId: BODY,
      edgeId: '0',
      faceIds: [...edge.faceIds],
      start: [0, 0, 0] as [number, number, number],
      mid: [10, 0, 0] as [number, number, number],
      end: [20, 0, 0] as [number, number, number],
      bisector: [0, 0, 1] as [number, number, number],
    };
    expect(edgeMatchDistance(reversed, ref)).not.toBeNull();
    expect(
      resolveEdgeRef(
        { bodyShapes: new Map([[BODY, 'shape-1']]), meshes: { [BODY]: { ...mesh, edges: [reversed] } } },
        ref,
      ),
    ).toEqual({ bodyId: BODY, edgeId: edge.id });
  });
});

describe('edge ref lookup by pose', () => {
  it('matches a piece of a longer edge, as picked after an earlier round', () => {
    const mesh = edgedCube();
    const edge = mesh.edges![0]!;
    // The reference remembers the part of the edge a previous round left over,
    // which is still on the edge that the input has.
    const ref = {
      bodyId: BODY,
      edgeId: '99',
      faceIds: [...edge.faceIds],
      start: [4, 0, 0] as [number, number, number],
      mid: [10, 0, 0] as [number, number, number],
      end: [16, 0, 0] as [number, number, number],
      bisector: [0, 0, 1] as [number, number, number],
    };
    expect(edgeMatchDistance(edge, ref)).not.toBeNull();
    expect(
      resolveEdgeRef({ bodyShapes: new Map([[BODY, 'shape-1']]), meshes: { [BODY]: mesh } }, ref),
    ).toEqual({ bodyId: BODY, edgeId: edge.id });
  });
});
