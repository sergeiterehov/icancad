import { beforeEach, describe, expect, it } from 'vitest';
import { activeModel, createProject } from '@icancad/model';
import { useDocumentStore } from '../src/stores/documentStore';
import { useUiStore } from '../src/stores/uiStore';

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

  it('starts on bodies when bodies were picked, and asks for the rest', () => {
    useDocumentStore.getState().addPrimitiveBox('Box');
    useDocumentStore.getState().endFeatureEdit();
    const bodyId = activeModel(useDocumentStore.getState().project).bodies[0]!.id;
    const id = useDocumentStore.getState().addArray('Array', { bodyIds: [bodyId] });
    const feature = lastFeature();
    if (feature?.type !== 'array') throw new Error('no array');
    expect(feature.target).toBe('bodies');
    expect(feature.bodyIds).toEqual([bodyId]);
    expect(useUiStore.getState().pickingArrayBodies).toBe(id);
    expect(useUiStore.getState().pickingArrayOperations).toBeNull();
  });
});
