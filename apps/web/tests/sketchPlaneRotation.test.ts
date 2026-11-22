import {
  applyResolvedValues,
  createProject,
  type SketchFeature,
  type SketchFrame,
} from '@icancad/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { operationHandles } from '../src/quick/operationHandles';
import {
  computeSketchFrame,
  sketchFrameBasis,
  sketchFrameOf,
  sketchRotationAngles,
} from '../src/sketch/sectionPlane';
import { sketchRotationRings } from '../src/sketch/rotation';
import { useDocumentStore } from '../src/stores/documentStore';
import { modelOf, modelProject } from './modelFixture';

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

const close = (actual: readonly number[], expected: readonly number[]): void => {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, 6);
  }
};

function sketch(plane: SketchFeature['plane'], extra: Partial<SketchFeature> = {}): SketchFeature {
  return {
    id: 'feat_sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane,
    entities: [],
    constraints: [],
    references: [],
    ...extra,
  } as SketchFeature;
}

function handlesFor(feature: SketchFeature) {
  return operationHandles({
    project: modelOf(modelProject({ features: [feature], bodies: [] })),
    selection: [{ kind: 'feature', id: feature.id }],
    meshes: {},
    baseMeshes: {},
    sketchFrames: {},
    bodies: [],
    labels,
  });
}

