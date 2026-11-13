import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyCommands,
  CommandError,
  bodiesInHistory,
  createProject,
  dependentFeaturesOf,
  featureBodyId,
  historyInsertIndex,
  HISTORY_START,
  isMeshObject,
  parseProject,
  ProjectFileError,
  solidBodiesInHistory,
  validateHistory,
  type BodyRef,
  type ExtrudeFeature,
  type PrimitiveFeature,
  type Project,
  type SketchFeature,
} from '../src/index';

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
};

function boxFeature(id = 'feat_box'): PrimitiveFeature {
  return {
    id,
    name: 'Box',
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 20, dy: 10, dz: 5 },
    transform,
  };
}

function bodyFor(featureId: string): BodyRef {
  return {
    id: featureBodyId(featureId),
    createdBy: featureId,
  };
}

function sketchFeature(id = 'feat_sketch'): SketchFeature {
  return {
    id,
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [],
    constraints: [],
    references: [],
  };
}

function extrudeFeature(id = 'feat_extrude', sketchId = 'feat_sketch'): ExtrudeFeature {
  return {
    id,
    name: 'Extrude',
    suppressed: false,
    type: 'extrude',
    sketchId,
    regions: [],
    faceRefs: [],
    objectOrder: [],
    end: 'blind',
    distance: 10,
    reversed: false,
    op: 'new',
    scope: 'all',
    bodyIds: [],
    joinRegions: false,
  };
}

function withBox(): Project {
  return applyCommands(createProject('Test'), [
    { type: 'feature/add', feature: boxFeature() },
    { type: 'body/add', body: bodyFor('feat_box') },
  ]);
}

describe('project model', () => {
  it('creates an empty project with defaults', () => {
    const project = createProject('My part');
    expect(project.name).toBe('My part');
    expect(project.units).toBe('mm');
    expect(project.features).toEqual([]);
    expect(project.bodies).toEqual([]);
    expect(project.view.sectionPlanes).toEqual([]);
    expect(project.historyEnd).toBeNull();
    expect(project.createdAt).toBe(project.updatedAt);
  });

  it('adds feature and body in a single command batch', () => {
    const project = withBox();
    expect(project.features).toHaveLength(1);
    expect(project.bodies).toHaveLength(1);
    expect(project.bodies[0]?.createdBy).toBe('feat_box');
  });

  it('fills new extrude fields when opening an older project', () => {
    const legacy: Record<string, unknown> = { ...extrudeFeature() };
    delete legacy.faceRefs;
    delete legacy.objectOrder;
    delete legacy.reversed;
    const project = parseProject({
      ...createProject('Old project'),
      features: [legacy],
    });
    const parsed = project.features[0] as ExtrudeFeature;
    expect(parsed.faceRefs).toEqual([]);
    expect(parsed.objectOrder).toEqual([]);
    expect(parsed.reversed).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const project = withBox();
    expect(() => applyCommand(project, { type: 'feature/add', feature: boxFeature() })).toThrow(
      CommandError,
    );
  });

  it('removes bodies created by a removed feature', () => {
    const project = applyCommand(withBox(), { type: 'feature/remove', featureId: 'feat_box' });
    expect(project.features).toHaveLength(0);
    expect(project.bodies).toHaveLength(0);
  });

  it('renames the project and rejects empty names', () => {
    const project = applyCommand(createProject(), { type: 'project/rename', name: 'Bracket' });
    expect(project.name).toBe('Bracket');
    expect(() => applyCommand(project, { type: 'project/rename', name: '   ' })).toThrow(CommandError);
  });

  it('tracks history end', () => {
    const project = withBox();
    const rolled = applyCommand(project, { type: 'history/set-end', featureId: 'feat_box' });
    expect(rolled.historyEnd).toBe('feat_box');
    expect(() =>
      applyCommand(rolled, { type: 'history/set-end', featureId: 'missing' }),
    ).toThrow(CommandError);

    const atStart = applyCommand(project, { type: 'history/set-end', featureId: HISTORY_START });
    expect(atStart.historyEnd).toBe(HISTORY_START);
    expect(validateHistory(atStart)).toEqual([]);
  });

  it('inserts new features at the history cursor', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'feature/add', feature: boxFeature('feat_box2') },
    ]);
    expect(historyInsertIndex(project)).toBe(2);

    const rolled = applyCommand(project, { type: 'history/set-end', featureId: 'feat_box' });
    expect(historyInsertIndex(rolled)).toBe(1);

    const atStart = applyCommand(rolled, { type: 'history/set-end', featureId: HISTORY_START });
    expect(historyInsertIndex(atStart)).toBe(0);
  });

  it('keeps the cursor at its position when the operation after it is removed', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'feature/add', feature: boxFeature('feat_box2') },
      { type: 'feature/add', feature: boxFeature('feat_box3') },
      { type: 'history/set-end', featureId: 'feat_box2' },
    ]);

    // The cursor followed the second operation, so it lands after the first
    // one instead of jumping to the end of the history.
    const removed = applyCommand(project, { type: 'feature/remove', featureId: 'feat_box2' });
    expect(removed.features.map((feature) => feature.id)).toEqual(['feat_box', 'feat_box3']);
    expect(removed.historyEnd).toBe('feat_box');

    // Removing the first operation puts the cursor at the start of the history.
    const atFirst = applyCommand(project, { type: 'history/set-end', featureId: 'feat_box' });
    const firstRemoved = applyCommand(atFirst, {
      type: 'feature/remove',
      featureId: 'feat_box',
    });
    expect(firstRemoved.historyEnd).toBe(HISTORY_START);
  });
});

