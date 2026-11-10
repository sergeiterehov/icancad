import { resolveBody, type BodyObject } from './project';
import { HISTORY_START, type Feature, type Project } from './types';

export type HistoryIssueCode =
  | 'DUPLICATE_FEATURE_ID'
  | 'MISSING_DEPENDENCY'
  | 'DEPENDENCY_AFTER_USE'
  | 'UNKNOWN_BODY'
  | 'ORPHAN_BODY'
  | 'SUPPRESSED_DEPENDENCY'
  | 'MISSING_HISTORY_END';

export interface HistoryIssue {
  code: HistoryIssueCode;
  severity: 'error' | 'warning';
  message: string;
  featureId?: string;
}

export function activeFeatureIds(project: Project): Set<string> {
  if (project.historyEnd === null) {
    return new Set(project.features.map((feature) => feature.id));
  }
  if (project.historyEnd === HISTORY_START) return new Set();
  const end = project.features.findIndex((feature) => feature.id === project.historyEnd);
  if (end < 0) return new Set();
  return new Set(project.features.slice(0, end + 1).map((feature) => feature.id));
}

export function isFeatureInHistory(project: Project, featureId: string): boolean {
  return activeFeatureIds(project).has(featureId);
}

// New operations are inserted at the timeline cursor, not at the end of the list.
export function historyInsertIndex(project: Project): number {
  if (project.historyEnd === null) return project.features.length;
  if (project.historyEnd === HISTORY_START) return 0;
  const index = project.features.findIndex((feature) => feature.id === project.historyEnd);
  return index < 0 ? project.features.length : index + 1;
}

export function bodiesInHistory(project: Project): BodyObject[] {
  const active = activeFeatureIds(project);
  return project.bodies
    .filter((body) => active.has(body.createdBy) && !isBodyDeleted(project, body.id, active))
    .map((body) => resolveBody(project, body));
}

/** Only B-rep bodies; imported meshes are separate objects and not valid targets. */
export function solidBodiesInHistory(project: Project): BodyObject[] {
  return bodiesInHistory(project).filter((body) => body.kind === 'solid');
}

function isBodyDeleted(project: Project, bodyId: string, active: Set<string>): boolean {
  return project.features.some(
    (feature) =>
      active.has(feature.id) && feature.type === 'delete-body' && feature.bodyId === bodyId,
  );
}

/** Features that would break if the given feature disappeared, transitively. */
export function dependentFeatures(
  project: Project,
  featureId: string,
): { id: string; name: string }[] {
  const removed = new Set([featureId]);
  const found: { id: string; name: string }[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of project.features) {
      if (removed.has(feature.id)) continue;
      if (getFeatureDependencies(feature, project).some((id) => removed.has(id))) {
        removed.add(feature.id);
        found.push({ id: feature.id, name: feature.name });
        changed = true;
      }
    }
  }
  return found;
}

function referencedBodyIds(feature: Feature): string[] {
  switch (feature.type) {
    case 'primitive':
    case 'import-mesh':
      return [];
    case 'convert-to-solid':
      return [feature.sourceBodyId];
    case 'sketch':
      return feature.plane.type === 'face' ? [feature.plane.bodyId] : [];
    case 'extrude':
      return [...feature.bodyIds, ...(feature.faceRefs ?? []).map((ref) => ref.bodyId)];
    case 'shell':
    case 'hole':
    case 'fillet':
    case 'chamfer':
    case 'transform':
      return [feature.bodyId];
    case 'rib':
      return [feature.bodyId];
    case 'boolean':
      return feature.bodyIds;
    case 'delete-body':
      return [feature.bodyId];
  }
}

export function getFeatureDependencies(feature: Feature, project: Project): string[] {
  const dependencies = new Set<string>();
  if (feature.type === 'extrude' && feature.sketchId) {
    dependencies.add(feature.sketchId);
  }
  if (feature.type === 'rib') {
    dependencies.add(feature.sketchId);
  }
  if (feature.type === 'delete-body') {
    const body = project.bodies.find((candidate) => candidate.id === feature.bodyId);
    if (body) dependencies.add(body.createdBy);
  }
  for (const bodyId of referencedBodyIds(feature)) {
    const body = project.bodies.find((candidate) => candidate.id === bodyId);
    if (body) dependencies.add(body.createdBy);
  }
  return [...dependencies];
}

export function validateHistory(project: Project): HistoryIssue[] {
  const issues: HistoryIssue[] = [];
  const featureIndices = new Map<string, number>();

  project.features.forEach((feature, index) => {
    if (featureIndices.has(feature.id)) {
      issues.push({
        code: 'DUPLICATE_FEATURE_ID',
        severity: 'error',
        message: `Duplicate feature id: ${feature.id}`,
        featureId: feature.id,
      });
    } else {
      featureIndices.set(feature.id, index);
    }
  });

  if (
    project.historyEnd !== null &&
    project.historyEnd !== HISTORY_START &&
    !featureIndices.has(project.historyEnd)
  ) {
    issues.push({
      code: 'MISSING_HISTORY_END',
      severity: 'error',
      message: `History end references unknown feature: ${project.historyEnd}`,
      featureId: project.historyEnd,
    });
  }

  for (const body of project.bodies) {
    if (!featureIndices.has(body.createdBy)) {
      issues.push({
        code: 'ORPHAN_BODY',
        severity: 'error',
        message: `Body ${body.id} references unknown creator ${body.createdBy}`,
      });
    }
  }

  for (const feature of project.features) {
    const index = featureIndices.get(feature.id) ?? -1;

    if (feature.type === 'extrude' && feature.sketchId && !featureIndices.has(feature.sketchId)) {
      issues.push({
        code: 'MISSING_DEPENDENCY',
        severity: 'error',
        message: `Extrude ${feature.id} references unknown sketch ${feature.sketchId}`,
        featureId: feature.id,
      });
    }
    if (feature.type === 'rib' && !featureIndices.has(feature.sketchId)) {
      issues.push({
        code: 'MISSING_DEPENDENCY',
        severity: 'error',
        message: `Rib ${feature.id} references unknown sketch ${feature.sketchId}`,
        featureId: feature.id,
      });
    }

    for (const bodyId of referencedBodyIds(feature)) {
      if (!project.bodies.some((body) => body.id === bodyId)) {
        issues.push({
          code: 'UNKNOWN_BODY',
          severity: 'error',
          message: `Feature ${feature.id} references unknown body ${bodyId}`,
          featureId: feature.id,
        });
      }
    }

    for (const dependency of getFeatureDependencies(feature, project)) {
      const dependencyIndex = featureIndices.get(dependency);
      if (dependencyIndex === undefined) {
        issues.push({
          code: 'MISSING_DEPENDENCY',
          severity: 'error',
          message: `Feature ${feature.id} references unknown feature ${dependency}`,
          featureId: feature.id,
        });
        continue;
      }
      if (dependencyIndex > index) {
        issues.push({
          code: 'DEPENDENCY_AFTER_USE',
          severity: 'error',
          message: `Feature ${feature.id} depends on later feature ${dependency}`,
          featureId: feature.id,
        });
      }
      const dependencyFeature = project.features[dependencyIndex];
      if (dependencyFeature?.suppressed) {
        issues.push({
          code: 'SUPPRESSED_DEPENDENCY',
          severity: 'warning',
          message: `Feature ${feature.id} depends on suppressed feature ${dependency}`,
          featureId: feature.id,
        });
      }
    }
  }

  return issues;
}

export function historyErrors(project: Project): HistoryIssue[] {
  return validateHistory(project).filter((issue) => issue.severity === 'error');
}
