import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyCommands,
  CommandError,
  createProject,
  featureBodyId,
  HISTORY_START,
  parseProject,
  ProjectFileError,
  validateHistory,
  type BodyMeta,
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

function bodyFor(featureId: string): BodyMeta {
  return {
    id: featureBodyId(featureId),
    name: 'Body',
    color: '#6ea8fe',
    visible: true,
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
    end: 'blind',
    distance: 10,
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
