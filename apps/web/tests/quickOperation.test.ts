import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  type ExtrudeFeature,
  type PrimitiveFeature,
  type Project,
} from '@icancad/model';
import { QuickExtrudeDrag } from '../src/quick/controller';
import { operationHandles } from '../src/quick/operationHandles';
import {
  buildQuickExtrude,
  findBoundExtrude,
  quickTargetFromSelection,
} from '../src/quick/target';
import type { QuickTargetGeometry } from '../src/quick/types';
import { useDocumentStore } from '../src/stores/documentStore';
import { cubeMesh } from './cubeMesh';

const box: PrimitiveFeature = {
  id: 'box',
  name: 'Box',
  suppressed: false,
  type: 'primitive',
  kind: 'box',
  params: { dx: 20, dy: 20, dz: 20 },
  transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
};

function baseProject(): Project {
  return {
    ...createProject(),
    features: [box],
    bodies: [{ id: 'body-1', createdBy: 'box' }],
  };
}

function geometry(): QuickTargetGeometry {
  return {
    target: { kind: 'body-face', bodyId: 'body-1', faceIds: ['1'] },
    origin: [20, 10, 10],
    direction: [1, 0, 0],
    faces: [{ faceId: '1', centroid: [20, 10, 10], normal: [1, 0, 0] }],
    samples: [],
  };
}

const labels = {
  extrude: 'Extrude',
  create: 'Create',
  distance: 'Distance',
  secondDistance: 'Second distance',
  edgeTreatment: 'Edge',
  edgeTreatmentTooltip: 'Edge — drag to chamfer',
  edgeTreatmentRadiusTooltip: 'Corner radius',
  edgeTreatmentDistanceTooltip: 'Chamfer distance',
};

function handles(context: {
  project: Project;
  selection: Parameters<typeof operationHandles>[0]['selection'];
  meshes?: Record<string, ReturnType<typeof cubeMesh>>;
}) {
  return operationHandles({
    project: context.project,
    selection: context.selection,
    meshes: context.meshes ?? {},
    baseMeshes: {},
    sketchFrames: {},
    bodies: [],
    labels,
  });
}

describe('quick operation targets and handles', () => {
  it('turns a body face selection into a target', () => {
    const project = baseProject();
    expect(
      quickTargetFromSelection(project, [{ kind: 'body-face', id: 'body-1#1' }]),
    ).toEqual({ kind: 'body-face', bodyId: 'body-1', faceIds: ['1'] });
  });

  it('turns sketch faces and the whole sketch into targets', () => {
    const project: Project = {
      ...baseProject(),
      features: [
        box,
        {
          id: 'sketch',
          name: 'Sketch',
          suppressed: false,
          type: 'sketch',
          plane: { type: 'datum', plane: 'XY', offset: 0 },
          entities: [],
          constraints: [],
          references: [],
        },
      ],
    };
    expect(
      quickTargetFromSelection(project, [{ kind: 'face', id: 'sketch#f1' }]),
    ).toEqual({ kind: 'sketch', sketchId: 'sketch', regions: ['f1'] });
    expect(quickTargetFromSelection(project, [{ kind: 'sketch', id: 'sketch' }])).toEqual({
      kind: 'sketch',
      sketchId: 'sketch',
      regions: [],
    });
  });

  it('builds an extrude with the picked inputs', () => {
    const feature = buildQuickExtrude(
      geometry(),
      { op: 'add', bodyIds: ['body-1'] },
      5,
      'Extrude',
    );
    expect(feature).toMatchObject({
      type: 'extrude',
      op: 'add',
      distance: 5,
      reversed: false,
      scope: 'all',
      bodyIds: ['body-1'],
      objectOrder: ['b:body-1#1'],
      faceRefs: [
        { bodyId: 'body-1', faceId: '1', normal: [1, 0, 0], origin: [20, 10, 10] },
      ],
    });
  });

  it('finds the operation an input belongs to', () => {
    const feature = buildQuickExtrude(
      geometry(),
      { op: 'add', bodyIds: ['body-1'] },
      5,
      'Extrude',
    );
    const project: Project = { ...baseProject(), features: [box, feature] };
    expect(findBoundExtrude(project, geometry().target)?.id).toBe(feature.id);
  });

  it('offers a prospective handle for a raw face', () => {
    const project = baseProject();
    const [handle] = handles({
      project,
      selection: [{ kind: 'body-face', id: 'body-1#1' }],
      meshes: { 'body-1': cubeMesh() },
    });
    expect(handle).toMatchObject({
      id: 'extrude:new:bf:body-1:1',
      value: 0,
      tooltip: 'Create',
    });
  });

  it('offers the operation handle when the feature is focused', () => {
    const feature = buildQuickExtrude(
      geometry(),
      { op: 'add', bodyIds: ['body-1'] },
      5,
      'Extrude',
    );
    const project: Project = { ...baseProject(), features: [box, feature] };
    const [handle] = handles({
      project,
      selection: [{ kind: 'feature', id: feature.id }],
    });
    expect(handle).toMatchObject({
      id: `extrude:${feature.id}`,
      value: 5,
      tooltip: 'Distance',
    });
  });

  it('offers a second handle for the opposite direction', () => {
    const feature: ExtrudeFeature = {
      ...buildQuickExtrude(geometry(), { op: 'add', bodyIds: ['body-1'] }, 5, 'Extrude'),
      secondDirection: { end: 'blind', distance: 3 },
    };
    const project: Project = { ...baseProject(), features: [box, feature] };
    const list = handles({
      project,
      selection: [{ kind: 'feature', id: feature.id }],
    });
    expect(list.map((handle) => handle.id)).toEqual([
      `extrude:${feature.id}`,
      `extrude:${feature.id}:second`,
    ]);
    expect(list[1]).toMatchObject({ value: 3, tooltip: 'Second distance' });
    expect(list[1]!.direction[0]).toBe(-1);
  });

  it('hides the handle of a through-all extrusion', () => {
    const throughAll: ExtrudeFeature = {
      ...buildQuickExtrude(geometry(), { op: 'add', bodyIds: ['body-1'] }, 5, 'Extrude'),
      end: 'through-all',
    };
    const project: Project = { ...baseProject(), features: [box, throughAll] };
    expect(
      handles({ project, selection: [{ kind: 'feature', id: throughAll.id }] }),
    ).toEqual([]);

    const withSecond: ExtrudeFeature = {
      ...throughAll,
      secondDirection: { end: 'blind', distance: 2 },
    };
    const withSecondProject: Project = {
      ...baseProject(),
      features: [box, withSecond],
    };
    expect(
      handles({
        project: withSecondProject,
        selection: [{ kind: 'feature', id: withSecond.id }],
      }).map((handle) => handle.id),
    ).toEqual([`extrude:${withSecond.id}:second`]);

    const secondThroughAll: ExtrudeFeature = {
      ...withSecond,
      end: 'blind',
      secondDirection: { end: 'through-all', distance: 2 },
    };
    const secondThroughAllProject: Project = {
      ...baseProject(),
      features: [box, secondThroughAll],
    };
    expect(
      handles({
        project: secondThroughAllProject,
        selection: [{ kind: 'feature', id: secondThroughAll.id }],
      }).map((handle) => handle.id),
    ).toEqual([`extrude:${secondThroughAll.id}`]);
  });
});