describe('object metadata', () => {
  it('keeps object properties outside the operation and the object record', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'body/add', body: bodyFor('feat_box') },
      { type: 'metadata/patch', objectId: featureBodyId('feat_box'), patch: { name: 'Cube' } },
    ]);
    expect(project.bodies[0]).toEqual({ id: featureBodyId('feat_box'), createdBy: 'feat_box' });
    expect(project.metadata[featureBodyId('feat_box')]).toEqual({ name: 'Cube' });
    const [body] = bodiesInHistory(project);
    expect(body).toMatchObject({ id: featureBodyId('feat_box'), name: 'Cube', visible: true });
  });

  it('merges patches and survives rollback', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'body/add', body: bodyFor('feat_box') },
      { type: 'metadata/patch', objectId: featureBodyId('feat_box'), patch: { color: '#fff' } },
      { type: 'metadata/patch', objectId: featureBodyId('feat_box'), patch: { visible: false } },
    ]);
    expect(project.metadata[featureBodyId('feat_box')]).toEqual({
      color: '#fff',
      visible: false,
    });

    const rolled = applyCommand(project, { type: 'history/set-end', featureId: HISTORY_START });
    expect(bodiesInHistory(rolled)).toEqual([]);
    expect(rolled.metadata[featureBodyId('feat_box')]).toEqual({ color: '#fff', visible: false });

    const forward = applyCommand(rolled, { type: 'history/set-end', featureId: 'feat_box' });
    expect(bodiesInHistory(forward)[0]).toMatchObject({ visible: false, color: '#fff' });
  });

  it('keeps imported meshes out of solid body lists', () => {
    const project = applyCommands(createProject(), [
      {
        type: 'feature/add',
        feature: {
          id: 'feat_import',
          name: 'Imported mesh',
          suppressed: false,
          type: 'import-mesh',
          assetId: 'asset-1',
          format: 'stl',
          transform,
          scale: 1,
        },
      },
      { type: 'body/add', body: { ...bodyFor('feat_import'), kind: 'mesh' } },
    ]);
    const [body] = bodiesInHistory(project);
    expect(body?.kind).toBe('mesh');
    expect(isMeshObject(body!)).toBe(true);
    expect(solidBodiesInHistory(project)).toEqual([]);
  });

  it('recognises imported meshes saved without a kind', () => {
    const project = applyCommands(createProject(), [
      {
        type: 'feature/add',
        feature: {
          id: 'feat_import',
          name: 'Imported mesh',
          suppressed: false,
          type: 'import-mesh',
          assetId: 'asset-1',
          format: 'stl',
          transform,
          scale: 1,
        },
      },
      { type: 'body/add', body: bodyFor('feat_import') },
    ]);
    const parsed = parseProject(JSON.parse(JSON.stringify(project)));
    expect(parsed.bodies[0]?.kind).toBe('mesh');
    expect(solidBodiesInHistory(parsed)).toEqual([]);
  });
});

