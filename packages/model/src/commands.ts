import { historyErrors, type HistoryIssue } from './history';
import { activeModel, touch, updateActiveModel } from './project';
import {
  HISTORY_START,
  type BodyRef,
  type Feature,
  type Model,
  type ObjectMetadata,
  type Project,
  type SuperObject,
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
  | { type: 'model/remove'; modelId: string };

export type Command = ModelCommand | ProjectCommand;

export type CommandErrorCode =
  | 'UNKNOWN_FEATURE'
  | 'UNKNOWN_BODY'
  | 'UNKNOWN_MODEL'
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
      return {
        ...model,
        features: model.features.filter((candidate) => candidate.id !== command.featureId),
        bodies: model.bodies.filter((body) => body.createdBy !== command.featureId),
        historyEnd,
      };
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
