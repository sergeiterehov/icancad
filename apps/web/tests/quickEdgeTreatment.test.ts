import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type EdgeTreatmentFeature, type Project } from '@icancad/model';
import { edgeMatchDistance, resolveEdgeRef } from '../src/kernel/edgeLookup';
import { edgePose } from '../src/kernel/edgeTreatment';
import { edgeTreatmentGeometry } from '../src/quick/edgeTreatment';
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

  it('creates a fillet when the track goes right', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(2.5);
    const [feature] = treatments();
    expect(feature).toMatchObject({ kind: 'fillet', size: 2.5 });
    expect(drag.kind).toBe('fillet');
    // The grab only starts the operation; the rest belongs to it.
    expect(useDocumentStore.getState().selection).toEqual([
      { kind: 'feature', id: feature!.id },
    ]);
    drag.end();
    expect(treatments()).toHaveLength(1);
  });

  it('creates a chamfer when the track goes left', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(-1.5);
    expect(treatments()[0]).toMatchObject({ kind: 'chamfer', size: 1.5 });
    drag.end();
  });

  it('flips the kind while the first drag has not been released', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(2);
    drag.update(-2);
    expect(treatments()[0]).toMatchObject({ kind: 'chamfer', size: 2 });
    drag.end();
  });

  it('keeps the kind after the drag is released', () => {
    const first = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    first.start();
    first.update(-2);
    first.end();

    const second = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    second.start();
    second.update(3);
    second.end();

    const features = treatments();
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ kind: 'chamfer', size: 3 });
  });

  it('rounds the size the handle reports', () => {
    const drag = new QuickEdgeTreatmentDrag(edgeTarget(edgedCube(), ['0']), 'Edge');
    drag.start();
    drag.update(2.3456789);
    expect(treatments()[0]?.size).toBe(2.35);
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
    drag.update(2);
    drag.cancel();
    expect(treatments()).toHaveLength(0);
  });
});

describe('edge ref lookup', () => {
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
        bisector: [0, 0, 1],
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
