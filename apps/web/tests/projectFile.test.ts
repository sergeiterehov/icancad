import { applyCommands, createProject, featureBodyId, ProjectFileError } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
} from '../src/persistence/projectFile';

function sampleProject() {
  return applyCommands(createProject('Printable bracket'), [
    {
      type: 'feature/add',
      feature: {
        id: 'feat_box',
        name: 'Box',
        suppressed: false,
        type: 'primitive',
        kind: 'box',
        params: { dx: 20, dy: 10, dz: 5 },
        transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      },
    },
    {
      type: 'body/add',
      body: {
        id: featureBodyId('feat_box'),
        createdBy: 'feat_box',
      },
    },
    {
      type: 'metadata/patch',
      objectId: featureBodyId('feat_box'),
      patch: { name: 'Box', color: '#6ea8fe', visible: true },
    },
  ]);
}

describe('project file', () => {
  it('round-trips project data and assets through a ZIP archive', async () => {
    const project = sampleProject();
    const assets = new Map([['asset_1', new Uint8Array([1, 2, 3, 4])]]);
    const blob = serializeProjectFile(project, assets);
    const parsed = parseProjectFile(new Uint8Array(await blob.arrayBuffer()));

    expect(parsed.project.id).toBe(project.id);
    expect(parsed.project.name).toBe('Printable bracket');
    expect(parsed.project.features).toHaveLength(1);
    expect(parsed.project.bodies).toHaveLength(1);
    expect(parsed.assets.get('asset_1')).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('rejects files that are not ZIP archives', () => {
    expect(() => parseProjectFile(new Uint8Array([0, 1, 2, 3, 4]))).toThrow(ProjectFileError);
  });

  it('builds a safe file name', () => {
    expect(projectFileName('My Part #1')).toBe('my-part-1.icad');
    expect(projectFileName('Мой проект')).toBe('мой-проект.icad');
    expect(projectFileName('***')).toBe('project.icad');
  });
});

it('keeps projected geometry links through the archive', async () => {
  const project = applyCommands(sampleProject(), [
    {
      type: 'feature/add',
      feature: {
        id: 'feat_sketch',
        name: 'Sketch',
        suppressed: false,
        type: 'sketch',
        plane: { type: 'datum', plane: 'XY', offset: 0 },
        entities: [{ id: 'entity_p', type: 'point', construction: false, x: 1, y: 2 }],
        constraints: [],
        references: [],
        projections: [
          {
            id: 'proj_1',
            entityId: 'entity_p',
            source: { kind: 'vertex', bodyId: 'body_1', elementId: 'v:1,2,0' },
            faceId: '3',
          },
        ],
      },
    },
  ]);
  const blob = serializeProjectFile(project, new Map());
  const parsed = parseProjectFile(new Uint8Array(await blob.arrayBuffer()));
  const sketch = parsed.project.features.find((feature) => feature.id === 'feat_sketch');
  expect(sketch?.type).toBe('sketch');
  if (sketch?.type !== 'sketch') return;
  expect(sketch.projections).toEqual([
    {
      id: 'proj_1',
      entityId: 'entity_p',
      source: { kind: 'vertex', bodyId: 'body_1', elementId: 'v:1,2,0' },
      faceId: '3',
    },
  ]);
});

it('reads a sketch without projections as an empty list', async () => {
  const project = applyCommands(sampleProject(), [
    {
      type: 'feature/add',
      feature: {
        id: 'feat_sketch',
        name: 'Sketch',
        suppressed: false,
        type: 'sketch',
        plane: { type: 'datum', plane: 'XY', offset: 0 },
        entities: [],
        constraints: [],
        references: [],
      },
    },
  ]);
  const blob = serializeProjectFile(project, new Map());
  const sketch = parseProjectFile(new Uint8Array(await blob.arrayBuffer())).project.features.at(-1);
  expect(sketch?.type).toBe('sketch');
  if (sketch?.type !== 'sketch') return;
  expect(sketch.projections).toEqual([]);
});
