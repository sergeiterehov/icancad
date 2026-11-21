import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type PrimitiveFeature, type Project } from '@icancad/model';
import {
  defaultPrimitiveFeature,
  normalizePrimitive,
  primitiveGizmoOrigin,
} from '../src/primitive/params';
import { operationHandles } from '../src/quick/operationHandles';
import { useDocumentStore } from '../src/stores/documentStore';
import { useFormulaStore } from '../src/stores/formulaStore';
import { modelOf, modelProject } from './modelFixture';
import { resolved } from './resolvedFixture';

const labels = {
  extrude: 'Extrude',
  create: 'Create',
  distance: 'Distance',
  secondDistance: 'Second distance',
  edgeTreatment: 'Edge',
  edgeTreatmentTooltip: 'Edge',
  edgeTreatmentRadiusTooltip: 'Radius',
  edgeTreatmentDistanceTooltip: 'Distance',
  revolveStart: 'Start',
  revolveEnd: 'End',
  move: 'Move',
  moveLabel: 'Move',
  moveX: 'Move X',
  moveY: 'Move Y',
  moveZ: 'Move Z',
  width: 'Width',
  height: 'Height',
  depth: 'Depth',
  radius: 'Radius',
  diameter: 'Diameter',
  bottomRadius: 'Bottom radius',
  topRadius: 'Top radius',
  baseRadius: 'Base radius',
  ringDiameter: 'Ring diameter',
  ringRadius: 'Ring radius',
  tubeRadius: 'Tube radius',
  tubeDiameter: 'Tube diameter',
  sides: 'Sides',
  sidesTooltip: 'Sides tooltip',
  arraySpacing: 'Step',
  arrayCount: 'Count',
  arrayAngle: 'Angle',
  sketchRotateX: 'Rotate X',
  sketchRotateY: 'Rotate Y',
  sketchRotateZ: 'Rotate Z',
  transformRotateX: 'Rotate X',
  transformRotateY: 'Rotate Y',
  transformRotateZ: 'Rotate Z',
  transformScale: 'Scale',
};

function projectWith(feature: PrimitiveFeature): Project {
  return modelProject({ features: [feature], bodies: [] });
}

function handlesFor(feature: PrimitiveFeature) {
  return operationHandles({
    project: modelOf(projectWith(feature)),
    selection: [{ kind: 'feature', id: feature.id }],
    meshes: {},
    baseMeshes: {},
    sketchFrames: {},
    bodies: [],
    labels,
  });
}

describe('primitive parameters', () => {
  it('creates all seven kinds with sensible defaults', () => {
    expect(defaultPrimitiveFeature('box', 'Cube', 'ab').params).toEqual({
      dx: 20,
      dy: 20,
      dz: 20,
    });
    expect(defaultPrimitiveFeature('sphere', 'Sphere', 'cd').params).toEqual({ radius: 10 });
    expect(defaultPrimitiveFeature('cylinder', 'Cylinder', 'ef').params).toEqual({
      radius: 10,
      height: 20,
    });
    expect(defaultPrimitiveFeature('cone', 'Cone', 'gh').params).toEqual({
      bottomRadius: 10,
      topRadius: 0,
      height: 20,
    });
    expect(defaultPrimitiveFeature('torus', 'Torus', 'ij').params).toEqual({
      majorRadius: 20,
      tubeRadius: 5,
    });
    expect(defaultPrimitiveFeature('pyramid', 'Pyramid', 'kl').params).toEqual({
      sides: 4,
      radius: 10,
      height: 20,
    });
    expect(defaultPrimitiveFeature('capsule', 'Capsule', 'mn').params).toEqual({
      radius: 5,
      height: 20,
    });
  });

  it('keeps the torus tube inside the ring', () => {
    const feature = defaultPrimitiveFeature('torus', 'Torus', 'ab');
    if (feature.kind !== 'torus') throw new Error('expected a torus');
    const normalized = normalizePrimitive({
      ...feature,
      params: { majorRadius: 5, tubeRadius: 20 },
    });
    if (normalized.kind !== 'torus') throw new Error('expected a torus');
    const { majorRadius, tubeRadius } = normalized.params;
    if (typeof majorRadius !== 'number' || typeof tubeRadius !== 'number') {
      throw new Error('expected literal numbers');
    }
    expect(tubeRadius).toBeLessThan(majorRadius);
  });

  it('keeps the pyramid between 3 and 120 sides', () => {
    const feature = defaultPrimitiveFeature('pyramid', 'Pyramid', 'ab');
    if (feature.kind !== 'pyramid') throw new Error('expected a pyramid');
    const tooFew = normalizePrimitive({ ...feature, params: { ...feature.params, sides: 2 } });
    const tooMany = normalizePrimitive({ ...feature, params: { ...feature.params, sides: 300 } });
    if (tooFew.kind !== 'pyramid' || tooMany.kind !== 'pyramid') {
      throw new Error('expected a pyramid');
    }
    expect(tooFew.params.sides).toBe(3);
    expect(tooMany.params.sides).toBe(120);
  });

  it('puts the move gizmo on the position anchor', () => {
    for (const kind of [
      'box',
      'sphere',
      'cylinder',
      'cone',
      'torus',
      'pyramid',
      'capsule',
    ] as const) {
      expect(primitiveGizmoOrigin(resolved(defaultPrimitiveFeature(kind, kind, 'ab')))).toEqual([
        0, 0, 0,
      ]);
    }
  });
});

