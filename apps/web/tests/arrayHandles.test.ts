import { describe, expect, it } from 'vitest';
import type { ArrayFeature, SketchFeature, SketchFrame } from '@icancad/model';
import { operationHandles } from '../src/quick/operationHandles';
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
  tubeDiameter: 'Tube diameter',
  sides: 'Sides',
  sidesTooltip: 'Sides tooltip',
  arraySpacing: 'Step',
  arrayCount: 'Count',
  arrayAngle: 'Angle',
};

function arrayWith(direction: ArrayFeature['directions'][number]): ArrayFeature {
  return {
    id: 'feat_array',
    type: 'array',
    name: 'Array',
    suppressed: false,
    target: 'bodies',
    bodyIds: ['body_1'],
    featureIds: [],
    directions: [direction],
  } as ArrayFeature;
}

function handlesFor(
  feature: ArrayFeature,
  seed: [number, number, number] | null,
  extra: { sketch?: SketchFeature; frames?: Record<string, SketchFrame> } = {},
) {
  const features = extra.sketch ? [extra.sketch, feature] : [feature];
  return operationHandles({
    project: modelOf(modelProject({ features, bodies: [] })),
    selection: [{ kind: 'feature', id: feature.id }],
    meshes: {},
    baseMeshes: {},
    sketchFrames: extra.frames ?? {},
    bodies: [],
    labels,
    ...(seed ? { arraySeed: { featureId: feature.id, origin: seed } } : {}),
  });
}

const frame: SketchFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function pathSketch(lines: [number, number, number, number][]): SketchFeature {
  return {
    id: 'feat_sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: lines.map(([x1, y1, x2, y2], index) => ({
      id: `line_${index}`,
      type: 'line' as const,
      construction: false,
      x1,
      y1,
      x2,
      y2,
    })),
    constraints: [],
    references: [],
  };
}

describe('array handles', () => {
  it('offers a step arrow and a count grip from the centre of the stamp', () => {
    const handles = handlesFor(
      arrayWith({ kind: 'linear', direction: [1, 0, 0], spacing: 20, count: 3 }),
      [5, 5, 5],
    );
    expect(handles.map((handle) => handle.id)).toEqual([
      'array:feat_array:0:step',
      'array:feat_array:0:count',
    ]);
    const [step, count] = handles;
    // The step arrow is as long as one step; the grip sits where the last copy
    // is, so dragging it by a step adds exactly one copy.
    expect(step!.value).toBe(20);
    expect(step!.origin).toEqual([5, 5, 5]);
    expect(step!.direction).toEqual([1, 0, 0]);
    expect(step!.kind).toBeUndefined();
    expect(count!.value).toBe(40);
    expect(count!.kind).toBe('ball');
    expect(count!.tipOnly).toBe(true);
    expect(count!.tooltip).toBe('Count');
  });

  it('waits for the stamp before showing anything', () => {
    expect(
      handlesFor(arrayWith({ kind: 'linear', direction: [1, 0, 0], spacing: 20, count: 3 }), null),
    ).toEqual([]);
  });

  it('leaves a direction without a step to its count field', () => {
    const handles = handlesFor(
      arrayWith({ kind: 'linear', direction: [0, 1, 0], spacing: 0, count: 2 }),
      [0, 0, 0],
    );
    expect(handles.map((handle) => handle.id)).toEqual(['array:feat_array:0:step']);
  });
});

describe('rotation and path grips', () => {
  const round = (value: number | undefined) => Math.round((value ?? 0) * 100) / 100;

  it('offers an angle arc and a count grip on the first step', () => {
    // A world axis turns the copies around the centre of the model, so the seed
    // at 10 mm rides a circle of that radius.
    const handles = handlesFor(
      arrayWith({
        kind: 'rotation',
        axis: { kind: 'world', axis: 'z' },
        angle: 90,
        count: 3,
      }),
      [10, 0, 0],
    );
    expect(handles.map((handle) => handle.id)).toEqual([
      'array:feat_array:0:angle',
      'array:feat_array:0:count',
    ]);
    const [angle, count] = handles;
    // The arc spans the whole angle of the copies, and its grip sits at the end
    // of it: dragging the grip is dragging the span.
    expect(angle!.value).toBe(90);
    expect(angle!.tooltip).toBe('Angle');
    expect(angle!.arc?.angle).toBeCloseTo(Math.PI / 2);
    // The dial is the ring the copies travel: its centre is the centre of the
    // array, and its radius is the distance from there to the seed.
    expect(angle!.arc?.center).toEqual([0, 0, 0]);
    expect(angle!.arc?.radius).toBe(10);
    expect(round(angle!.origin[0])).toBe(0);
    expect(round(angle!.origin[1])).toBe(10);
    // The count grip sits on the first copy, so a smaller grip means a denser
    // row of copies.
    expect(count!.orbit?.angle).toBeCloseTo(Math.PI / 4);
    expect(round(count!.origin[0])).toBe(7.07);
    expect(round(count!.origin[1])).toBe(7.07);
    expect(count!.kind).toBeUndefined();
  });

  it('puts the count grip of a full turn half way round for two copies', () => {
    const handles = handlesFor(
      arrayWith({
        kind: 'rotation',
        axis: { kind: 'world', axis: 'z' },
        angle: 360,
        count: 2,
      }),
      [10, 0, 0],
    );
    const count = handles.find((handle) => handle.id.endsWith(':count'));
    expect(count?.orbit?.angle).toBeCloseTo(Math.PI);
    // Half a circle round the dial, on the ring of copies.
    expect(round(count?.origin[0])).toBe(-10);
    expect(round(count?.origin[1])).toBe(0);
  });

  it('draws the dial on the ring the copies ride', () => {
    const handles = handlesFor(
      arrayWith({
        kind: 'rotation',
        axis: { kind: 'world', axis: 'y' },
        angle: 90,
        count: 2,
      }),
      [10, 0, 0],
    );
    const angle = handles.find((handle) => handle.id.endsWith(':angle'));
    // A world axis through the centre of the model: the dial is centred on the
    // axis point nearest the seed and its radius reaches the seed.
    expect(angle?.arc?.center).toEqual([0, 0, 0]);
    expect(angle?.arc?.radius).toBe(10);
  });

  it('puts the count grip of a path on its first copy', () => {
    const sketch = pathSketch([[0, 0, 20, 0]]);
    const handles = handlesFor(
      arrayWith({
        kind: 'path',
        paths: [{ kind: 'sketch-edge', sketchId: sketch.id, entityId: 'line_0' }],
        count: 3,
      }),
      [0, 0, 0],
      { sketch, frames: { [sketch.id]: frame } },
    );
    expect(handles.map((handle) => handle.id)).toEqual(['array:feat_array:0:count']);
    const [count] = handles;
    expect(count!.kind).toBe('ball');
    // Half of the path is where the second of three copies sits.
    expect(count!.value).toBe(10);
    expect(count!.origin).toEqual([0, 0, 0]);
  });

  it('shows no grip over a path that does not run end to end', () => {
    const sketch = pathSketch([
      [0, 0, 10, 0],
      [30, 0, 40, 0],
    ]);
    const handles = handlesFor(
      arrayWith({
        kind: 'path',
        paths: [
          { kind: 'sketch-edge', sketchId: sketch.id, entityId: 'line_0' },
          { kind: 'sketch-edge', sketchId: sketch.id, entityId: 'line_1' },
        ],
        count: 3,
      }),
      [0, 0, 0],
      { sketch, frames: { [sketch.id]: frame } },
    );
    expect(handles).toEqual([]);
  });
});