const storedFrame: SketchFrame = {
  origin: [1, 2, 3],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

describe('sketch plane rotation', () => {
  it('turns a datum sketch around its origin', () => {
    const frame = sketchFrameOf(
      sketch({ type: 'datum', plane: 'XY', offset: 10, rotation: [0, 0, 90] }),
    );
    expect(frame.origin).toEqual([0, 0, 10]);
    expect(frame.normal).toEqual([0, 0, 1]);
    close(frame.xAxis, [0, 1, 0]);
    close(frame.yAxis, [-1, 0, 0]);
  });

  it('keeps the offset and the flip in place before turning the axes', () => {
    const frame = sketchFrameOf(
      sketch({
        type: 'datum',
        plane: 'XY',
        offset: 10,
        inverted: true,
        rotation: [0, 0, 90],
      }),
    );
    expect(frame.origin).toEqual([0, 0, 10]);
    expect(frame.normal).toEqual([0, 0, -1]);
    // The flip turns the sketch's own Z clockwise, so its X axis goes to -Y.
    close(frame.xAxis, [0, -1, 0]);
    close(frame.yAxis, [-1, 0, 0]);
  });

  it('turns a face sketch from the pose captured when the face was picked', () => {
    const frame = sketchFrameOf(
      sketch({
        type: 'face',
        bodyId: 'body-1',
        name: '1',
        offset: 0,
        frame: storedFrame,
        rotation: [90, 0, 0],
      }),
    );
    expect(frame.origin).toEqual([1, 2, 3]);
    close(frame.xAxis, [1, 0, 0]);
    close(frame.yAxis, [0, 0, 1]);
    close(frame.normal, [0, -1, 0]);
  });

  it('reads authored angles through the formula resolution', () => {
    const feature = sketch({
      type: 'datum',
      plane: 'XY',
      offset: 0,
      rotation: [{ formula: 'tilt' }, 0, 0],
    });
    expect(sketchRotationAngles(feature)).toEqual([0, 0, 0]);
    const resolved = applyResolvedValues(feature, { 'plane.rotation.0': 30 });
    const frame = computeSketchFrame(resolved);
    close(frame.normal, [0, -0.5, Math.sqrt(3) / 2]);
  });

  it('keeps a frozen frame as the rebuild left it', () => {
    const frozen: SketchFrame = {
      origin: [4, 5, 6],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    };
    const feature = sketch({ type: 'datum', plane: 'XY', offset: 0, rotation: [0, 0, 45] });
    expect(sketchFrameOf(feature, frozen)).toBe(frozen);
    expect(sketchFrameBasis(feature).origin).toEqual([0, 0, 0]);
  });
});

describe('sketch rotation rings', () => {
  it('rides the axes the previous turns left behind', () => {
    const frame = sketchFrameBasis(sketch({ type: 'datum', plane: 'XY', offset: 0 }));
    const [x, y, z] = sketchRotationRings(frame, [90, 30, 0]);
    expect(x).toBeDefined();
    expect(y).toBeDefined();
    expect(z).toBeDefined();
    expect(x!.axis).toEqual([1, 0, 0]);
    expect(x!.reference).toEqual([0, 1, 0]);
    expect(x!.angle).toBeCloseTo(Math.PI / 2);
    // The Y ring sits on the Y axis after the X turn: world Z.
    close(y!.axis, [0, 0, 1]);
    close(y!.reference, [0, -1, 0]);
    expect(y!.angle).toBeCloseTo(Math.PI / 6);
    // The Z ring rides the normal the X and Y turns produced.
    close(z!.axis, [0.5, -Math.sqrt(3) / 2, 0]);
    close(z!.reference, [Math.sqrt(3) / 2, 0.5, 0]);
    expect(z!.angle).toBe(0);
  });
});

describe('sketch rotation handles', () => {
  const rotated = (rotation: SketchFeature['plane']['rotation']) =>
    sketch({ type: 'datum', plane: 'XY', offset: 10, rotation });

  it('appears only when rotation is enabled', () => {
    expect(handlesFor(sketch({ type: 'datum', plane: 'XY', offset: 0 }))).toEqual([]);
  });

  it('offers one ring per sketch axis around the anchor', () => {
    const handles = handlesFor(rotated([0, 0, 0]));
    expect(handles.map((handle) => handle.id)).toEqual([
      'sketch-rotate:feat_sketch:0',
      'sketch-rotate:feat_sketch:1',
      'sketch-rotate:feat_sketch:2',
    ]);
    expect(handles.map((handle) => handle.axis)).toEqual(['x', 'y', 'z']);
    expect(handles.map((handle) => handle.tooltip)).toEqual(['Rotate X', 'Rotate Y', 'Rotate Z']);
    for (const handle of handles) {
      expect(handle.origin).toEqual([0, 0, 10]);
      expect(handle.arc?.center).toEqual([0, 0, 10]);
      // The rings keep one screen size whatever the sketch holds.
      expect(handle.arc?.radiusPx).toBe(72);
    }
  });

  it('turns the stored angle into the arc', () => {
    const handles = handlesFor(rotated([30, 0, 90]));
    expect(handles[0]!.value).toBe(30);
    expect(handles[0]!.arc?.angle).toBeCloseTo(Math.PI / 6);
    expect(handles[2]!.value).toBe(90);
    expect(handles[2]!.arc?.angle).toBeCloseTo(Math.PI / 2);
  });

  it('keeps the rings the same size on screen, whatever the sketch holds', () => {
    const tiny = sketch(
      { type: 'datum', plane: 'XY', offset: 0, rotation: [0, 0, 0] },
      {
        entities: [{ id: 'line_1', type: 'line', construction: false, x1: 0, y1: 0, x2: 1, y2: 0 }],
      },
    );
    const huge = sketch(
      { type: 'datum', plane: 'XY', offset: 0, rotation: [0, 0, 0] },
      {
        entities: [
          { id: 'line_1', type: 'line', construction: false, x1: -500, y1: 0, x2: 500, y2: 0 },
        ],
      },
    );
    for (const feature of [tiny, huge]) {
      for (const handle of handlesFor(feature)) expect(handle.arc?.radiusPx).toBe(72);
    }
  });

  it('leaves an angle that is a formula to its field', () => {
    const handles = handlesFor(rotated([{ formula: 'tilt' }, 0, 0]));
    expect(handles.map((handle) => handle.id)).toEqual([
      'sketch-rotate:feat_sketch:1',
      'sketch-rotate:feat_sketch:2',
    ]);
  });
});

describe('sketch rotation drag', () => {
  beforeEach(() => {
    useDocumentStore.getState().hydrate(createProject());
  });

  it('edits one angle and commits a single undo step', () => {
    const feature = sketch({ type: 'datum', plane: 'XY', offset: 0, rotation: [0, 0, 0] });
    useDocumentStore.getState().hydrate(modelProject({ features: [feature], bodies: [] }));
    const handle = handlesFor(feature).find((candidate) => candidate.id.endsWith(':1'));
    expect(handle).toBeDefined();
    const drag = handle!.beginDrag();
    expect(drag.unit).toBe('angle');
    expect(drag.label).toBe('Rotate Y');
    drag.update(45);
    const edited = modelOf(useDocumentStore.getState().project).features.find(
      (candidate) => candidate.id === feature.id,
    ) as SketchFeature;
    expect(edited.plane.rotation).toEqual([0, 45, 0]);
    drag.end();
    expect(useDocumentStore.getState().past).toHaveLength(1);
  });
});
