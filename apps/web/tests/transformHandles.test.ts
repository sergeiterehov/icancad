import { beforeEach, describe, expect, it } from 'vitest';
import type { PrimitiveFeature, Project, TransformFeature } from '@icancad/model';
import { operationHandles } from '../src/quick/operationHandles';
import { useDocumentStore } from '../src/stores/documentStore';
import { liveProject } from '../src/stores/liveEditStore';
import { useFormulaStore } from '../src/stores/formulaStore';
import { useKernelStore } from '../src/stores/kernelStore';
import { transformMesh } from '../src/kernel/transformPreview';
import { cubeMesh } from './cubeMesh';
import { modelOf, modelProject } from './modelFixture';
import { resolvedModelOf } from './resolvedFixture';

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

const box: PrimitiveFeature = {
  id: 'box_a',
  name: 'Box',
  suppressed: false,
  type: 'primitive',
  kind: 'box',
  params: { dx: 10, dy: 10, dz: 10 },
  transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
};

function move(patch: Partial<TransformFeature> = {}): TransformFeature {
  return {
    id: 'move',
    name: 'Transform',
    suppressed: false,
    type: 'transform',
    bodyIds: ['body_a'],
    sketchIds: [],
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    ...patch,
  };
}

function projectWith(feature: TransformFeature): Project {
  return modelProject({
    features: [box, feature],
    bodies: [{ id: 'body_a', createdBy: 'box_a' }],
  });
}

const PIVOT = { featureId: 'move', origin: [5, 5, 5] as [number, number, number], radius: 10 };

function handlesFor(feature: TransformFeature, pivot?: typeof PIVOT) {
  const project = projectWith(feature);
  const target = pivot ?? PIVOT;
  return operationHandles({
    project: modelOf(project),
    selection: [{ kind: 'feature', id: feature.id }],
    meshes: {},
    baseMeshes: {},
    sketchFrames: {},
    bodies: [],
    labels,
    transformPivot: { ...target, featureId: feature.id },
  });
}

function near(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
}

function stored(): TransformFeature {
  const feature = modelOf(liveProject()).features.find(
    (candidate): candidate is TransformFeature => candidate.type === 'transform',
  );
  if (!feature) throw new Error('no transform');
  return feature;
}

