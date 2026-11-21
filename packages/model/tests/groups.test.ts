import { describe, expect, it } from 'vitest';
import {
  activeModel,
  applyCommand,
  applyCommands,
  CommandError,
  createProject,
  groupAtPosition,
  groupFeatureIds,
  groupPath,
  groupRanges,
  insertionPoint,
  nextGroupName,
  parseProject,
  PROJECT_SCHEMA_VERSION,
  pruneEmptyGroups,
  timelineNodes,
  updateActiveModel,
  validateHistory,
  type Feature,
  type FeatureGroup,
  type PrimitiveFeature,
  type Project,
} from '../src/index';

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
};

function box(id: string, groupId?: string): PrimitiveFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 10, dy: 10, dz: 10 },
    transform,
    ...(groupId === undefined ? {} : { groupId }),
  };
}

function group(id: string, parentId: string | null = null, name = id): FeatureGroup {
  return { id, name, parentId };
}

function projectWith(features: Feature[], groups: FeatureGroup[] = []): Project {
  return updateActiveModel(createProject('Groups'), (model) => ({ ...model, features, groups }));
}

function ids(project: Project, parentId: string | null = null): string[] {
  return timelineNodes(activeModel(project), parentId).map((node) => node.id);
}

function create(
  project: Project,
  featureIds: string[],
  childGroupIds: string[] = [],
  parentId: string | null = null,
  id = 'group_new',
) {
  return applyCommand(project, {
    type: 'group/create',
    group: group(id, parentId, 'New group'),
    featureIds,
    childGroupIds,
  });
}

describe('timeline folders', () => {
  it('replaces the operations it owns with one node', () => {
    const project = projectWith([box('a', 'g1'), box('b', 'g1'), box('c')], [group('g1')]);
    const nodes = timelineNodes(activeModel(project), null);
    expect(nodes.map((node) => [node.kind, node.id, node.start, node.end])).toEqual([
      ['group', 'g1', 0, 1],
      ['feature', 'c', 2, 2],
    ]);
    expect(ids(project, 'g1')).toEqual(['a', 'b']);
  });

  it('keeps the order of a nested folder inside its parent', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g1'), box('c', 'g2'), box('d', 'g2'), box('e')],
      [group('g1'), group('g2', 'g1')],
    );
    expect(ids(project)).toEqual(['g1', 'e']);
    expect(ids(project, 'g1')).toEqual(['a', 'b', 'g2']);
    expect(ids(project, 'g2')).toEqual(['c', 'd']);
    expect(groupFeatureIds(activeModel(project), 'g1')).toEqual(['a', 'b', 'c', 'd']);
    expect(groupRanges(activeModel(project)).get('g1')).toEqual({ start: 0, end: 3 });
    expect(groupPath(activeModel(project), 'g2').map((entry) => entry.id)).toEqual(['g1', 'g2']);
  });

  it('shows a feature with a missing folder at the top level', () => {
    const project = projectWith([box('a', 'gone'), box('b')], [group('g1')]);
    expect(timelineNodes(activeModel(project), null).map((node) => node.id)).toEqual(['a', 'b']);
    // The empty folder has nowhere to sit, so it is not drawn either.
    expect(timelineNodes(activeModel(project), 'gone')).toEqual([]);
  });

  it('finds the deepest folder around a position', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g1'), box('c', 'g2'), box('d', 'g2'), box('e')],
      [group('g1'), group('g2', 'g1')],
    );
    const model = activeModel(project);
    expect(groupAtPosition(model, 0)).toBeNull();
    expect(groupAtPosition(model, 1)).toBe('g1');
    expect(groupAtPosition(model, 2)).toBe('g1');
    expect(groupAtPosition(model, 3)).toBe('g2');
    expect(groupAtPosition(model, 4)).toBeNull();
  });

  it('puts an operation added anywhere while the folder is open into it', () => {
    const project = projectWith([box('a', 'g1'), box('b', 'g1'), box('c')], [group('g1')]);
    const model = activeModel(project);
    // The end of the folder appends to it, a cursor outside it is clamped in.
    expect(insertionPoint(model, 2, 'g1')).toEqual({ index: 2, groupId: 'g1' });
    expect(insertionPoint(model, 5, 'g1')).toEqual({ index: 2, groupId: 'g1' });
    expect(insertionPoint(model, 0, 'g1')).toEqual({ index: 0, groupId: 'g1' });
    // Without an open folder the cursor decides, and nowhere means the top level.
    expect(insertionPoint(model, 2, null)).toEqual({ index: 2, groupId: null });
    expect(insertionPoint(model, 1, null)).toEqual({ index: 1, groupId: 'g1' });
  });

  it('numbers a default folder name after the existing ones', () => {
    const project = projectWith([], [group('g1', null, 'Group'), group('g2', null, 'Group 2')]);
    expect(nextGroupName(activeModel(project), 'Group')).toBe('Group 3');
    expect(nextGroupName(activeModel(createProject()), 'Group')).toBe('Group');
  });
});

