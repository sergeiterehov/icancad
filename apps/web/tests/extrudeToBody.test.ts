import type { TessellationResult } from '@icancad/kernel';
import { activeModel, createProject, type Vec3 } from '@icancad/model';
import type { ProfileRegion } from '@icancad/sketch';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../src/stores/documentStore';
import {
  pickReferenceBody,
  profileSamples,
  signedToBodyOffset,
  toBodyPlan,
  traceProfile,
} from '../src/kernel/extrudeToBody';

/** A closed box as a triangulated mesh: enough for a ray to cross it. */
function boxMesh(min: Vec3, max: Vec3): TessellationResult {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const corners: Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const positions = new Float32Array(corners.flat());
  const indices = new Uint32Array(faces.flat());
  return {
    positions,
    normals: new Float32Array(positions.length),
    indices,
    faceIds: new Uint32Array(faces.length),
    triangleCount: faces.length,
    vertexCount: corners.length,
    bbox: { min, max },
  };
}

// The profile sits above the bodies and sweeps down into them.
const frame = {
  origin: [0, 0, 50] as Vec3,
  xAxis: [1, 0, 0] as Vec3,
  yAxis: [0, 1, 0] as Vec3,
};

function square(size: number): ProfileRegion {
  const half = size / 2;
  return {
    id: 'face-1',
    area: size * size,
    depth: 0,
    outer: {
      curves: [
        { type: 'line', x1: -half, y1: -half, x2: half, y2: -half },
        { type: 'line', x1: half, y1: -half, x2: half, y2: half },
        { type: 'line', x1: half, y1: half, x2: -half, y2: half },
        { type: 'line', x1: -half, y1: half, x2: -half, y2: -half },
      ],
      keys: ['c0', 'c1', 'c2', 'c3'],
    },
    holes: [],
    edges: [],
  };
}

const down: Vec3 = [0, 0, -1];

describe('profile probes', () => {
  it('places contour points on the sketch plane', () => {
    const samples = profileSamples([square(2)], frame);
    // Four corners, their duplicates at the shared ends, and a grid inside.
    expect(samples.length).toBeGreaterThanOrEqual(8);
    const xs = samples.map((point) => point[0]);
    expect(Math.min(...xs)).toBeCloseTo(-1, 9);
    expect(Math.max(...xs)).toBeCloseTo(1, 9);
    // The interior is probed as well: a body met under the middle is found.
    const ys = samples.map((point) => point[1]);
    expect(Math.min(...ys)).toBeCloseTo(-1, 9);
    expect(Math.max(...ys)).toBeCloseTo(1, 9);
    // A profile plane that is not the world XY still yields world points.
    const moved = profileSamples([square(2)], {
      origin: [10, 20, 5],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
    });
    expect(moved[0]![0]).toBeCloseTo(10, 9);
  });
});

describe('tracing a profile through bodies', () => {
  const meshes = {
    near: boxMesh([-20, -20, 20], [20, 20, 30]),
    far: boxMesh([-20, -20, 5], [20, 20, 10]),
  };

  it('measures the span every probe crosses', () => {
    const hits = traceProfile(meshes, profileSamples([square(2)], frame), down);
    expect(hits.map((hit) => hit.bodyId)).toEqual(['near', 'far']);
    expect(hits[0]!.near).toBeCloseTo(20, 6);
    expect(hits[0]!.far).toBeCloseTo(30, 6);
    expect(hits[1]!.near).toBeCloseTo(40, 6);
    expect(hits[1]!.far).toBeCloseTo(45, 6);
  });

  it('ignores bodies beside the profile', () => {
    const aside = { aside: boxMesh([100, 100, 20], [120, 120, 30]) };
    expect(traceProfile(aside, profileSamples([square(2)], frame), down)).toEqual([]);
  });

  it('picks the nearest body, the farthest one or the named one', () => {
    const hits = traceProfile(meshes, profileSamples([square(2)], frame), down);
    expect(pickReferenceBody(hits, 'first')).toBe('near');
    expect(pickReferenceBody(hits, 'last')).toBe('far');
    expect(pickReferenceBody(hits, 'first', 'far')).toBe('far');
    // A picked body the sweep never reaches is an error, not a silent body.
    expect(pickReferenceBody(hits, 'first', 'aside')).toBeNull();
    expect(pickReferenceBody([], 'first')).toBeNull();
  });
});

