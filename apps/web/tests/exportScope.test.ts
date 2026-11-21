import type { TessellationResult } from '@icancad/kernel';
import type { Transform } from '@icancad/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../src/stores/documentStore';
import { useExportStore } from '../src/stores/exportStore';
import { useKernelStore } from '../src/stores/kernelStore';
import { modelProject } from './modelFixture';

const BODY = 'feat_box:solid-0';
const HIDDEN = 'feat_hidden:solid-0';

const IDENTITY: Transform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
};

function project() {
  return modelProject({
    features: [
      {
        id: 'feat_box',
        name: 'Box',
        suppressed: false,
        type: 'primitive',
        kind: 'box',
        params: { dx: 10, dy: 10, dz: 10 },
        transform: IDENTITY,
      },
      {
        id: 'feat_hidden',
        name: 'Hidden box',
        suppressed: false,
        type: 'primitive',
        kind: 'box',
        params: { dx: 5, dy: 5, dz: 5 },
        transform: IDENTITY,
      },
    ],
    bodies: [
      { id: BODY, createdBy: 'feat_box' },
      { id: HIDDEN, createdBy: 'feat_hidden' },
    ],
    metadata: { [HIDDEN]: { visible: false } },
  });
}

describe('export scope', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      project: project(),
      selection: [],
      editingFeatureId: null,
      past: [],
      future: [],
      freshFeatureId: null,
    });
    useKernelStore.setState({
      meshes: {
        [BODY]: {} as TessellationResult,
        [HIDDEN]: {} as TessellationResult,
      },
      bodyShapes: {},
    });
    useExportStore.setState({ scope: null, stl: null, exporting: false });
  });

  it('asks what to export when bodies are selected', () => {
    useDocumentStore.getState().select({ kind: 'body', id: BODY });
    useExportStore.getState().start('stl');
    expect(useExportStore.getState().scope).toEqual({
      format: 'stl',
      selectedBodyIds: [BODY],
    });
    expect(useExportStore.getState().stl).toBeNull();
  });

  it('writes only the selection when that scope is chosen', () => {
    useDocumentStore.getState().select({ kind: 'body', id: BODY });
    useExportStore.getState().start('stl');
    void useExportStore.getState().chooseScope('selected');
    expect(useExportStore.getState().scope).toBeNull();
    expect(useExportStore.getState().stl).toEqual({
      bodyIds: [BODY],
      quality: 'standard',
      nameSingleBody: true,
    });
  });

  it('writes the whole model, hidden bodies included, when that scope is chosen', () => {
    useDocumentStore.getState().select({ kind: 'body', id: BODY });
    useExportStore.getState().start('stl');
    void useExportStore.getState().chooseScope('model');
    expect(useExportStore.getState().stl).toMatchObject({
      bodyIds: [BODY, HIDDEN],
      nameSingleBody: false,
    });
  });

  it('exports the visible bodies when nothing is selected and keeps the plain name', () => {
    useExportStore.getState().start('stl');
    expect(useExportStore.getState().scope).toBeNull();
    expect(useExportStore.getState().stl).toMatchObject({
      bodyIds: [BODY],
      nameSingleBody: false,
    });
  });
});
