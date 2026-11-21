import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeModel,
  createProject,
  type Feature,
  type PrimitiveFeature,
  type SketchFeature,
  type TransformFeature,
} from '@icancad/model';
import { arraySourceOperation } from '../src/quick/array';
import { useDocumentStore } from '../src/stores/documentStore';
import { useUiStore } from '../src/stores/uiStore';
import { modelOf, modelProject } from './modelFixture';

function reset() {
  useDocumentStore.setState({
    project: createProject('Test'),
    selection: [],
    editingFeatureId: null,
    past: [],
    future: [],
    freshFeatureId: null,
  });
  useUiStore.setState({ pickingTransformTargets: null });
}

function lastFeature(): Feature | undefined {
  return activeModel(useDocumentStore.getState().project).features.at(-1);
}

function transformOf(): TransformFeature {
  const feature = modelOf(useDocumentStore.getState().project).features.find(
    (candidate): candidate is TransformFeature => candidate.type === 'transform',
  );
  if (!feature) throw new Error('no transform');
  return feature;
}

function box(id = 'box_a'): PrimitiveFeature {
  return {
    id,
    name: 'Box',
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 10, dy: 10, dz: 10 },
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  };
}

function sketch(id = 'sketch_a'): SketchFeature {
  return {
    id,
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [{ id: 'l', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 }],
    constraints: [],
    references: [],
  };
}

function fixture(): ReturnType<typeof modelProject> {
  return modelProject({
    features: [sketch(), box()],
    bodies: [
      { id: 'body_a', createdBy: 'box_a' },
      { id: 'mesh_a', createdBy: 'box_a', kind: 'mesh' },
    ],
  });
}

describe('transform creation', () => {
  beforeEach(reset);

  it('opens empty and asks for objects', () => {
    const id = useDocumentStore.getState().addTransform('Transform');
    const feature = lastFeature();
    if (feature?.type !== 'transform') throw new Error('no transform');
    expect(feature.bodyIds).toEqual([]);
    expect(feature.sketchIds).toEqual([]);
    expect(feature.transform).toEqual({ translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
    expect(useUiStore.getState().pickingTransformTargets).toBe(id);
  });

  it('starts from picked objects without a picker', () => {
    useDocumentStore.getState().hydrate(fixture());
    const id = useDocumentStore.getState().addTransform('Transform', {
      bodyIds: ['body_a'],
      sketchIds: ['sketch_a'],
    });
    const feature = transformOf();
    expect(feature.bodyIds).toEqual(['body_a']);
    expect(feature.sketchIds).toEqual(['sketch_a']);
    expect(useUiStore.getState().pickingTransformTargets).toBeNull();
    expect(id).toBeTruthy();
  });

  it('adds and drops objects of the list', () => {
    useDocumentStore.getState().hydrate(fixture());
    useDocumentStore.getState().addTransform('Transform', { bodyIds: ['body_a'] });
    const id = transformOf().id;
    useDocumentStore.getState().toggleTransformSketch(id, 'sketch_a');
    expect(transformOf().sketchIds).toEqual(['sketch_a']);
    useDocumentStore.getState().toggleTransformBody(id, 'body_a');
    expect(transformOf().bodyIds).toEqual([]);
    useDocumentStore.getState().toggleTransformSketch(id, 'sketch_a');
    expect(transformOf().sketchIds).toEqual([]);
    // A mesh is not a B-rep and has nothing to move.
    useDocumentStore.getState().toggleTransformBody(id, 'mesh_a');
    expect(transformOf().bodyIds).toEqual([]);
  });

  it('discards an operation that never got an object', () => {
    useDocumentStore.getState().hydrate(fixture());
    useDocumentStore.getState().addTransform('Transform');
    expect(
      modelOf(useDocumentStore.getState().project).features.some(
        (feature) => feature.type === 'transform',
      ),
    ).toBe(true);
    useDocumentStore.getState().endFeatureEdit();
    expect(
      modelOf(useDocumentStore.getState().project).features.some(
        (feature) => feature.type === 'transform',
      ),
    ).toBe(false);
    // The picker that fed it has nothing left to feed either.
    expect(useUiStore.getState().pickingTransformTargets).toBeNull();
  });

  it('keeps a fresh operation that has a sketch to move', () => {
    useDocumentStore.getState().hydrate(fixture());
    useDocumentStore.getState().addTransform('Transform');
    useDocumentStore.getState().toggleTransformSketch(transformOf().id, 'sketch_a');
    useDocumentStore.getState().endFeatureEdit();
    expect(
      modelOf(useDocumentStore.getState().project).features.some(
        (feature) => feature.type === 'transform',
      ),
    ).toBe(true);
  });

  it('is not something an array repeats', () => {
    const feature: TransformFeature = {
      id: 'move',
      name: 'Transform',
      suppressed: false,
      type: 'transform',
      bodyIds: ['body_a'],
      sketchIds: [],
      transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    };
    // A primitive is material and can be repeated; a transform is a pose.
    expect(arraySourceOperation(box())).toBe(true);
    expect(arraySourceOperation(feature)).toBe(false);
  });
});
