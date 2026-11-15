import { describe, expect, it } from 'vitest';
import {
  activeModel,
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
  nextModelName,
  parseProject,
  ProjectFileError,
  solidBodiesInHistory,
  validateHistory,
  type BodyRef,
  type ExtrudeFeature,
  type Feature,
  type PrimitiveFeature,
  type Model,
  type Project,
  type ShellFeature,
  type SketchFeature,
  updateActiveModel,
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
    method: 'extrude',
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

function modelOf(project: Project): Model {
  return activeModel(project);
}

function withModel(patch: Partial<Model>, name = 'Test'): Project {
  return updateActiveModel(createProject(name), (model) => ({ ...model, ...patch }));
}

function legacyFile(features: Feature[] = []): Record<string, unknown> {
  const project = createProject('Old project');
  const model = activeModel(project);
  return {
    schemaVersion: 2,
    id: project.id,
    name: project.name,
    units: project.units,
    features,
    bodies: [],
    metadata: {},
    view: model.view,
    historyEnd: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
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
    expect(project.superObjects).toHaveLength(1);
    expect(activeModel(project)).toMatchObject({ type: 'model', name: 'Model' });
    expect(project.activeSuperObjectId).toBe(project.superObjects[0]?.id);
    expect(modelOf(project).features).toEqual([]);
    expect(modelOf(project).bodies).toEqual([]);
    expect(modelOf(project).view.sectionPlanes).toEqual([]);
    expect(modelOf(project).historyEnd).toBeNull();
    expect(project.createdAt).toBe(project.updatedAt);
  });

  it('adds, renames and activates models', () => {
    const project = applyCommands(createProject('Assembly'), [
      {
        type: 'model/add',
        model: { ...activeModel(createProject()), id: 'model-2', name: 'Part' },
      },
      { type: 'model/activate', modelId: 'model-2' },
    ]);
    expect(project.superObjects).toHaveLength(2);
    expect(project.activeSuperObjectId).toBe('model-2');

    const renamed = applyCommand(project, {
      type: 'model/rename',
      modelId: 'model-2',
      name: 'Bracket',
    });
    expect(activeModel(renamed).name).toBe('Bracket');
    expect(() =>
      applyCommand(renamed, { type: 'model/rename', modelId: 'model-2', name: 'Model' }),
    ).toThrow(CommandError);
  });

  it('keeps the history of every model apart', () => {
    const project = applyCommands(createProject('Assembly'), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'body/add', body: bodyFor('feat_box') },
      {
        type: 'model/add',
        model: { ...activeModel(createProject()), id: 'model-2', name: 'Part' },
      },
      { type: 'model/activate', modelId: 'model-2' },
      { type: 'feature/add', feature: boxFeature('feat_second') },
    ]);
    const second = project.superObjects.find((superObject) => superObject.id === 'model-2');
    expect(second?.features.map((feature) => feature.id)).toEqual(['feat_second']);
    expect(activeModel(project).features.map((feature) => feature.id)).toEqual(['feat_second']);
    const first = project.superObjects.find((superObject) => superObject.id !== 'model-2');
    expect(first?.features.map((feature) => feature.id)).toEqual(['feat_box']);
    expect(first?.bodies).toHaveLength(1);
  });

  it('removes a model and refuses to remove the last one', () => {
    const project = applyCommands(createProject('Assembly'), [
      {
        type: 'model/add',
        model: { ...activeModel(createProject()), id: 'model-2', name: 'Part' },
      },
    ]);
    const removed = applyCommand(project, { type: 'model/remove', modelId: 'model-2' });
    expect(removed.superObjects).toHaveLength(1);
    expect(removed.activeSuperObjectId).toBe(removed.superObjects[0]?.id);
    expect(() =>
      applyCommand(removed, { type: 'model/remove', modelId: removed.superObjects[0]!.id }),
    ).toThrow(CommandError);
  });

  it('numbers new model names after the existing ones', () => {
    const project = applyCommands(createProject('Assembly'), [
      {
        type: 'model/add',
        model: { ...activeModel(createProject()), id: 'model-2', name: 'Model 2' },
      },
    ]);
    expect(nextModelName(project, 'Model')).toBe('Model 3');
    expect(nextModelName(project, 'Part')).toBe('Part');
  });

  it('migrates a flat version 2 project into one model', () => {
    const project = parseProject(legacyFile([boxFeature()]));
    expect(project.schemaVersion).toBe(3);
    expect(project.superObjects).toHaveLength(1);
    expect(activeModel(project).name).toBe('Model');
    expect(activeModel(project).features.map((feature) => feature.id)).toEqual(['feat_box']);
    // The migrated project is a normal version 3 document that accepts edits.
    const edited = applyCommand(project, { type: 'body/add', body: bodyFor('feat_box') });
    expect(activeModel(edited).bodies).toHaveLength(1);
  });

  it('names the migrated model with the locale default', () => {
    const project = parseProject(legacyFile(), { modelName: 'Модель' });
    expect(activeModel(project).name).toBe('Модель');
  });

  it('adds feature and body in a single command batch', () => {
    const project = withBox();
    expect(modelOf(project).features).toHaveLength(1);
    expect(modelOf(project).bodies).toHaveLength(1);
    expect(modelOf(project).bodies[0]?.createdBy).toBe('feat_box');
  });

  it('fills new extrude fields when opening an older project', () => {
    const legacy: Record<string, unknown> = { ...extrudeFeature() };
    delete legacy.faceRefs;
    delete legacy.objectOrder;
    delete legacy.reversed;
    delete legacy.method;
    const project = parseProject(legacyFile([legacy as unknown as Feature]));
    const parsed = modelOf(project).features[0] as ExtrudeFeature;
    expect(parsed.faceRefs).toEqual([]);
    expect(parsed.objectOrder).toEqual([]);
    expect(parsed.reversed).toBe(false);
    // An operation saved before revolves existed is a straight extrusion.
    expect(parsed.method).toBe('extrude');
    expect(parsed.revolve).toBeUndefined();
  });

  it('keeps a revolve axis and its angles through a project file', () => {
    const feature: ExtrudeFeature = {
      ...extrudeFeature(),
      method: 'revolve',
      revolve: {
        axis: {
          kind: 'body-edge',
          bodyId: 'body-1',
          edgeId: '3',
          start: [0, 0, 0],
          end: [0, 10, 0],
        },
        start: 15,
        end: 210,
        inverted: true,
      },
    };
    const project = parseProject(legacyFile([feature]));
    expect((modelOf(project).features[0] as ExtrudeFeature).revolve).toEqual(feature.revolve);
  });

  it('keeps shell targets, openings and its offset through a project file', () => {
    const feature: ShellFeature = {
      id: 'feat_shell',
      name: 'Shell',
      suppressed: false,
      type: 'shell',
      bodyIds: ['body-1'],
      removeFaces: [
        {
          bodyId: 'body-1',
          faceId: '5',
          normal: [0, 0, 1],
          origin: [10, 10, 20],
        },
      ],
      thickness: 2,
      offset: 3,
      direction: 'outward',
    };
    const project = parseProject(legacyFile([feature]));
    expect(modelOf(project).features[0]).toEqual(feature);
  });

  it('rejects duplicate ids', () => {
    const project = withBox();
    expect(() => applyCommand(project, { type: 'feature/add', feature: boxFeature() })).toThrow(
      CommandError,
    );
  });

  it('removes bodies created by a removed feature', () => {
    const project = applyCommand(withBox(), { type: 'feature/remove', featureId: 'feat_box' });
    expect(modelOf(project).features).toHaveLength(0);
    expect(modelOf(project).bodies).toHaveLength(0);
  });

  it('renames the project and rejects empty names', () => {
    const project = applyCommand(createProject(), { type: 'project/rename', name: 'Bracket' });
    expect(project.name).toBe('Bracket');
    expect(() => applyCommand(project, { type: 'project/rename', name: '   ' })).toThrow(
      CommandError,
    );
  });

  it('tracks history end', () => {
    const project = withBox();
    const rolled = applyCommand(project, { type: 'history/set-end', featureId: 'feat_box' });
    expect(modelOf(rolled).historyEnd).toBe('feat_box');
    expect(() => applyCommand(rolled, { type: 'history/set-end', featureId: 'missing' })).toThrow(
      CommandError,
    );

    const atStart = applyCommand(project, { type: 'history/set-end', featureId: HISTORY_START });
    expect(modelOf(atStart).historyEnd).toBe(HISTORY_START);
    expect(validateHistory(modelOf(atStart))).toEqual([]);
  });

  it('inserts new features at the history cursor', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'feature/add', feature: boxFeature('feat_box2') },
    ]);
    expect(historyInsertIndex(modelOf(project))).toBe(2);

    const rolled = applyCommand(project, { type: 'history/set-end', featureId: 'feat_box' });
    expect(historyInsertIndex(modelOf(rolled))).toBe(1);

    const atStart = applyCommand(rolled, { type: 'history/set-end', featureId: HISTORY_START });
    expect(historyInsertIndex(modelOf(atStart))).toBe(0);
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
    expect(modelOf(removed).features.map((feature) => feature.id)).toEqual([
      'feat_box',
      'feat_box3',
    ]);
    expect(modelOf(removed).historyEnd).toBe('feat_box');

    // Removing the first operation puts the cursor at the start of the history.
    const atFirst = applyCommand(project, { type: 'history/set-end', featureId: 'feat_box' });
    const firstRemoved = applyCommand(atFirst, {
      type: 'feature/remove',
      featureId: 'feat_box',
    });
    expect(modelOf(firstRemoved).historyEnd).toBe(HISTORY_START);
  });
});