describe('group commands', () => {
  it('wraps neighbouring operations into a folder', () => {
    const project = projectWith([box('a'), box('b'), box('c')]);
    const next = create(project, ['a', 'b']);
    expect(ids(next)).toEqual(['group_new', 'c']);
    expect(ids(next, 'group_new')).toEqual(['a', 'b']);
    expect(activeModel(next).features.map((feature) => feature.groupId)).toEqual([
      'group_new',
      'group_new',
      undefined,
    ]);
  });

  it('nests an existing folder together with a neighbour', () => {
    const first = create(projectWith([box('a'), box('b'), box('c')]), ['a', 'b'], [], null, 'g1');
    const second = create(first, ['c'], ['g1'], null, 'g2');
    expect(ids(second)).toEqual(['g2']);
    expect(ids(second, 'g2')).toEqual(['g1', 'c']);
    expect(groupRanges(activeModel(second)).get('g2')).toEqual({ start: 0, end: 2 });
  });

  it('refuses a folder of one operation', () => {
    const project = projectWith([box('a'), box('b')]);
    expect(() => create(project, ['a'])).toThrow(CommandError);
  });

  it('refuses operations that are not neighbours', () => {
    const project = projectWith([box('a'), box('b'), box('c')]);
    expect(() => create(project, ['a', 'c'])).toThrow(CommandError);
  });

  it('refuses operations and folders from different levels', () => {
    const project = projectWith([box('a', 'g1'), box('b', 'g1'), box('c')], [group('g1')]);
    expect(() => create(project, ['a', 'c'])).toThrow(CommandError);
    expect(() => create(project, ['b'], ['g1'], null, 'g2')).toThrow(CommandError);
  });

  it('renames a folder in place', () => {
    const project = projectWith([box('a', 'g1'), box('b', 'g1')], [group('g1')]);
    const next = applyCommand(project, { type: 'group/rename', groupId: 'g1', name: '  Frame ' });
    expect(activeModel(next).groups[0]?.name).toBe('Frame');
    expect(() => applyCommand(next, { type: 'group/rename', groupId: 'g1', name: '   ' })).toThrow(
      CommandError,
    );
    expect(() => applyCommand(next, { type: 'group/rename', groupId: 'gone', name: 'X' })).toThrow(
      /Unknown group/,
    );
  });

  it('dissolves a folder into the level that held it', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g1'), box('c', 'g2'), box('d', 'g2'), box('e')],
      [group('g1'), group('g2', 'g1')],
    );
    const inner = applyCommand(project, { type: 'group/dissolve', groupId: 'g2' });
    expect(ids(inner, 'g1')).toEqual(['a', 'b', 'c', 'd']);
    expect(activeModel(inner).features[2]?.groupId).toBe('g1');
    expect(activeModel(inner).groups.map((entry) => entry.id)).toEqual(['g1']);

    const outer = applyCommand(inner, { type: 'group/dissolve', groupId: 'g1' });
    expect(ids(outer)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(activeModel(outer).features[0]?.groupId).toBeUndefined();
    expect(activeModel(outer).groups).toEqual([]);
  });

  it('drops a folder that loses every operation, including its parents', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g2'), box('c', 'g2'), box('d')],
      [group('g1'), group('g2', 'g1')],
    );
    const next = applyCommands(project, [
      { type: 'feature/remove', featureId: 'b' },
      { type: 'feature/remove', featureId: 'c' },
      { type: 'feature/remove', featureId: 'a' },
    ]);
    expect(activeModel(next).groups).toEqual([]);
    expect(activeModel(next).features.map((feature) => feature.id)).toEqual(['d']);
  });

  it('keeps a folder that still holds an operation', () => {
    const project = projectWith([box('a', 'g1'), box('b', 'g1'), box('c')], [group('g1')]);
    const next = applyCommand(project, { type: 'feature/remove', featureId: 'b' });
    expect(activeModel(next).groups.map((entry) => entry.id)).toEqual(['g1']);
    expect(pruneEmptyGroups(activeModel(next))).toBe(activeModel(next));
  });
});

