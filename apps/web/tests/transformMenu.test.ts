import { beforeEach, describe, expect, it } from 'vitest';
import { activeModel, createProject, type TransformFeature } from '@icancad/model';
import { modelOf, modelProject } from './modelFixture';
import { transformInputFromTargets, transformMenuItem } from '../src/ui/objectMenu';
import { useDocumentStore } from '../src/stores/documentStore';
import { useUiStore } from '../src/stores/uiStore';
import type { MenuTarget } from '../src/ui/objectMenu';

function target(kind: MenuTarget['kind'], id: string): MenuTarget {
  return { kind, id, objectId: id, name: id, color: '#000000', visible: true };
}

function fixture() {
  return modelProject({
    features: [
      {
        id: 'sketch_a',
        name: 'Sketch',
        suppressed: false,
        type: 'sketch',
        plane: { type: 'datum', plane: 'XY', offset: 0 },
        entities: [],
        constraints: [],
        references: [],
      },
    ],
    bodies: [{ id: 'body_a', createdBy: 'sketch_a' }],
  });
}

describe('transform context menu', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      project: createProject('Test'),
      selection: [],
      editingFeatureId: null,
      past: [],
      future: [],
      freshFeatureId: null,
    });
    useUiStore.setState({ pickingTransformTargets: null });
  });

  it('moves bodies and sketches together', () => {
    expect(
      transformInputFromTargets([target('body', 'body_a'), target('sketch', 'sketch_a')]),
    ).toEqual({ bodyIds: ['body_a'], sketchIds: ['sketch_a'] });
  });

  it('has nothing to offer for an empty selection', () => {
    expect(transformInputFromTargets([])).toBeNull();
    expect(transformMenuItem([], 'Transform')).toBeNull();
  });

  it('refuses a selection with a mesh in it', () => {
    // A mesh has no B-rep, so the objects cannot be moved as one.
    expect(
      transformInputFromTargets([target('body', 'body_a'), target('mesh', 'mesh_a')]),
    ).toBeNull();
    expect(
      transformMenuItem([target('body', 'body_a'), target('mesh', 'mesh_a')], 'Transform'),
    ).toBeNull();
  });

  it('creates the operation from the menu item', () => {
    useDocumentStore.getState().hydrate(fixture());
    const item = transformMenuItem(
      [target('body', 'body_a'), target('sketch', 'sketch_a')],
      'Transform',
    );
    expect(item).not.toBeNull();
    if (!item || !('onSelect' in item)) return;
    item.onSelect();
    const feature = activeModel(useDocumentStore.getState().project).features.find(
      (candidate): candidate is TransformFeature => candidate.type === 'transform',
    );
    expect(feature?.bodyIds).toEqual(['body_a']);
    expect(feature?.sketchIds).toEqual(['sketch_a']);
    expect(useUiStore.getState().pickingTransformTargets).toBeNull();
    expect(modelOf(useDocumentStore.getState().project).features).toHaveLength(2);
  });
});
