import { groupFeatureIds, groupPath, groupRanges, pruneEmptyGroups } from './groups';
import { historyErrors, type HistoryIssue } from './history';
import { activeModel, touch, updateActiveModel } from './project';
import { variableNameProblem, variableSourceProblem } from './variables';
import {
  HISTORY_START,
  type BodyRef,
  type Feature,
  type FeatureGroup,
  type Model,
  type ObjectMetadata,
  type Project,
  type SuperObject,
  type Variable,
} from './types';

/** Commands that edit the feature history of the active model. */
export type ModelCommand =
  | { type: 'feature/add'; feature: Feature; index?: number }
  | { type: 'feature/replace'; feature: Feature }
  | {
      type: 'feature/remove';
      featureId: string;
      /** Leave the dependents in the history, pointing at a missing operation. */
      keepDependents?: boolean;
    }
  | { type: 'feature/reorder'; featureId: string; toIndex: number }
  | { type: 'feature/toggle-suppressed'; featureId: string }
  | {
      type: 'group/create';
      group: FeatureGroup;
      featureIds: string[];
      childGroupIds: string[];
    }
  | { type: 'group/rename'; groupId: string; name: string }
  | { type: 'group/dissolve'; groupId: string }
  | {
      type: 'group/add';
      groupId: string;
      featureIds: string[];
      childGroupIds: string[];
    }
  | {
      type: 'group/detach';
      groupId: string;
      featureIds: string[];
      childGroupIds: string[];
    }
  | { type: 'body/add'; body: BodyRef }
  | { type: 'metadata/patch'; objectId: string; patch: ObjectMetadata }
  | { type: 'body/remove'; bodyId: string }
  | { type: 'history/set-end'; featureId: string | null };

/** Commands that edit the project itself, including its super-objects. */
export type ProjectCommand =
  | { type: 'project/rename'; name: string }
  | { type: 'model/add'; model: SuperObject }
  | { type: 'model/activate'; modelId: string }
  | { type: 'model/rename'; modelId: string; name: string }
  | { type: 'model/feature/replace'; modelId: string; feature: Feature }
  | { type: 'model/remove'; modelId: string }
  | { type: 'variable/add'; variable: Variable }
  | { type: 'variable/replace'; variable: Variable }
  | { type: 'variable/remove'; variableId: string }
  | { type: 'model-variable/add'; modelId: string; variable: Variable }
  | { type: 'model-variable/replace'; modelId: string; variable: Variable }
  | { type: 'model-variable/remove'; modelId: string; variableId: string };

export type Command = ModelCommand | ProjectCommand;

export type CommandErrorCode =
  | 'UNKNOWN_FEATURE'
  | 'UNKNOWN_GROUP'
  | 'UNKNOWN_BODY'
  | 'UNKNOWN_MODEL'
  | 'UNKNOWN_VARIABLE'
  | 'DUPLICATE_ID'
  | 'INVALID_INDEX'
  | 'INVALID_VALUE'
  | 'INVALID_HISTORY'
  | 'LAST_MODEL';

export class CommandError extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

function isModelCommand(command: Command): command is ModelCommand {
  switch (command.type) {
    case 'feature/add':
    case 'feature/replace':
    case 'feature/remove':
    case 'feature/reorder':
    case 'feature/toggle-suppressed':
    case 'group/create':
    case 'group/rename':
    case 'group/dissolve':
    case 'group/add':
    case 'group/detach':
    case 'body/add':
    case 'metadata/patch':
    case 'body/remove':
    case 'history/set-end':
      return true;
    default:
      return false;
  }
}

