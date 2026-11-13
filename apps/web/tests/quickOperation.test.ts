import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  type ExtrudeFeature,
  type PrimitiveFeature,
  type Project,
  type SketchFeature,
} from '@icancad/model';
import { QuickExtrudeDrag, RevolveAngleDrag } from '../src/quick/controller';
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

const profile: SketchFeature = {
  id: 'sketch',
  name: 'Profile',
  suppressed: false,
  type: 'sketch',
  plane: { type: 'datum', plane: 'XY', offset: 0 },
  entities: [
    { id: 'l1', type: 'line', construction: false, x1: 10, y1: 0, x2: 20, y2: 0 },
    { id: 'l2', type: 'line', construction: false, x1: 20, y1: 0, x2: 20, y2: 5 },
    { id: 'l3', type: 'line', construction: false, x1: 20, y1: 5, x2: 10, y2: 5 },
    { id: 'l4', type: 'line', construction: false, x1: 10, y1: 5, x2: 10, y2: 0 },
  ],
  constraints: [],
  references: [],
};

function revolveFeature(): ExtrudeFeature {
  return {
    id: 'revolve',
    name: 'Revolve',
    suppressed: false,
    type: 'extrude',
    sketchId: 'sketch',
    regions: [],
    faceRefs: [],
    objectOrder: ['s:sketch#*'],
    method: 'revolve',
    revolve: { axis: { kind: 'world', axis: 'y' }, start: 0, end: 360, inverted: false },
    end: 'blind',
    distance: 10,
    reversed: false,
    op: 'new',
    scope: 'all',
    bodyIds: [],
    joinRegions: true,
  };
}

function revolveProject(): Project {
  return {
    ...createProject(),
    features: [profile, revolveFeature()],
    bodies: [],
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
  revolveStart: 'Revolve start angle',
  revolveEnd: 'Revolve end angle',
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

describe('quick revolve handles', () => {
  it('offers a start and an end angle handle on one arc', () => {
    const project = revolveProject();
    const list = handles({ project, selection: [{ kind: 'feature', id: 'revolve' }] });
    expect(list.map((handle) => handle.id)).toEqual([
      'revolve:revolve:start',
      'revolve:revolve:end',
    ]);
    expect(list[0]).toMatchObject({ value: 0, tooltip: 'Revolve start angle' });
    expect(list[1]).toMatchObject({ value: 360, tooltip: 'Revolve end angle' });
    for (const handle of list) {
      expect(handle.arc).toBeDefined();
      // A full turn starts and ends on the profile itself: the grip sits on the
      // circle the farthest profile point traces around the axis.
      const radial = Math.hypot(handle.origin[0], handle.origin[2]);
      expect(radial).toBeCloseTo(handle.arc!.radius, 6);
      expect(handle.origin[1]).toBeCloseTo(2.5, 5);
      expect(handle.arc!.radius).toBeGreaterThan(19);
      expect(handle.arc!.radius).toBeLessThan(22);
    }
  });

  it('draws the angles the operation sweeps, mirrored when inverted', () => {
    const project = revolveProject();
    const feature = project.features[1] as ExtrudeFeature;
    const inverted: Project = {
      ...project,
      features: [
        profile,
        {
          ...feature,
          revolve: { ...feature.revolve!, start: 30, end: 120, inverted: true },
        },
      ],
    };
    const list = handles({ project: inverted, selection: [{ kind: 'feature', id: 'revolve' }] });
    expect(list.map((handle) => handle.value)).toEqual([-30, -120]);
    expect(list[0]!.arc!.angle).toBeCloseTo((-30 * Math.PI) / 180, 6);
    expect(list[1]!.arc!.angle).toBeCloseTo((-120 * Math.PI) / 180, 6);
  });

  it('offers no handles while the axis cannot be found', () => {
    const project = revolveProject();
    const feature = project.features[1] as ExtrudeFeature;
    const broken: Project = {
      ...project,
      features: [
        profile,
        {
          ...feature,
          revolve: {
            ...feature.revolve!,
            axis: { kind: 'sketch-edge', sketchId: 'missing', entityId: 'l1' },
          },
        },
      ],
    };
    expect(handles({ project: broken, selection: [{ kind: 'feature', id: 'revolve' }] })).toEqual(
      [],
    );
  });

  it('turns the end angle with the pointer and commits one step', () => {
    useDocumentStore.getState().hydrate(revolveProject());
    const drag = new RevolveAngleDrag('revolve', 'end', false, 360);
    drag.start();
    drag.update(90);
    const during = useDocumentStore
      .getState()
      .project.features.find((feature): feature is ExtrudeFeature => feature.id === 'revolve');
    expect(during!.revolve).toMatchObject({ start: 0, end: 90 });
    drag.end();
    const state = useDocumentStore.getState();
    expect(state.past).toHaveLength(1);
    const committed = state.project.features.find(
      (feature): feature is ExtrudeFeature => feature.id === 'revolve',
    );
    expect(committed!.revolve).toMatchObject({ end: 90 });
  });

  it('stores the opposite angle when the sweep is inverted', () => {
    useDocumentStore.getState().hydrate({
      ...revolveProject(),
      features: [
        profile,
        {
          ...revolveFeature(),
          revolve: { axis: { kind: 'world', axis: 'y' }, start: 0, end: 360, inverted: true },
        },
      ],
    });
    const drag = new RevolveAngleDrag('revolve', 'start', true, 0);
    drag.start();
    drag.update(-45);
    const feature = useDocumentStore
      .getState()
      .project.features.find(
        (candidate): candidate is ExtrudeFeature => candidate.id === 'revolve',
      );
    // The chip shows the effective angle; the document keeps the stored one.
    expect(drag.value).toBe(-45);
    expect(feature!.revolve).toMatchObject({ start: 45, inverted: true });
    drag.cancel();
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
