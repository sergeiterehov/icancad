import { createId } from './ids';
import { PROJECT_SCHEMA_VERSION } from './schemas';
import type { Project } from './types';

export const BODY_COLORS = ['#6ea8fe', '#f7a072', '#8bd3a8', '#c9a7f5', '#f5d76e', '#7fd1e0'];

export function createProject(name = 'Untitled project'): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId('project'),
    name,
    units: 'mm',
    features: [],
    bodies: [],
    view: {
      camera: null,
      sectionPlanes: [],
      hiddenBodyIds: [],
    },
    historyEnd: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function featureBodyId(featureId: string, index = 0): string {
  return `${featureId}:solid-${index}`;
}

export function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}
