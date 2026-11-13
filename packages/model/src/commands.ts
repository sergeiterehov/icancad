import { historyErrors, type HistoryIssue } from './history';
import { touch } from './project';
import { HISTORY_START, type BodyRef, type Feature, type ObjectMetadata, type Project } from './types';

export type Command =
  | { type: 'project/rename'; name: string }
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

export type CommandErrorCode =
  | 'UNKNOWN_FEATURE'
  | 'UNKNOWN_BODY'
  | 'DUPLICATE_ID'
  | 'INVALID_INDEX'
  | 'INVALID_VALUE'
  | 'INVALID_HISTORY';

export class CommandError extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

function replaceFeature(
  project: Project,
  featureId: string,
  update: (feature: Feature) => Feature,
): Project {
  let found = false;
  const features = project.features.map((feature) => {
    if (feature.id !== featureId) return feature;
    found = true;
    return update(feature);
  });
  if (!found) {
    throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${featureId}`);
  }
  return { ...project, features };
}

function applyOne(project: Project, command: Command): Project {
  switch (command.type) {
    case 'project/rename': {
      const name = command.name.trim();
      if (!name) throw new CommandError('INVALID_VALUE', 'Project name cannot be empty');
      return { ...project, name };
    }
    case 'feature/add': {
      if (project.features.some((feature) => feature.id === command.feature.id)) {
        throw new CommandError('DUPLICATE_ID', `Duplicate feature id: ${command.feature.id}`);
      }
      const features = [...project.features];
      const index = command.index ?? features.length;
      if (index < 0 || index > features.length) {
        throw new CommandError('INVALID_INDEX', `Invalid feature index: ${index}`);
      }
      features.splice(index, 0, command.feature);
      return { ...project, features };
    }
    case 'feature/replace': {
      return replaceFeature(project, command.feature.id, () => command.feature);
    }
    case 'feature/remove': {
      const index = project.features.findIndex(
        (candidate) => candidate.id === command.featureId,
      );
      if (index < 0) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      // The cursor names a position between operations, so removing the
      // operation it follows moves it onto the previous one: the numbered
      // position stays where the user left it instead of jumping to the end.
      const historyEnd =
        project.historyEnd === command.featureId
          ? index > 0
            ? (project.features[index - 1]?.id ?? HISTORY_START)
            : HISTORY_START
          : project.historyEnd;
      return {
        ...project,
        features: project.features.filter((candidate) => candidate.id !== command.featureId),
        bodies: project.bodies.filter((body) => body.createdBy !== command.featureId),
        historyEnd,
      };
    }
    case 'feature/reorder': {
      const index = project.features.findIndex((feature) => feature.id === command.featureId);
      if (index < 0) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      if (command.toIndex < 0 || command.toIndex >= project.features.length) {
        throw new CommandError('INVALID_INDEX', `Invalid feature index: ${command.toIndex}`);
      }
      const features = [...project.features];
      const [feature] = features.splice(index, 1);
      if (!feature) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      features.splice(command.toIndex, 0, feature);
      return { ...project, features };
    }
    case 'feature/toggle-suppressed': {
      return replaceFeature(project, command.featureId, (feature) => ({
        ...feature,
        suppressed: !feature.suppressed,
      }));
    }
    case 'body/add': {
      if (project.bodies.some((body) => body.id === command.body.id)) {
        throw new CommandError('DUPLICATE_ID', `Duplicate body id: ${command.body.id}`);
      }
      return { ...project, bodies: [...project.bodies, command.body] };
    }
    case 'metadata/patch': {
      const current = project.metadata[command.objectId] ?? {};
      return {
        ...project,
        metadata: { ...project.metadata, [command.objectId]: { ...current, ...command.patch } },
      };
    }
    case 'body/remove': {
      if (!project.bodies.some((body) => body.id === command.bodyId)) {
        throw new CommandError('UNKNOWN_BODY', `Unknown body: ${command.bodyId}`);
      }
      return { ...project, bodies: project.bodies.filter((body) => body.id !== command.bodyId) };
    }
    case 'history/set-end': {
      if (
        command.featureId !== null &&
        command.featureId !== HISTORY_START &&
        !project.features.some((feature) => feature.id === command.featureId)
      ) {
        throw new CommandError('UNKNOWN_FEATURE', `Unknown feature: ${command.featureId}`);
      }
      return { ...project, historyEnd: command.featureId };
    }
  }
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
    const known = new Set(historyErrors(project).map(issueKey));
    const introduced = historyErrors(next).filter((issue) => !known.has(issueKey(issue)));
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