describe('group add and detach', () => {
  const addTo = (
    project: Project,
    groupId: string,
    featureIds: string[],
    childGroupIds: string[] = [],
  ) =>
    applyCommand(project, {
      type: 'group/add',
      groupId,
      featureIds,
      childGroupIds,
    });

  const detach = (
    project: Project,
    groupId: string,
    featureIds: string[],
    childGroupIds: string[] = [],
  ) =>
    applyCommand(project, {
      type: 'group/detach',
      groupId,
      featureIds,
      childGroupIds,
    });

  it('adds the run right after a folder to it', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g1'), box('c'), box('d')],
      [group('g1')],
    );
    const next = addTo(project, 'g1', ['c']);
    expect(ids(next)).toEqual(['g1', 'd']);
    expect(ids(next, 'g1')).toEqual(['a', 'b', 'c']);
  });

  it('adds the run right before a folder to it', () => {
    const project = projectWith([box('a'), box('b', 'g1'), box('c', 'g1')], [group('g1')]);
    const next = addTo(project, 'g1', ['a']);
    expect(ids(next)).toEqual(['g1']);
    expect(ids(next, 'g1')).toEqual(['a', 'b', 'c']);
  });

  it('adds a neighbouring folder, nesting it', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g2'), box('c', 'g2'), box('d')],
      [group('g1'), group('g2')],
    );
    const next = addTo(project, 'g1', [], ['g2']);
    expect(ids(next)).toEqual(['g1', 'd']);
    expect(ids(next, 'g1')).toEqual(['a', 'g2']);
  });

  it('refuses a run that does not touch the folder', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g1'), box('c'), box('d'), box('e')],
      [group('g1')],
    );
    expect(() => addTo(project, 'g1', ['e'])).toThrow(/neighbouring/);
  });

  it('detaches the edge run to the level above', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g1'), box('c'), box('d', 'g2')],
      [group('g1'), group('g2', 'g1')],
    );
    const first = detach(project, 'g1', ['a']);
    expect(activeModel(first).features[0]?.groupId).toBeUndefined();
    expect(ids(first)).toEqual(['a', 'g1', 'c']);
    expect(ids(first, 'g1')).toEqual(['b', 'g2']);

    const last = detach(project, 'g1', [], ['g2']);
    expect(ids(last)).toEqual(['g1', 'c', 'g2']);
    expect(ids(last, 'g1')).toEqual(['a', 'b']);
  });

  it('refuses to detach from the middle of a folder', () => {
    const project = projectWith([box('a', 'g1'), box('b', 'g1'), box('c', 'g1')], [group('g1')]);
    expect(() => detach(project, 'g1', ['b'])).toThrow(/edge/);
  });

  it('drops a folder that loses its last operation', () => {
    const project = projectWith([box('a', 'g1'), box('b')], [group('g1')]);
    const next = detach(project, 'g1', ['a']);
    expect(activeModel(next).groups).toEqual([]);
    expect(ids(next)).toEqual(['a', 'b']);
  });
});

describe('group validation', () => {
  const codes = (project: Project) =>
    validateHistory(activeModel(project)).map((entry) => entry.code);

  it('reports a folder that does not exist', () => {
    expect(codes(projectWith([box('a', 'gone')]))).toContain('UNKNOWN_GROUP');
    expect(codes(projectWith([box('a', 'g1')], [group('g1', 'gone')]))).toContain('UNKNOWN_GROUP');
  });

  it('reports a folder nested in itself', () => {
    expect(codes(projectWith([box('a', 'g1')], [group('g1', 'g2'), group('g2', 'g1')]))).toContain(
      'GROUP_CYCLE',
    );
  });

  it('reports a folder that is not a run of neighbours', () => {
    expect(codes(projectWith([box('a', 'g1'), box('b'), box('c', 'g1')], [group('g1')]))).toContain(
      'GROUP_NOT_CONTIGUOUS',
    );
  });

  it('refuses an edit that would split a folder', () => {
    const project = projectWith([box('a', 'g1'), box('b', 'g1'), box('c')], [group('g1')]);
    expect(() =>
      applyCommand(project, { type: 'feature/reorder', featureId: 'c', toIndex: 1 }),
    ).toThrow(/not a run of neighbouring operations/);
  });

  it('keeps a project that already carries a broken folder editable', () => {
    const project = projectWith([box('a', 'gone'), box('b')]);
    const next = applyCommand(project, { type: 'body/add', body: { id: 'b1', createdBy: 'b' } });
    expect(activeModel(next).bodies).toHaveLength(1);
  });
});

describe('group serialization', () => {
  it('round-trips folders and their members', () => {
    const project = projectWith(
      [box('a', 'g1'), box('b', 'g1'), box('c', 'g2'), box('d')],
      [group('g1'), group('g2', 'g1', 'Inner')],
    );
    const parsed = parseProject(JSON.parse(JSON.stringify(project)));
    expect(activeModel(parsed).groups).toEqual(activeModel(project).groups);
    expect(activeModel(parsed).features.map((feature) => feature.groupId)).toEqual([
      'g1',
      'g1',
      'g2',
      undefined,
    ]);
    expect(ids(parsed, 'g1')).toEqual(['a', 'b', 'g2']);
  });

  it('opens a version 3 document without folders', () => {
    const project = projectWith([box('a'), box('b')]);
    const document = JSON.parse(JSON.stringify(project));
    delete document.superObjects[0].groups;
    document.schemaVersion = 3;
    const parsed = parseProject(document);
    expect(parsed.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(activeModel(parsed).groups).toEqual([]);
    expect(activeModel(parsed).features.map((feature) => feature.id)).toEqual(['a', 'b']);
  });

  it('drops a folder saved without any operation', () => {
    const project = projectWith([box('a')], [group('g1'), group('g2', 'g1')]);
    const parsed = parseProject(JSON.parse(JSON.stringify(project)));
    expect(activeModel(parsed).groups).toEqual([]);
  });
});
