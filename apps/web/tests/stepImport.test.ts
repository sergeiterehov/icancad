import { activeModel, createProject, featureBodyId } from '@icancad/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../src/stores/documentStore';

describe('STEP import in the document', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      project: createProject('Test'),
      selection: [],
      editingFeatureId: null,
      freshFeatureId: null,
      past: [],
      future: [],
      hydrated: true,
    });
  });

  it('adds one solid body per STEP body with its name and colour', () => {
    useDocumentStore.getState().addImportedStep('Fusion part', 'feat_step', [
      { name: 'Housing', color: '#3366cc' },
      { name: 'Lid', color: null },
    ]);

    const state = useDocumentStore.getState();
    const model = activeModel(state.project);
    expect(model.features).toEqual([
      expect.objectContaining({
        id: 'feat_step',
        type: 'import-step',
        assetId: 'feat_step',
      }),
    ]);
    expect(model.bodies.map((body) => body.id)).toEqual([
      featureBodyId('feat_step', 0),
      featureBodyId('feat_step', 1),
    ]);
    expect(model.bodies.every((body) => body.kind === 'solid')).toBe(true);
    expect(model.metadata[featureBodyId('feat_step', 0)]).toMatchObject({
      name: 'Housing',
      color: '#3366cc',
      visible: true,
    });
    // No colour in the file: the palette supplies one.
    expect(model.metadata[featureBodyId('feat_step', 1)]?.color).toBeTruthy();
    expect(state.selection).toEqual([
      { kind: 'body', id: featureBodyId('feat_step', 0) },
      { kind: 'body', id: featureBodyId('feat_step', 1) },
    ]);
  });

  it('takes the whole import back in one undo step', () => {
    useDocumentStore.getState().addImportedStep('Fusion part', 'feat_step', [
      { name: 'Housing', color: '#3366cc' },
    ]);
    useDocumentStore.getState().undo();
    const model = activeModel(useDocumentStore.getState().project);
    expect(model.features).toEqual([]);
    expect(model.bodies).toEqual([]);
  });
});
