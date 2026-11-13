import { createId } from './ids';
import { PROJECT_SCHEMA_VERSION } from './schemas';
import type { BodyRef, ObjectMetadata, Project, RevolveSpec } from './types';

/**
 * Colours of objects, also offered as the colour palette. Mid tones only, so a
 * body stays readable on the dark and the light theme. The order is the order
 * of the palette: the default blue first, then greens, yellows, reds, violets
 * and finally the neutral greys.
 */
export const BODY_COLORS = [
  '#6ea8fe',
  '#7fd1e0',
  '#4f6ddb',
  '#2fa8a0',
  '#4caf7d',
  '#8bd3a8',
  '#cddc39',
  '#f5d76e',
  '#f0b429',
  '#e05555',
  '#c0392b',
  '#e8703a',
  '#f7a072',
  '#7c6cf0',
  '#a889f5',
  '#c9a7f5',
  '#e29ad6',
  '#a5764f',
  '#c8a27a',
  '#607d8b',
  '#6d7a8d',
  '#90a4ae',
  '#b0bec5',
  '#9e9e9e',
];

/** Sketches are blue until the user picks another colour. */
export const SKETCH_COLOR = BODY_COLORS[0] ?? '#6ea8fe';

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

/** A revolve starts as a full turn around the world Z axis. */
export function defaultRevolve(): RevolveSpec {
  return { axis: { kind: 'world', axis: 'z' }, start: 0, end: 360, inverted: false };
}

// An extrude turns every region it uses into its own body, so the body id is
// derived from the region id: stable while the region itself is unchanged.
export function extrudeBodyId(featureId: string, regionId: string): string {
  return `${featureId}:region-${regionId}`;
}

export function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

export interface BodyObject extends BodyRef {
  kind: 'solid' | 'mesh';
  name: string;
  color: string;
  visible: boolean;
}

export function isMeshObject(body: BodyRef): boolean {
  return body.kind === 'mesh';
}

export function isSolidBody(body: BodyRef): boolean {
  return !isMeshObject(body);
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

/** Construction geometry is a helper, so it only shows when asked for. */
export function objectShowConstruction(project: Project, objectId: string): boolean {
  return objectMetadata(project, objectId).showConstruction ?? false;
}

export function resolveBody(project: Project, body: BodyRef): BodyObject {
  return {
    ...body,
    kind: body.kind ?? 'solid',
    name: objectName(project, body.id, isMeshObject(body) ? 'Mesh' : 'Body'),
    color: objectColor(project, body.id, BODY_COLORS[0] ?? '#6ea8fe'),
    visible: objectVisible(project, body.id),
  };
}