describe('object metadata', () => {
  it('keeps object properties outside the operation and the object record', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'body/add', body: bodyFor('feat_box') },
      { type: 'metadata/patch', objectId: featureBodyId('feat_box'), patch: { name: 'Cube' } },
    ]);
    expect(modelOf(project).bodies[0]).toEqual({
      id: featureBodyId('feat_box'),
      createdBy: 'feat_box',
    });
    expect(modelOf(project).metadata[featureBodyId('feat_box')]).toEqual({ name: 'Cube' });
    const [body] = bodiesInHistory(modelOf(project));
    expect(body).toMatchObject({ id: featureBodyId('feat_box'), name: 'Cube', visible: true });
  });

  it('merges patches and survives rollback', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: boxFeature() },
      { type: 'body/add', body: bodyFor('feat_box') },
      { type: 'metadata/patch', objectId: featureBodyId('feat_box'), patch: { color: '#fff' } },
      { type: 'metadata/patch', objectId: featureBodyId('feat_box'), patch: { visible: false } },
    ]);
    expect(modelOf(project).metadata[featureBodyId('feat_box')]).toEqual({
      color: '#fff',
      visible: false,
    });

    const rolled = applyCommand(project, { type: 'history/set-end', featureId: HISTORY_START });
    expect(bodiesInHistory(modelOf(rolled))).toEqual([]);
    expect(modelOf(rolled).metadata[featureBodyId('feat_box')]).toEqual({
      color: '#fff',
      visible: false,
    });

    const forward = applyCommand(rolled, { type: 'history/set-end', featureId: 'feat_box' });
    expect(bodiesInHistory(modelOf(forward))[0]).toMatchObject({ visible: false, color: '#fff' });
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
    const [body] = bodiesInHistory(modelOf(project));
    expect(body?.kind).toBe('mesh');
    expect(isMeshObject(body!)).toBe(true);
    expect(solidBodiesInHistory(modelOf(project))).toEqual([]);
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
    expect(modelOf(parsed).bodies[0]?.kind).toBe('mesh');
    expect(solidBodiesInHistory(modelOf(parsed))).toEqual([]);
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
    expect(validateHistory(modelOf(project)).filter((issue) => issue.severity === 'error')).toEqual(
      [],
    );
  });

  it('reports a suppressed dependency as a warning', () => {
    const project = applyCommands(createProject(), [
      { type: 'feature/add', feature: sketchFeature() },
      { type: 'feature/add', feature: extrudeFeature() },
      { type: 'feature/toggle-suppressed', featureId: 'feat_sketch' },
    ]);
    const issues = validateHistory(modelOf(project));
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
    expect(
      dependentFeaturesOf(modelOf(project), ['feat_a', 'feat_c']).map((entry) => entry.id),
    ).toEqual(['feat_b']);
  });

  it('leaves out operations that are selected anyway', () => {
    const project = createProject('Test');
    const diamond = applyCommands(project, [
      { type: 'feature/add', feature: sketchFeature('feat_a') },
      { type: 'feature/add', feature: extrudeFeature('feat_b', 'feat_a') },
      { type: 'feature/add', feature: extrudeFeature('feat_c', 'feat_a') },
    ]);
    expect(
      dependentFeaturesOf(modelOf(diamond), ['feat_a', 'feat_b']).map((entry) => entry.id),
    ).toEqual(['feat_c']);
  });

  it('rejects removing an operation whose dependents stay', () => {
    expect(() => applyCommand(chain(), { type: 'feature/remove', featureId: 'feat_a' })).toThrow(
      CommandError,
    );
  });

  it('keeps dependents when the removal asks for it', () => {
    const project = applyCommand(chain(), {
      type: 'feature/remove',
      featureId: 'feat_a',
      keepDependents: true,
    });
    expect(modelOf(project).features.map((feature) => feature.id)).toEqual(['feat_b', 'feat_c']);
  });

  it('stays editable after a removal that kept dependents', () => {
    const project = applyCommand(chain(), {
      type: 'feature/remove',
      featureId: 'feat_a',
      keepDependents: true,
    });
    expect(modelOf(project).features[0]?.name).toBe('Extrude');
    const renamed = applyCommand(project, {
      type: 'feature/replace',
      feature: { ...modelOf(project).features[0]!, name: 'Shell' },
    });
    expect(modelOf(renamed).features[0]?.name).toBe('Shell');
  });
});