describe('primitive handles', () => {
  it('offers three size arrows and a move gizmo for a box', () => {
    const box = defaultPrimitiveFeature('box', 'Cube', 'box');
    const ids = handlesFor(resolved(box)).map((handle) => handle.id);
    expect(ids).toEqual([
      'primitive:box:dx',
      'primitive:box:dy',
      'primitive:box:dz',
      'primitive:box:move:x',
      'primitive:box:move:y',
      'primitive:box:move:z',
      'primitive:box:move:plane',
    ]);
    const plane = handlesFor(box).find((handle) => handle.id === 'primitive:box:move:plane');
    expect(plane).toMatchObject({ kind: 'move', origin: [0, 0, 0] });
    const x = handlesFor(box).find((handle) => handle.id === 'primitive:box:move:x');
    expect(x).toMatchObject({ axis: 'x', fixedLengthPx: 96, value: 0 });
    for (const key of ['dx', 'dy', 'dz']) {
      expect(handlesFor(box).find((handle) => handle.id === `primitive:box:${key}`)).toMatchObject({
        shaft: 'dashed',
        tipOnly: true,
      });
    }
    expect(handlesFor(box).find((handle) => handle.id === 'primitive:box:dy')).toMatchObject({
      tooltip: 'Depth',
      direction: [0, 1, 0],
    });
    expect(handlesFor(box).find((handle) => handle.id === 'primitive:box:dz')).toMatchObject({
      tooltip: 'Height',
      direction: [0, 0, 1],
    });
  });

  it('keeps heights on Z and puts the pyramid side grip on the base circle', () => {
    const cylinder = defaultPrimitiveFeature('cylinder', 'Cylinder', 'cylinder');
    expect(
      handlesFor(cylinder).find((handle) => handle.id === 'primitive:cylinder:height'),
    ).toMatchObject({ direction: [0, 0, 1], value: 20 });

    const cone = defaultPrimitiveFeature('cone', 'Cone', 'cone');
    expect(handlesFor(cone).find((handle) => handle.id === 'primitive:cone:height')).toMatchObject({
      direction: [0, 0, 1],
    });
    expect(
      handlesFor(cone).find((handle) => handle.id === 'primitive:cone:topRadius'),
    ).toMatchObject({ origin: [0, 0, 20], direction: [1, 0, 0] });

    const capsule = defaultPrimitiveFeature('capsule', 'Capsule', 'capsule');
    expect(
      handlesFor(capsule).find((handle) => handle.id === 'primitive:capsule:height'),
    ).toMatchObject({ direction: [0, 0, 1] });

    const pyramid = defaultPrimitiveFeature('pyramid', 'Pyramid', 'pyramid');
    const handles = handlesFor(pyramid);
    const radius = handles.find((handle) => handle.id === 'primitive:pyramid:radius');
    expect(radius).toMatchObject({ value: 10, shaft: 'dashed', tipOnly: true });
    expect(radius!.direction[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(radius!.direction[1]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(radius!.direction[2]).toBe(0);
    expect(handles.find((handle) => handle.id === 'primitive:pyramid:height')).toMatchObject({
      direction: [0, 0, 1],
    });

    const sides = handles.find((handle) => handle.id === 'primitive:pyramid:sides');
    expect(sides).toMatchObject({
      value: 45,
      orbit: {
        axis: [0, 0, 1],
        center: [0, 0, 0],
        reference: [1, 0, 0],
        radius: 10,
      },
    });
    expect(sides!.orbit!.angle).toBeCloseTo(Math.PI / 4, 6);
  });

  it('offers no handle for a parameter that is a formula', () => {
    const box = defaultPrimitiveFeature('box', 'Cube', 'box');
    const driven = {
      ...box,
      params: { ...box.params, dx: { formula: 'width' } },
    } as unknown as PrimitiveFeature;
    const project = projectWith(driven);
    useFormulaStore.setState({
      resolution: {
        model: { ...modelOf(project), features: [resolved(box)] },
        inputKey: 'test',
        variableValues: {},
        variableErrors: {},
        errors: {},
        drivenSketches: new Set<string>(),
        revision: 1,
      },
    });
    try {
      const ids = handlesFor(driven).map((handle) => handle.id);
      expect(ids).not.toContain('primitive:box:dx');
      expect(ids).toContain('primitive:box:dy');
    } finally {
      useFormulaStore.setState({ resolution: null });
    }
  });

  it('offers a radius handle for a sphere and radius handles for a torus', () => {
    const sphere = defaultPrimitiveFeature('sphere', 'Sphere', 'sphere');
    const sphereHandle = handlesFor(sphere).find(
      (handle) => handle.id === 'primitive:sphere:radius',
    );
    expect(sphereHandle).toMatchObject({ value: 10, tooltip: 'Radius' });

    const torus = defaultPrimitiveFeature('torus', 'Torus', 'torus');
    const handles = handlesFor(torus);
    expect(handles.find((handle) => handle.id === 'primitive:torus:majorRadius')).toMatchObject({
      origin: [-20, 0, 0],
      value: 20,
      tooltip: 'Ring radius',
    });
    expect(handles.find((handle) => handle.id === 'primitive:torus:tubeRadius')).toMatchObject({
      origin: [20, 0, -5],
      direction: [0, 0, 1],
      value: 5,
      tooltip: 'Tube radius',
    });
  });
});

describe('primitive drags', () => {
  beforeEach(() => {
    useDocumentStore.getState().hydrate(createProject());
  });

  it('edits a size and commits one undo step', () => {
    const box = defaultPrimitiveFeature('box', 'Cube', 'box');
    useDocumentStore.getState().hydrate(projectWith(box));
    useDocumentStore.getState().select({ kind: 'feature', id: box.id });
    const handle = operationHandles({
      project: modelOf(useDocumentStore.getState().project),
      selection: useDocumentStore.getState().selection,
      meshes: {},
      baseMeshes: {},
      sketchFrames: {},
      bodies: [],
      labels,
    }).find((candidate) => candidate.id === 'primitive:box:dx');
    expect(handle).toBeDefined();
    const drag = handle!.beginDrag();
    drag.update(30);
    const edited = modelOf(useDocumentStore.getState().project).features.find(
      (feature) => feature.id === box.id,
    ) as PrimitiveFeature;
    expect(edited.params).toMatchObject({ dx: 30 });
    expect(edited.transform.translation).toEqual([0, 0, 0]);
    drag.end();
    expect(useDocumentStore.getState().past).toHaveLength(1);
    expect(primitiveGizmoOrigin(resolved(edited))).toEqual([0, 0, 0]);
  });

  it('changes the pyramid side count discretely from the orbit grip', () => {
    const pyramid = defaultPrimitiveFeature('pyramid', 'Pyramid', 'pyramid');
    useDocumentStore.getState().hydrate(projectWith(pyramid));
    useDocumentStore.getState().select({ kind: 'feature', id: pyramid.id });
    const handle = operationHandles({
      project: modelOf(useDocumentStore.getState().project),
      selection: useDocumentStore.getState().selection,
      meshes: {},
      baseMeshes: {},
      sketchFrames: {},
      bodies: [],
      labels,
    }).find((candidate) => candidate.id === 'primitive:pyramid:sides');
    expect(handle).toBeDefined();
    const drag = handle!.beginDrag();
    drag.update(30);
    const edited = modelOf(useDocumentStore.getState().project).features.find(
      (feature) => feature.id === pyramid.id,
    ) as PrimitiveFeature;
    expect(edited.params).toMatchObject({ sides: 6 });
    expect(drag.value).toBe(6);
    expect(drag.unit).toBe('count');
    drag.end();
  });

  it('moves a primitive in the view plane', () => {
    const box = defaultPrimitiveFeature('box', 'Cube', 'box');
    useDocumentStore.getState().hydrate(projectWith(box));
    useDocumentStore.getState().select({ kind: 'feature', id: box.id });
    const handle = operationHandles({
      project: modelOf(useDocumentStore.getState().project),
      selection: useDocumentStore.getState().selection,
      meshes: {},
      baseMeshes: {},
      sketchFrames: {},
      bodies: [],
      labels,
    }).find((candidate) => candidate.id === 'primitive:box:move:plane');
    expect(handle).toBeDefined();
    const drag = handle!.beginDrag();
    drag.update(0, false, [5, 0, -2]);
    drag.end();
    const moved = modelOf(useDocumentStore.getState().project).features.find(
      (feature) => feature.id === box.id,
    ) as PrimitiveFeature;
    expect(moved.transform.translation).toEqual([5, 0, -2]);
  });
});