describe('reach of a to-body extent', () => {
  // A body between 20 and 30 mm from the profile plane, measured along the sweep.
  const hits = traceProfile(
    { near: boxMesh([-20, -20, 20], [20, 20, 30]) },
    profileSamples([square(2)], frame),
    down,
  );

  it('ends a front extent on the face itself', () => {
    const plan = toBodyPlan(hits, 'near', 'first', 0)!;
    expect(plan.offset).toBe(0);
    // A margin past the body, so the sliver behind it is always cut off.
    expect(plan.far).toBeCloseTo(31, 6);
    expect(plan.whole).toBe(false);
    expect(plan.outerOffset).toBeUndefined();
  });

  it('leaves a gap of the requested size in front of the face', () => {
    const plan = toBodyPlan(hits, 'near', 'first', 5)!;
    expect(plan.offset).toBeCloseTo(5, 9);
    expect(plan.far).toBeCloseTo(36, 6);
  });

  it('pulls the face into the body by the embed a union needs', () => {
    const plan = toBodyPlan(hits, 'near', 'first', 0, 0.01)!;
    expect(plan.offset).toBeCloseTo(-0.01, 9);
    expect(plan.far).toBeCloseTo(31, 6);
  });

  it('builds a layer as a shell on the face', () => {
    const plan = toBodyPlan(hits, 'near', 'first', -3)!;
    expect(plan.offset).toBeCloseTo(0, 9);
    expect(plan.outerOffset).toBeCloseTo(3, 9);
    expect(plan.far).toBeCloseTo(34, 6);
  });

  it('passes the whole body for the last extent', () => {
    const plan = toBodyPlan(hits, 'near', 'last', 0)!;
    expect(plan.whole).toBe(true);
    expect(plan.far).toBeCloseTo(31, 6);
  });

  it('reaches past the deepest back crossing of a slanted body', () => {
    const slanted = [{ bodyId: 'x', near: 10, nearMax: 14, far: 20, farMax: 26 }];
    expect(toBodyPlan(slanted, 'x', 'first', 0)!.far).toBeCloseTo(27, 9);
    expect(toBodyPlan(slanted, 'x', 'last', 0)!.far).toBeCloseTo(27, 9);
  });

  it('has nothing to build when the gap swallows the body', () => {
    expect(toBodyPlan(hits, 'near', 'first', 25)).toBeNull();
    expect(toBodyPlan([], 'near', 'first', 1)).toBeNull();
  });
});

describe('offset a face mode asks for', () => {
  it('keeps a document that has no mode yet on its stored sign', () => {
    expect(signedToBodyOffset(5, 'first', undefined)).toBe(5);
    expect(signedToBodyOffset(-3, 'last', undefined)).toBe(-3);
    expect(signedToBodyOffset(0, 'first', undefined)).toBe(0);
  });

  it('stops a gap short of the face that ends the sweep', () => {
    expect(signedToBodyOffset(2, 'first', 'gap')).toBe(2);
    // "Last" ends on the far face, so a gap in front of it runs the other way.
    expect(signedToBodyOffset(2, 'last', 'gap')).toBe(-2);
  });

  it('stands a layer on the same face', () => {
    expect(signedToBodyOffset(3, 'first', 'shell')).toBe(-3);
    expect(signedToBodyOffset(3, 'last', 'shell')).toBe(3);
  });

  it('ends exactly on the face in solid mode', () => {
    expect(signedToBodyOffset(4, 'first', 'solid')).toBe(0);
    expect(signedToBodyOffset(4, 'last', 'solid')).toBe(0);
  });

  it('takes a size, never a direction, from the stored value', () => {
    expect(signedToBodyOffset(-3, 'first', 'gap')).toBe(3);
  });
});

function toBodyExtrude() {
  const feature = activeModel(useDocumentStore.getState().project).features.find(
    (candidate) => candidate.type === 'extrude',
  );
  if (feature?.type !== 'extrude') throw new Error('no extrude');
  return feature;
}

describe('the way a to-body extent ends, as stored', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      project: createProject('Test'),
      selection: [],
      editingFeatureId: null,
      past: [],
      future: [],
      freshFeatureId: null,
    });
  });

  function addExtent(): string {
    const sketchId = useDocumentStore.getState().addSketch('Sketch', 'XY')!;
    const id = useDocumentStore.getState().addExtrude('Extrude', { sketchId })!;
    useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: { ...toBodyExtrude(), end: 'to-body', toBody: { kind: 'first' } },
    });
    return id;
  }

  it('opens a gap at a size of its own and keeps it for a shell', () => {
    const id = addExtent();
    useDocumentStore.getState().setExtrudeToBodyMode(id, 'gap');
    expect(toBodyExtrude().toBody).toEqual({ kind: 'first', mode: 'gap' });
    expect(toBodyExtrude().toBodyOffset).toBe(2);

    useDocumentStore.getState().setExtrudeToBodyOffset(id, 4, 'gap');
    expect(toBodyExtrude().toBodyOffset).toBe(4);

    // The same size, now standing on the face instead of in front of it.
    useDocumentStore.getState().setExtrudeToBodyMode(id, 'shell');
    expect(toBodyExtrude().toBodyOffset).toBe(4);

    // A solid ends on the surface itself; the size is kept for switching back.
    useDocumentStore.getState().setExtrudeToBodyMode(id, 'solid');
    expect(toBodyExtrude().toBody?.mode).toBe('solid');
    expect(toBodyExtrude().toBodyOffset).toBe(4);
  });

  it('writes the mode a stored sign stood for when its size is edited', () => {
    const id = addExtent();
    // A document from before the modes existed: a negative offset is a layer.
    useDocumentStore.getState().setExtrudeToBodyOffset(id, -3);
    const legacy = toBodyExtrude();
    expect(legacy.toBody?.mode).toBeUndefined();
    expect(signedToBodyOffset(-3, 'first', legacy.toBody?.mode)).toBe(-3);

    useDocumentStore.getState().setExtrudeToBodyOffset(id, 3, 'shell');
    const stamped = toBodyExtrude();
    expect(stamped.toBody?.mode).toBe('shell');
    expect(signedToBodyOffset(stamped.toBodyOffset as number, 'first', stamped.toBody?.mode)).toBe(
      -3,
    );
  });
});