describe('quick operation drag', () => {
  beforeEach(() => {
    useDocumentStore.getState().hydrate(baseProject());
  });

  const extrudes = (): ExtrudeFeature[] =>
    useDocumentStore
      .getState()
      .project.features.filter(
        (feature): feature is ExtrudeFeature => feature.type === 'extrude',
      );

  it('creates the operation and focuses it', () => {
    const drag = new QuickExtrudeDrag(geometry(), [], 'Extrude');
    drag.start();
    drag.update(5);
    const [feature] = extrudes();
    expect(feature).toMatchObject({ op: 'add', distance: 5, reversed: false });
    // The grab only starts the operation; the rest of the gesture belongs to it.
    expect(useDocumentStore.getState().selection).toEqual([
      { kind: 'feature', id: feature!.id },
    ]);
    drag.end();
    expect(extrudes()).toHaveLength(1);
  });

  it('edits the second direction with its own handle', () => {
    const first = new QuickExtrudeDrag(geometry(), [], 'Extrude');
    first.start();
    first.update(5);
    first.end();
    const created = extrudes()[0]!;
    useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: { ...created, secondDirection: { end: 'blind', distance: 2 } },
    });

    const second = new QuickExtrudeDrag(geometry(), [], 'Extrude', created.id, 'second');
    second.start();
    second.update(4);
    second.end();

    const features = extrudes();
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({
      distance: 5,
      secondDirection: { end: 'blind', distance: 4 },
    });
  });

  it('keeps the second direction when its handle is dragged to zero', () => {
    const first = new QuickExtrudeDrag(geometry(), [], 'Extrude');
    first.start();
    first.update(5);
    first.end();
    const created = extrudes()[0]!;
    useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: { ...created, secondDirection: { end: 'blind', distance: 2 } },
    });

    const second = new QuickExtrudeDrag(geometry(), [], 'Extrude', created.id, 'second');
    second.start();
    second.update(0.01);
    second.end();

    expect(extrudes()[0]).toMatchObject({
      secondDirection: { end: 'blind', distance: 2 },
    });
  });

  it('keeps the method when the handle is dragged again', () => {
    const first = new QuickExtrudeDrag(geometry(), [], 'Extrude');
    first.start();
    first.update(5);
    first.end();

    const second = new QuickExtrudeDrag(geometry(), [], 'Extrude');
    second.start();
    second.update(-3);
    second.end();

    const features = extrudes();
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ op: 'add', distance: 3, reversed: true });
  });

  it('does not leave an operation below the drag threshold', () => {
    const drag = new QuickExtrudeDrag(geometry(), [], 'Extrude');
    drag.start();
    drag.update(0.01);
    drag.end();
    expect(extrudes()).toHaveLength(0);
  });

  it('cancels a created operation', () => {
    const drag = new QuickExtrudeDrag(geometry(), [], 'Extrude');
    drag.start();
    drag.update(5);
    drag.cancel();
    expect(extrudes()).toHaveLength(0);
  });
});