describe('history validation', () => {
  it('rejects a feature that depends on a later feature', () => {
    const project = createProject();
    expect(() =>
      applyCommands(project, [
        { type: 'feature/add', feature: extrudeFeature() },
        { type: 'feature/add', feature: sketchFeature() },
      ]),
    ).toThrow(CommandError);
  });

  it('accepts a valid sketch → extrude chain', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: sketchFeature() },
      { type: 'feature/add', feature: extrudeFeature() },
    ]);
    expect(validateHistory(project).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('reports a suppressed dependency as a warning', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: sketchFeature() },
      { type: 'feature/add', feature: extrudeFeature() },
      { type: 'feature/toggle-suppressed', featureId: 'feat_sketch' },
    ]);
    const issues = validateHistory(project);
    expect(issues.some((issue) => issue.code === 'SUPPRESSED_DEPENDENCY')).toBe(true);
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('rejects reordering a sketch after its dependent feature', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: sketchFeature() },
      { type: 'feature/add', feature: extrudeFeature() },
    ]);
    expect(() =>
      applyCommand(project, { type: 'feature/reorder', featureId: 'feat_sketch', toIndex: 1 }),
    ).toThrow(CommandError);
  });

  it('rejects references to unknown bodies', () => {
    const project = createProject();
    const extrude = { ...extrudeFeature(), scope: 'selected' as const, bodyIds: ['nope'] };
    expect(() =>
      applyCommands(project, [
        { type: 'feature/add', feature: sketchFeature() },
        { type: 'feature/add', feature: extrude },
      ]),
    ).toThrow(CommandError);
  });
});

describe('deleting a set of operations', () => {
  const chain = () =>
    applyCommands(createProject('Test'), [
      { type: 'feature/add', feature: sketchFeature('feat_a') },
      { type: 'feature/add', feature: extrudeFeature('feat_b', 'feat_a') },
      { type: 'feature/add', feature: extrudeFeature('feat_c', 'feat_b') },
    ]);

  it('merges the dependents of every selected operation', () => {
    const project = chain();
    expect(dependentFeaturesOf(project, ['feat_a', 'feat_c']).map((entry) => entry.id)).toEqual([
      'feat_b',
    ]);
  });

  it('leaves out operations that are selected anyway', () => {
    const project = createProject('Test');
    const diamond = applyCommands(project, [
      { type: 'feature/add', feature: sketchFeature('feat_a') },
      { type: 'feature/add', feature: extrudeFeature('feat_b', 'feat_a') },
      { type: 'feature/add', feature: extrudeFeature('feat_c', 'feat_a') },
    ]);
    expect(dependentFeaturesOf(diamond, ['feat_a', 'feat_b']).map((entry) => entry.id)).toEqual([
      'feat_c',
    ]);
  });

  it('rejects removing an operation whose dependents stay', () => {
    expect(() =>
      applyCommand(chain(), { type: 'feature/remove', featureId: 'feat_a' }),
    ).toThrow(CommandError);
  });

  it('keeps dependents when the removal asks for it', () => {
    const project = applyCommand(chain(), {
      type: 'feature/remove',
      featureId: 'feat_a',
      keepDependents: true,
    });
    expect(project.features.map((feature) => feature.id)).toEqual(['feat_b', 'feat_c']);
  });

  it('stays editable after a removal that kept dependents', () => {
    const project = applyCommand(chain(), {
      type: 'feature/remove',
      featureId: 'feat_a',
      keepDependents: true,
    });
    expect(project.features[0]?.name).toBe('Extrude');
    const renamed = applyCommand(project, {
      type: 'feature/replace',
      feature: { ...project.features[0]!, name: 'Shell' },
    });
    expect(renamed.features[0]?.name).toBe('Shell');
  });
});

describe('project serialization', () => {
  it('round-trips through JSON and zod validation', () => {
    const project = withBox();
    const restored = parseProject(JSON.parse(JSON.stringify(project)));
    expect(restored).toMatchObject({ id: project.id, name: project.name });
    expect(restored.features).toHaveLength(1);
    expect(restored.bodies).toHaveLength(1);
  });

  it('rejects unsupported schema versions', () => {
    const project = { ...withBox(), schemaVersion: 99 };
    expect(() => parseProject(project)).toThrow(ProjectFileError);
  });

  it('rejects structurally invalid projects', () => {
    expect(() => parseProject({ schemaVersion: 1, name: 'broken' })).toThrow(ProjectFileError);
  });
});