function replaceFeature(
  model: Model,
  featureId: string,
  update: (feature: Feature) => Feature,
): Model {
  let found = false;
  const features = model.features.map((feature) => {
    if (feature.id !== featureId) return feature;
    found = true;
    return update(feature);
  });
  if (!found) {
    throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${featureId}`);
  }
  return { ...model, features };
}

function findGroup(model: Model, groupId: string): FeatureGroup {
  const group = model.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new CommandError('UNKNOWN_GROUP', `Unknown group: ${groupId}`);
  return group;
}

function moveToGroup(feature: Feature, groupId: string | null): Feature {
  return groupId === null ? { ...feature, groupId: undefined } : { ...feature, groupId };
}

/**
 * Wraps a run of neighbouring entries of one level into a new folder. The
 * entries may be operations or folders, which is what nests a folder in a
 * folder; either way they must already be neighbours, so the strip keeps
 * showing one item where it showed several.
 */
function createGroup(
  model: Model,
  command: { group: FeatureGroup; featureIds: string[]; childGroupIds: string[] },
): Model {
  const group = command.group;
  if (model.groups.some((candidate) => candidate.id === group.id)) {
    throw new CommandError('DUPLICATE_ID', `Duplicate group id: ${group.id}`);
  }
  const name = group.name.trim();
  if (!name) throw new CommandError('INVALID_VALUE', 'Group name cannot be empty');
  const parentId = group.parentId;
  if (parentId !== null) {
    findGroup(model, parentId);
    const ancestors = new Set(groupPath(model, parentId).map((candidate) => candidate.id));
    for (const childId of command.childGroupIds) {
      if (ancestors.has(childId)) {
        throw new CommandError('INVALID_VALUE', 'A group cannot be nested in its own child');
      }
    }
  }
  const featureIds = [...new Set(command.featureIds)];
  const childGroupIds = [...new Set(command.childGroupIds)];
  if (featureIds.length + childGroupIds.length < 2) {
    throw new CommandError('INVALID_VALUE', 'A group needs at least two neighbours');
  }
  const ranges = groupRanges(model);
  const spans: { start: number; end: number }[] = [];
  for (const featureId of featureIds) {
    const index = model.features.findIndex((candidate) => candidate.id === featureId);
    if (index < 0) {
      throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${featureId}`);
    }
    if ((model.features[index]?.groupId ?? null) !== parentId) {
      throw new CommandError('INVALID_VALUE', 'The operations are not on the same level');
    }
    spans.push({ start: index, end: index });
  }
  for (const childId of childGroupIds) {
    const child = findGroup(model, childId);
    if (child.parentId !== parentId) {
      throw new CommandError('INVALID_VALUE', 'The groups are not on the same level');
    }
    const range = ranges.get(childId);
    if (!range || groupFeatureIds(model, childId).length === 0) {
      throw new CommandError('INVALID_VALUE', 'An empty group cannot be grouped again');
    }
    spans.push(range);
  }
  spans.sort((left, right) => left.start - right.start);
  let expected = spans[0]?.start ?? -1;
  for (const span of spans) {
    if (span.start !== expected) {
      throw new CommandError('INVALID_VALUE', 'A group only holds neighbouring items');
    }
    expected = span.end + 1;
  }
  const movedFeatures = new Set(featureIds);
  const movedGroups = new Set(childGroupIds);
  return {
    ...model,
    features: model.features.map((feature) =>
      movedFeatures.has(feature.id) ? moveToGroup(feature, group.id) : feature,
    ),
    groups: [
      ...model.groups.map((candidate) =>
        movedGroups.has(candidate.id) ? { ...candidate, parentId: group.id } : candidate,
      ),
      { ...group, name },
    ],
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Spans of a run of entries at one level of the strip, validated to be
 * neighbours. `parentId` is the level that currently holds them.
 */
function runSpans(
  model: Model,
  featureIds: readonly string[],
  childGroupIds: readonly string[],
  parentId: string | null,
): { start: number; end: number }[] {
  const ranges = groupRanges(model);
  const spans: { start: number; end: number }[] = [];
  for (const featureId of featureIds) {
    const index = model.features.findIndex((candidate) => candidate.id === featureId);
    if (index < 0) {
      throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${featureId}`);
    }
    if ((model.features[index]?.groupId ?? null) !== parentId) {
      throw new CommandError('INVALID_VALUE', 'The operations are not on the same level');
    }
    spans.push({ start: index, end: index });
  }
  for (const childId of childGroupIds) {
    const child = findGroup(model, childId);
    if (child.parentId !== parentId) {
      throw new CommandError('INVALID_VALUE', 'The groups are not on the same level');
    }
    const range = ranges.get(childId);
    if (!range) {
      throw new CommandError('INVALID_VALUE', 'An empty group has nothing to move');
    }
    spans.push(range);
  }
  if (spans.length === 0) {
    throw new CommandError('INVALID_VALUE', 'There is nothing to move');
  }
  spans.sort((left, right) => left.start - right.start);
  let expected = spans[0]!.start;
  for (const span of spans) {
    if (span.start !== expected) {
      throw new CommandError('INVALID_VALUE', 'A group only holds neighbouring items');
    }
    expected = span.end + 1;
  }
  return spans;
}

/** Moves a validated run of entries into another level. */
function assignRun(
  model: Model,
  featureIds: readonly string[],
  childGroupIds: readonly string[],
  featureParentId: string | null,
  groupParentId: string | null,
): Model {
  const movedFeatures = new Set(featureIds);
  const movedGroups = new Set(childGroupIds);
  return {
    ...model,
    features: model.features.map((feature) =>
      movedFeatures.has(feature.id) ? moveToGroup(feature, featureParentId) : feature,
    ),
    groups: model.groups.map((candidate) =>
      movedGroups.has(candidate.id) ? { ...candidate, parentId: groupParentId } : candidate,
    ),
  };
}

/**
 * Adds a run that sits right before or right after a folder to that folder.
 * Only a neighbouring run keeps the folder a single stretch of the strip, so
 * the command checks the gap on both sides.
 */
function addToGroup(
  model: Model,
  command: { groupId: string; featureIds: string[]; childGroupIds: string[] },
): Model {
  const group = findGroup(model, command.groupId);
  const featureIds = uniqueIds(command.featureIds);
  const childGroupIds = uniqueIds(command.childGroupIds);
  if (childGroupIds.includes(group.id)) {
    throw new CommandError('INVALID_VALUE', 'A group cannot be added to itself');
  }
  const spans = runSpans(model, featureIds, childGroupIds, group.parentId);
  const range = groupRanges(model).get(group.id);
  if (!range) {
    throw new CommandError('INVALID_VALUE', 'An empty group has nowhere to sit');
  }
  const first = spans[0]!;
  const last = spans[spans.length - 1]!;
  const before = last.end + 1 === range.start;
  const after = range.end + 1 === first.start;
  if (!before && !after) {
    throw new CommandError('INVALID_VALUE', 'Only a neighbouring run can join a group');
  }
  return assignRun(model, featureIds, childGroupIds, group.id, group.id);
}

/**
 * Moves a run at the first or last place of a folder out to the level above it.
 * Anything from the middle would split the folder's run, so it stays put.
 */
function detachFromGroup(
  model: Model,
  command: { groupId: string; featureIds: string[]; childGroupIds: string[] },
): Model {
  const group = findGroup(model, command.groupId);
  const featureIds = uniqueIds(command.featureIds);
  const childGroupIds = uniqueIds(command.childGroupIds);
  const spans = runSpans(model, featureIds, childGroupIds, group.id);
  const range = groupRanges(model).get(group.id);
  if (!range) {
    throw new CommandError('INVALID_VALUE', 'An empty group has nothing to give back');
  }
  const first = spans[0]!;
  const last = spans[spans.length - 1]!;
  if (first.start !== range.start && last.end !== range.end) {
    throw new CommandError('INVALID_VALUE', 'Only the edge of a group can leave it');
  }
  return pruneEmptyGroups(
    assignRun(model, featureIds, childGroupIds, group.parentId, group.parentId),
  );
}

function applyModelCommand(model: Model, command: ModelCommand): Model {
  switch (command.type) {
    case 'feature/add': {
      if (model.features.some((feature) => feature.id === command.feature.id)) {
        throw new CommandError('DUPLICATE_ID', `Duplicate feature id: ${command.feature.id}`);
      }
      const features = [...model.features];
      const index = command.index ?? features.length;
      if (index < 0 || index > features.length) {
        throw new CommandError('INVALID_INDEX', `Invalid feature index: ${index}`);
      }
      features.splice(index, 0, command.feature);
      return { ...model, features };
    }
    case 'feature/replace': {
      return replaceFeature(model, command.feature.id, () => command.feature);
    }
    case 'feature/remove': {
      const index = model.features.findIndex((candidate) => candidate.id === command.featureId);
      if (index < 0) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      // The cursor names a position between operations, so removing the
      // operation it follows moves it onto the previous one: the numbered
      // position stays where the user left it instead of jumping to the end.
      const historyEnd =
        model.historyEnd === command.featureId
          ? index > 0
            ? (model.features[index - 1]?.id ?? HISTORY_START)
            : HISTORY_START
          : model.historyEnd;
      return pruneEmptyGroups({
        ...model,
        features: model.features.filter((candidate) => candidate.id !== command.featureId),
        bodies: model.bodies.filter((body) => body.createdBy !== command.featureId),
        historyEnd,
      });
    }
    case 'feature/reorder': {
      const index = model.features.findIndex((feature) => feature.id === command.featureId);
      if (index < 0) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      if (command.toIndex < 0 || command.toIndex >= model.features.length) {
        throw new CommandError('INVALID_INDEX', `Invalid feature index: ${command.toIndex}`);
      }
      const features = [...model.features];
      const [feature] = features.splice(index, 1);
      if (!feature) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      features.splice(command.toIndex, 0, feature);
      return { ...model, features };
    }
    case 'feature/toggle-suppressed': {
      return replaceFeature(model, command.featureId, (feature) => ({
        ...feature,
        suppressed: !feature.suppressed,
      }));
    }
    case 'group/create': {
      return createGroup(model, command);
    }
    case 'group/rename': {
      const group = findGroup(model, command.groupId);
      const name = command.name.trim();
      if (!name) throw new CommandError('INVALID_VALUE', 'Group name cannot be empty');
      return {
        ...model,
        groups: model.groups.map((candidate) =>
          candidate.id === group.id ? { ...candidate, name } : candidate,
        ),
      };
    }
    case 'group/dissolve': {
      const group = findGroup(model, command.groupId);
      const parentId = group.parentId;
      return {
        ...model,
        features: model.features.map((feature) =>
          feature.groupId === group.id ? moveToGroup(feature, parentId) : feature,
        ),
        groups: model.groups
          .filter((candidate) => candidate.id !== group.id)
          .map((candidate) =>
            candidate.parentId === group.id ? { ...candidate, parentId } : candidate,
          ),
      };
    }
    case 'group/add': {
      return addToGroup(model, command);
    }
    case 'group/detach': {
      return detachFromGroup(model, command);
    }
    case 'body/add': {
      if (model.bodies.some((body) => body.id === command.body.id)) {
        throw new CommandError('DUPLICATE_ID', `Duplicate body id: ${command.body.id}`);
      }
      return { ...model, bodies: [...model.bodies, command.body] };
    }
    case 'metadata/patch': {
      const current = model.metadata[command.objectId] ?? {};
      return {
        ...model,
        metadata: { ...model.metadata, [command.objectId]: { ...current, ...command.patch } },
      };
    }
    case 'body/remove': {
      if (!model.bodies.some((body) => body.id === command.bodyId)) {
        throw new CommandError('UNKNOWN_BODY', `Unknown body: ${command.bodyId}`);
      }
      return { ...model, bodies: model.bodies.filter((body) => body.id !== command.bodyId) };
    }
    case 'history/set-end': {
      if (
        command.featureId !== null &&
        command.featureId !== HISTORY_START &&
        !model.features.some((feature) => feature.id === command.featureId)
      ) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      return { ...model, historyEnd: command.featureId };
    }
  }
}

function findSuperObject(project: Project, modelId: string): SuperObject {
  const found = project.superObjects.find((superObject) => superObject.id === modelId);
  if (!found) throw new CommandError('UNKNOWN_MODEL', `Unknown model: ${modelId}`);
  return found;
}

function allVariables(project: Project): Variable[] {
  return [
    ...project.variables,
    ...project.superObjects.flatMap((superObject) => superObject.variables),
  ];
}

function checkVariable(project: Project, variable: Variable, selfId?: string): string {
  const name = variable.name.trim();
  const nameProblem = variableNameProblem(name);
  if (nameProblem === 'EMPTY') {
    throw new CommandError('INVALID_VALUE', 'Variable name cannot be empty');
  }
  if (nameProblem === 'INVALID') {
    throw new CommandError('INVALID_VALUE', `Invalid variable name: ${name}`);
  }
  if (nameProblem === 'RESERVED') {
    throw new CommandError('INVALID_VALUE', `Reserved variable name: ${name}`);
  }
  const duplicate = allVariables(project).some(
    (candidate) => candidate.id !== selfId && candidate.name === name,
  );
  if (duplicate) {
    throw new CommandError('INVALID_VALUE', `Duplicate variable name: ${name}`);
  }
  if (variable.type !== 'number' && variable.type !== 'string') {
    throw new CommandError('INVALID_VALUE', `Unknown variable type: ${variable.type}`);
  }
  const sourceProblem = variableSourceProblem(variable);
  if (sourceProblem) throw new CommandError('INVALID_VALUE', sourceProblem);
  return name;
}

function checkModelName(project: Project, name: string, modelId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CommandError('INVALID_VALUE', 'Model name cannot be empty');
  const duplicate = project.superObjects.some(
    (superObject) => superObject.id !== modelId && superObject.name === trimmed,
  );
  if (duplicate) throw new CommandError('INVALID_VALUE', `Duplicate model name: ${trimmed}`);
  return trimmed;
}

function applyProjectCommand(project: Project, command: ProjectCommand): Project {
  switch (command.type) {
    case 'project/rename': {
      const name = command.name.trim();
      if (!name) throw new CommandError('INVALID_VALUE', 'Project name cannot be empty');
      return { ...project, name };
    }
    case 'model/add': {
      if (project.superObjects.some((superObject) => superObject.id === command.model.id)) {
        throw new CommandError('DUPLICATE_ID', `Duplicate model id: ${command.model.id}`);
      }
      const name = checkModelName(project, command.model.name);
      return {
        ...project,
        superObjects: [...project.superObjects, { ...command.model, name }],
      };
    }
    case 'model/activate': {
      findSuperObject(project, command.modelId);
      return { ...project, activeSuperObjectId: command.modelId };
    }
    case 'model/rename': {
      findSuperObject(project, command.modelId);
      const name = checkModelName(project, command.name, command.modelId);
      return {
        ...project,
        superObjects: project.superObjects.map((superObject) =>
          superObject.id === command.modelId ? { ...superObject, name } : superObject,
        ),
      };
    }
    case 'variable/add': {
      if (allVariables(project).some((variable) => variable.id === command.variable.id)) {
        throw new CommandError('DUPLICATE_ID', `Duplicate variable id: ${command.variable.id}`);
      }
      const name = checkVariable(project, command.variable);
      return {
        ...project,
        variables: [...project.variables, { ...command.variable, name }],
      };
    }
    case 'variable/replace': {
      if (!project.variables.some((variable) => variable.id === command.variable.id)) {
        throw new CommandError('UNKNOWN_VARIABLE', `Unknown variable: ${command.variable.id}`);
      }
      const name = checkVariable(project, command.variable, command.variable.id);
      return {
        ...project,
        variables: project.variables.map((variable) =>
          variable.id === command.variable.id ? { ...command.variable, name } : variable,
        ),
      };
    }
    case 'variable/remove': {
      if (!project.variables.some((variable) => variable.id === command.variableId)) {
        throw new CommandError('UNKNOWN_VARIABLE', `Unknown variable: ${command.variableId}`);
      }
      return {
        ...project,
        variables: project.variables.filter((variable) => variable.id !== command.variableId),
      };
    }
    case 'model/feature/replace': {
      const model = findSuperObject(project, command.modelId);
      return {
        ...project,
        superObjects: project.superObjects.map((superObject) =>
          superObject.id === model.id
            ? replaceFeature(superObject, command.feature.id, () => command.feature)
            : superObject,
        ),
      };
    }
    case 'model-variable/add': {
      const model = findSuperObject(project, command.modelId);
      if (allVariables(project).some((variable) => variable.id === command.variable.id)) {
        throw new CommandError('DUPLICATE_ID', `Duplicate variable id: ${command.variable.id}`);
      }
      const name = checkVariable(project, command.variable);
      return {
        ...project,
        superObjects: project.superObjects.map((superObject) =>
          superObject.id === model.id
            ? {
                ...superObject,
                variables: [...superObject.variables, { ...command.variable, name }],
              }
            : superObject,
        ),
      };
    }
    case 'model-variable/replace': {
      const model = findSuperObject(project, command.modelId);
      if (!model.variables.some((variable) => variable.id === command.variable.id)) {
        throw new CommandError('UNKNOWN_VARIABLE', `Unknown variable: ${command.variable.id}`);
      }
      const name = checkVariable(project, command.variable, command.variable.id);
      return {
        ...project,
        superObjects: project.superObjects.map((superObject) =>
          superObject.id === model.id
            ? {
                ...superObject,
                variables: superObject.variables.map((variable) =>
                  variable.id === command.variable.id ? { ...command.variable, name } : variable,
                ),
              }
            : superObject,
        ),
      };
    }
    case 'model-variable/remove': {
      const model = findSuperObject(project, command.modelId);
      if (!model.variables.some((variable) => variable.id === command.variableId)) {
        throw new CommandError('UNKNOWN_VARIABLE', `Unknown variable: ${command.variableId}`);
      }
      return {
        ...project,
        superObjects: project.superObjects.map((superObject) =>
          superObject.id === model.id
            ? {
                ...superObject,
                variables: superObject.variables.filter(
                  (variable) => variable.id !== command.variableId,
                ),
              }
            : superObject,
        ),
      };
    }
    case 'model/remove': {
      const index = project.superObjects.findIndex(
        (superObject) => superObject.id === command.modelId,
      );
      if (index < 0) {
        throw new CommandError('UNKNOWN_MODEL', `Unknown model: ${command.modelId}`);
      }
      if (project.superObjects.length === 1) {
        throw new CommandError('LAST_MODEL', 'A project needs at least one model');
      }
      const superObjects = project.superObjects.filter(
        (superObject) => superObject.id !== command.modelId,
      );
      const activeSuperObjectId =
        project.activeSuperObjectId === command.modelId
          ? (superObjects[Math.min(index, superObjects.length - 1)]?.id ?? superObjects[0]!.id)
          : project.activeSuperObjectId;
      return { ...project, superObjects, activeSuperObjectId };
    }
  }
}

function applyOne(project: Project, command: Command): Project {
  if (isModelCommand(command)) {
    return updateActiveModel(project, (model) => applyModelCommand(model, command));
  }
  return applyProjectCommand(project, command);
}

export function applyCommands(project: Project, commands: readonly Command[]): Project {
  let next = project;
  for (const command of commands) {
    next = applyOne(next, command);
  }
  // Deleting an operation and keeping its dependents is the one edit allowed to
  // leave references to a missing feature behind; every later edit compares
  // against the issues the project already carries, so the dependents stay
  // editable until the user points them at new input or deletes them.
  const orphans = commands.some(
    (command) => command.type === 'feature/remove' && command.keepDependents,
  );
  if (!orphans) {
    const before = historyErrors(activeModel(project));
    const after = historyErrors(activeModel(next));
    const known = new Set(before.map(issueKey));
    const introduced = after.filter((issue) => !known.has(issueKey(issue)));
    if (introduced.length > 0) {
      throw new CommandError(
        'INVALID_HISTORY',
        introduced.map((issue) => issue.message).join('; '),
      );
    }
  }
  return touch(next);
}

function issueKey(issue: HistoryIssue): string {
  return `${issue.code}:${issue.featureId ?? ''}:${issue.message}`;
}

export function applyCommand(project: Project, command: Command): Project {
  return applyCommands(project, [command]);
}