describe('project serialization', () => {
  it('round-trips through JSON and zod validation', () => {
    const project = withBox();
    const restored = parseProject(JSON.parse(JSON.stringify(project)));
    expect(restored).toMatchObject({ id: project.id, name: project.name });
    expect(modelOf(restored).features).toHaveLength(1);
    expect(modelOf(restored).bodies).toHaveLength(1);
  });

  it('round-trips every primitive kind', () => {
    const primitives: PrimitiveFeature[] = [
      {
        ...boxFeature('feat_box_kind'),
        kind: 'sphere',
        params: { radius: 8 },
      } as PrimitiveFeature,
      {
        ...boxFeature('feat_cylinder_kind'),
        kind: 'cylinder',
        params: { radius: 8, height: 12 },
      } as PrimitiveFeature,
      {
        ...boxFeature('feat_cone_kind'),
        kind: 'cone',
        params: { bottomRadius: 8, topRadius: 2, height: 12 },
      } as PrimitiveFeature,
      {
        ...boxFeature('feat_torus_kind'),
        kind: 'torus',
        params: { majorRadius: 20, tubeRadius: 4 },
      } as PrimitiveFeature,
      {
        ...boxFeature('feat_pyramid_kind'),
        kind: 'pyramid',
        params: { sides: 5, radius: 10, height: 15 },
      } as PrimitiveFeature,
      {
        ...boxFeature('feat_capsule_kind'),
        kind: 'capsule',
        params: { radius: 4, height: 10 },
      } as PrimitiveFeature,
    ];
    const project = withModel({
      features: [boxFeature(), ...primitives],
      bodies: [boxFeature(), ...primitives].map((feature) => bodyFor(feature.id)),
    });
    const restored = parseProject(JSON.parse(JSON.stringify(project)));
    expect(
      modelOf(restored).features.map((feature) =>
        feature.type === 'primitive' ? feature.kind : feature.type,
      ),
    ).toEqual(['box', 'sphere', 'cylinder', 'cone', 'torus', 'pyramid', 'capsule']);
  });

  it('rejects a torus whose tube fills the hole', () => {
    const project = withModel({
      features: [
        {
          ...boxFeature('feat_bad_torus'),
          kind: 'torus',
          params: { majorRadius: 10, tubeRadius: 10 },
        } as PrimitiveFeature,
      ],
      bodies: [bodyFor('feat_bad_torus')],
    });
    expect(() => parseProject(JSON.parse(JSON.stringify(project)))).toThrow(ProjectFileError);
  });

  it('rejects unsupported schema versions', () => {
    const project = { ...withBox(), schemaVersion: 99 };
    expect(() => parseProject(project)).toThrow(ProjectFileError);
  });

  it('rejects structurally invalid projects', () => {
    expect(() => parseProject({ schemaVersion: 1, name: 'broken' })).toThrow(ProjectFileError);
  });
});
