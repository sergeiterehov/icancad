import { createId } from './ids';
import { PROJECT_SCHEMA_VERSION } from './schemas';
import type { BodyRef, ObjectMetadata, Project } from './types';

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
    metadata: {},
    view: {
      camera: null,
      sectionPlanes: [],
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

export interface BodyObject extends BodyRef {
  name: string;
  color: string;
  visible: boolean;
}

export function sketchObjectId(featureId: string): string {
  return `sketch:${featureId}`;
}

export function objectMetadata(project: Project, objectId: string): ObjectMetadata {
  return project.metadata[objectId] ?? {};
}

export function objectName(project: Project, objectId: string, fallback: string): string {
  return objectMetadata(project, objectId).name ?? fallback;
}

export function objectVisible(project: Project, objectId: string): boolean {
  return objectMetadata(project, objectId).visible ?? true;
}

export function objectColor(project: Project, objectId: string, fallback: string): string {
  return objectMetadata(project, objectId).color ?? fallback;
}

export function resolveBody(project: Project, body: BodyRef): BodyObject {
  return {
    ...body,
    name: objectName(project, body.id, 'Body'),
    color: objectColor(project, body.id, BODY_COLORS[0] ?? '#6ea8fe'),
    visible: objectVisible(project, body.id),
  };
}