describe('transform handles', () => {
  beforeEach(() => {
    useDocumentStore.getState().hydrate(projectWith(move()));
  });

  it('offers a move gizmo, three rings and a scale grip at the pivot', () => {
    const handles = handlesFor(move());
    expect(handles.map((handle) => handle.id)).toEqual([
      'transform:move:move:x',
      'transform:move:move:y',
      'transform:move:move:z',
      'transform:move:move:plane',
      'transform:move:rotate:0',
      'transform:move:rotate:1',
      'transform:move:rotate:2',
      'transform:move:scale',
    ]);
    expect(handles.filter((handle) => handle.arc !== undefined)).toHaveLength(3);
    expect(handles.find((handle) => handle.id === 'transform:move:move:x')).toMatchObject({
      origin: [5, 5, 5],
      direction: [1, 0, 0],
      value: 0,
      fixedLengthPx: 96,
    });
    // The rings sit half again as far out as the move arrows, so they never
    // steal the pointer from a translation.
    expect(handles.find((handle) => handle.id === 'transform:move:rotate:0')?.arc?.radiusPx).toBe(
      144,
    );
    // The scale grip is a square that starts on the edge of what the operation
    // moves.
    expect(handles.find((handle) => handle.id === 'transform:move:scale')).toMatchObject({
      origin: [5, 5, 5],
      direction: [1, 0, 0],
      value: 10,
      kind: 'square',
    });
  });

  it('has nothing to attach to until the operation has a measured pivot', () => {
    const project = projectWith(move());
    expect(
      operationHandles({
        project: modelOf(project),
        selection: [{ kind: 'feature', id: 'move' }],
        meshes: {},
        baseMeshes: {},
        sketchFrames: {},
        bodies: [],
        labels,
      }),
    ).toEqual([]);
  });

  it('shows the size the operation holds and rings that ride its own axes', () => {
    const handles = handlesFor(
      move({
        transform: { translation: [0, 0, 0], rotation: [0, 30, 0], scale: 2 },
      }),
    );
    // A ring has no absolute angle to show: it is a full circle on the axis the
    // object turns around, and the drag reads the turn from the grab.
    const ring = handles.find((handle) => handle.id === 'transform:move:rotate:0');
    expect(ring?.value).toBe(0);
    expect(ring?.arc?.angle).toBe(0);
    expect(ring?.arc?.fullCircle).toBe(true);
    // A turn about Y leaves Y alone and carries X with it.
    near(ring?.arc?.axis ?? [], [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6)]);
    expect(handles.find((handle) => handle.id === 'transform:move:scale')?.value).toBe(20);
  });

  it('turns the move gizmo with the operation', () => {
    const rotated = move({
      transform: { translation: [0, 0, 0], rotation: [0, 0, 90], scale: 1 },
    });
    useDocumentStore.getState().hydrate(projectWith(rotated));
    const handles = handlesFor(rotated);
    const x = handles.find((handle) => handle.id === 'transform:move:move:x')!;
    const y = handles.find((handle) => handle.id === 'transform:move:move:y')!;
    // A quarter turn about Z sends local X to world Y and local Y to world −X.
    expect(x.direction[0]).toBeCloseTo(0, 9);
    expect(x.direction[1]).toBeCloseTo(1, 9);
    expect(y.direction[0]).toBeCloseTo(-1, 9);
    expect(y.direction[1]).toBeCloseTo(0, 9);
    // The scale grip rides the local X too, and the rings ride the same axes as
    // the arrows, so a ring turns whatever the object turns.
    const scale = handles.find((handle) => handle.id === 'transform:move:scale')!;
    expect(scale.direction[1]).toBeCloseTo(1, 9);
    near(
      handles.find((handle) => handle.id === 'transform:move:rotate:0')!.arc?.axis ?? [],
      [0, 1, 0],
    );

    const drag = x.beginDrag();
    drag.update(5);
    expect(stored().transform.translation).toEqual([5, 0, 0]);
    drag.end();
  });

  it('rides the pivot, so the gizmo follows what the operation moves', () => {
    const shifted = move({
      transform: { translation: [5, 0, 0], rotation: [0, 0, 90], scale: 1 },
    });
    useDocumentStore.getState().hydrate(projectWith(shifted));
    const handles = handlesFor(shifted);
    // The offset is measured along the turned axes, so a move of 5 turns with
    // the operation, and every handle is drawn on the moved pivot.
    const expected = [5, 10, 5];
    near(handles.find((handle) => handle.id === 'transform:move:move:x')!.origin, expected);
    near(handles.find((handle) => handle.id === 'transform:move:move:plane')!.origin, expected);
    near(handles.find((handle) => handle.id === 'transform:move:rotate:0')!.arc!.center, expected);
    near(handles.find((handle) => handle.id === 'transform:move:scale')!.origin, expected);
  });

  it('reads a plane drag in the turned frame', () => {
    const rotated = move({
      transform: { translation: [0, 0, 0], rotation: [0, 0, 90], scale: 1 },
    });
    useDocumentStore.getState().hydrate(projectWith(rotated));
    const plane = handlesFor(rotated).find((handle) => handle.id === 'transform:move:move:plane')!;
    const drag = plane.beginDrag();
    // The pointer went 10 mm along world X, which is local −Y.
    drag.update(10, false, [10, 0, 0]);
    expect(stored().transform.translation).toEqual([0, -10, 0]);
    drag.end();
  });

  it('scales everything it moves around the centre of the whole selection', () => {
    const two = move({ bodyIds: ['body_a', 'body_b'] });
    useDocumentStore.getState().hydrate(
      modelProject({
        features: [box, two],
        bodies: [
          { id: 'body_a', createdBy: 'box_a' },
          { id: 'body_b', createdBy: 'box_a' },
        ],
      }),
    );
    const right = transformMesh(cubeMesh(10), [
      1, 0, 0, 40,
      0, 1, 0, 0,
      0, 0, 1, 0,
    ]);
    useKernelStore.setState({ meshes: { body_a: cubeMesh(10), body_b: right } });
    // Two cubes, one at the origin and one 40 mm along X: the operation turns
    // and scales both around the centre of the pair, at x = 25.
    const drag = handlesFor(two, {
      featureId: two.id,
      origin: [25, 5, 5] as [number, number, number],
      radius: 40,
    })
      .find((handle) => handle.id === `transform:${two.id}:scale`)!
      .beginDrag();
    // The grip is dragged to twice the radius, so the factor is two.
    drag.update(80);
    const drawn = useKernelStore.getState().meshes;
    expect(drawn['body_a']!.bbox.min[0]).toBeCloseTo(-25, 6);
    expect(drawn['body_a']!.bbox.max[0]).toBeCloseTo(-5, 6);
    expect(drawn['body_b']!.bbox.min[0]).toBeCloseTo(55, 6);
    expect(drawn['body_b']!.bbox.max[0]).toBeCloseTo(75, 6);
    drag.cancel();
  });

  it('moves the drawn mesh as the pointer goes, without waiting for a rebuild', () => {
    useKernelStore.setState({ meshes: { body_a: cubeMesh(10) } });
    const handle = handlesFor(move()).find(
      (candidate) => candidate.id === 'transform:move:move:x',
    )!;
    const drag = handle.beginDrag();
    drag.update(5);
    // The operation is applied to the mesh that is already on screen, so the
    // preview follows the pointer before the kernel answers.
    const drawn = useKernelStore.getState().meshes['body_a']!;
    expect(drawn.bbox.min[0]).toBeCloseTo(5, 6);
    expect(drawn.bbox.max[0]).toBeCloseTo(15, 6);
    expect(stored().transform.translation).toEqual([5, 0, 0]);
    drag.end();
  });

  it('moves the operation along an axis in one undo step', () => {
    const handle = handlesFor(move()).find(
      (candidate) => candidate.id === 'transform:move:move:x',
    )!;
    const drag = handle.beginDrag();
    drag.update(7.5);
    expect(stored().transform.translation).toEqual([7.5, 0, 0]);
    expect(drag.value).toBe(7.5);
    drag.end();
    expect(useDocumentStore.getState().past).toHaveLength(1);
  });

  it('turns the operation around the axis the ring shows', () => {
    const handle = handlesFor(move()).find(
      (candidate) => candidate.id === 'transform:move:rotate:2',
    )!;
    const drag = handle.beginDrag();
    drag.update(45);
    expect(stored().transform.rotation).toEqual([0, 0, 45]);
    expect(drag.unit).toBe('angle');
    drag.end();
  });

  it('scales the operation against the measured size', () => {
    const handle = handlesFor(move()).find((candidate) => candidate.id === 'transform:move:scale')!;
    const drag = handle.beginDrag();
    // The grip is dragged to twice the radius.
    drag.update(20);
    expect(stored().transform.scale).toBe(2);
    // The chip reads the operation in percent, as the field does.
    expect(drag.unit).toBe('percent');
    expect(drag.value).toBe(200);
    drag.end();
  });

  it('keeps a value from accumulating over several drags', () => {
    const handle = handlesFor(move()).find(
      (candidate) => candidate.id === 'transform:move:move:x',
    )!;
    const first = handle.beginDrag();
    first.update(5);
    first.end();
    const second = handle.beginDrag();
    second.update(5);
    expect(stored().transform.translation).toEqual([10, 0, 0]);
    second.end();
  });

  it('puts everything back when a grab is cancelled', () => {
    const handle = handlesFor(move()).find(
      (candidate) => candidate.id === 'transform:move:move:z',
    )!;
    const drag = handle.beginDrag();
    drag.update(12);
    drag.cancel();
    expect(stored().transform.translation).toEqual([0, 0, 0]);
    expect(useDocumentStore.getState().past).toHaveLength(0);
  });

  it('offers no handle for a parameter that is a formula', () => {
    const driven = {
      ...move(),
      transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: { formula: 'x' } },
    } as unknown as TransformFeature;
    const project = projectWith(move());
    useDocumentStore.getState().hydrate(projectWith(driven));
    // The engine has the number the field computes; the handle still follows
    // the authored value, which is an expression and has no grip.
    useFormulaStore.setState({
      resolution: {
        model: resolvedModelOf(project),
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
      expect(ids).not.toContain('transform:move:scale');
      expect(ids).toContain('transform:move:move:x');
    } finally {
      useFormulaStore.setState({ resolution: null });
    }
  });
});
