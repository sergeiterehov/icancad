import { beforeEach, describe, expect, it } from 'vitest';
import { activeModel, createProject, type Feature, type Model } from '@icancad/model';
import { arrayInputFromSelection } from '../src/quick/array';
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
  useUiStore.setState({ pickingArrayOperations: null, pickingArrayBodies: null });
}

function lastFeature() {
  return activeModel(useDocumentStore.getState().project).features.at(-1);
}

describe('array creation', () => {
  beforeEach(reset);

  it('starts on geometry and asks for operations', () => {
    const id = useDocumentStore.getState().addArray('Array');
    const feature = lastFeature();
    expect(feature?.type).toBe('array');
    if (feature?.type !== 'array') throw new Error('no array');
    expect(feature.target).toBe('geometry');
    expect(feature.bodyIds).toEqual([]);
    expect(feature.featureIds).toEqual([]);
    // The picker is part of creating the operation.
    expect(useUiStore.getState().pickingArrayOperations).toBe(id);
    expect(useUiStore.getState().pickingArrayBodies).toBeNull();
  });

  it('starts on bodies when bodies were picked', () => {
    useDocumentStore.getState().addPrimitiveBox('Box');
    useDocumentStore.getState().endFeatureEdit();
    const bodyId = activeModel(useDocumentStore.getState().project).bodies[0]!.id;
    const id = useDocumentStore.getState().addArray('Array', { bodyIds: [bodyId] });
    const feature = lastFeature();
    if (feature?.type !== 'array') throw new Error('no array');
    // The picked bodies are what it repeats, so the bodies mode is on and the
    // operation is ready to configure without another question.
    expect(feature.target).toBe('bodies');
    expect(feature.bodyIds).toEqual([bodyId]);
    expect(useUiStore.getState().pickingArrayBodies).toBeNull();
    expect(useUiStore.getState().pickingArrayOperations).toBeNull();
    expect(id).toBeTruthy();
  });
});

function sketch(id: string): Feature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [],
    constraints: [],
    references: [],
  };
}

function box(): Feature {
  return {
    id: 'box',
    name: 'Box',
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 20, dy: 20, dz: 20 },
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  };
}

function extrude(): Feature {
  return {
    id: 'e',
    name: 'Extrude',
    suppressed: false,
    type: 'extrude',
    method: 'extrude',
    sketchId: 's',
    regions: [],
    faceRefs: [],
    objectOrder: [],
    end: 'blind',
    distance: 10,
    reversed: false,
    op: 'new',
    scope: 'all',
    bodyIds: [],
    joinRegions: true,
  };
}

function fillet(): Feature {
  return {
    id: 'f',
    name: 'Fillet',
    suppressed: false,
    type: 'edge-treatment',
    kind: 'fillet',
    faceRefs: [],
    edgeRefs: [],
    size: 1,
  };
}

function model(patch: Partial<Model> = {}): Model {
  return modelOf(
    modelProject({
      features: [sketch('s'), extrude(), box(), fillet()],
      bodies: [
        { id: 'body-1', createdBy: 'e' },
        { id: 'mesh-1', createdBy: 'box', kind: 'mesh' },
      ],
      ...patch,
    }),
  );
}

describe('array input from the selection', () => {
  it('repeats the picked bodies', () => {
    expect(arrayInputFromSelection(model(), [{ kind: 'body', id: 'body-1' }])).toEqual({
      bodyIds: ['body-1'],
    });
  });

  it('repeats what the picked operations built or changed', () => {
    // The extrude made a body; the fillet only changed one, and the rebuild
    // replays the material it added and removed just the same.
    expect(
      arrayInputFromSelection(model(), [
        { kind: 'feature', id: 'e' },
        { kind: 'feature', id: 'f' },
      ]),
    ).toEqual({ featureIds: ['e', 'f'] });
  });

  it('skips what an array cannot repeat', () => {
    // A sketch, an imported mesh and a deletion leave nothing to copy.
    expect(arrayInputFromSelection(model(), [{ kind: 'feature', id: 's' }])).toBeNull();
  });

  it('skips bodies a mesh stands for', () => {
    expect(arrayInputFromSelection(model(), [{ kind: 'body', id: 'mesh-1' }])).toBeNull();
  });

  it('skips what the cursor has rolled past', () => {
    expect(
      arrayInputFromSelection(model({ historyEnd: 's' }), [{ kind: 'feature', id: 'e' }]),
    ).toBeNull();
  });

  it('has no single meaning for a mixed selection', () => {
    expect(
      arrayInputFromSelection(model(), [
        { kind: 'body', id: 'body-1' },
        { kind: 'feature', id: 'e' },
      ]),
    ).toBeNull();
  });

  it('starts the operation on the picked operations', () => {
    useDocumentStore
      .getState()
      .hydrate(modelProject({ features: [sketch('s'), extrude(), fillet()] }));
    const id = useDocumentStore.getState().addArray('Array', { featureIds: ['e', 'f'] });
    const feature = lastFeature();
    if (feature?.type !== 'array') throw new Error('no array');
    expect(feature.target).toBe('geometry');
    expect(feature.featureIds).toEqual(['e', 'f']);
    expect(useUiStore.getState().pickingArrayOperations).toBeNull();
    expect(id).toBeTruthy();
  });

  it('opens without a picker when the selection already names operations', () => {
    useDocumentStore
      .getState()
      .hydrate(modelProject({ features: [sketch('s'), extrude(), fillet()] }));
    useDocumentStore.getState().select({ kind: 'feature', id: 'e' });
    const store = useDocumentStore.getState();
    const input = arrayInputFromSelection(activeModel(store.project), store.selection);
    useDocumentStore.getState().addArray('Array', input ?? undefined);
    const feature = lastFeature();
    if (feature?.type !== 'array') throw new Error('no array');
    expect(feature.featureIds).toEqual(['e']);
    // The list is a list, not a picking mode: the copies are drawn while it
    // holds something, without the user having to leave the picking first.
    expect(useUiStore.getState().pickingArrayOperations).toBeNull();
    expect(useUiStore.getState().pickingArrayBodies).toBeNull();
  });

  it('opens in the bodies mode when the selection already names bodies', () => {
    useDocumentStore.getState().hydrate(
      modelProject({
        features: [sketch('s'), extrude()],
        bodies: [{ id: 'body-1', createdBy: 'e' }],
      }),
    );
    useDocumentStore.getState().select({ kind: 'body', id: 'body-1' });
    const store = useDocumentStore.getState();
    const input = arrayInputFromSelection(activeModel(store.project), store.selection);
    useDocumentStore.getState().addArray('Array', input ?? undefined);
    const feature = lastFeature();
    if (feature?.type !== 'array') throw new Error('no array');
    expect(feature.target).toBe('bodies');
    expect(feature.bodyIds).toEqual(['body-1']);
    expect(useUiStore.getState().pickingArrayBodies).toBeNull();
    expect(useUiStore.getState().pickingArrayOperations).toBeNull();
  });
});
