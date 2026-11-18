import { createId } from './ids';
import { PROJECT_SCHEMA_VERSION } from './schemas';
import type {
  BodyRef,
  Model,
  ObjectMetadata,
  Project,
  Resolved,
  RevolveSpec,
  SuperObject,
} from './types';

/**
 * Colours of objects, also offered as the colour palette. Mid tones only, so a
 * body stays readable on the dark and the light theme. The order is the order
 * of the palette, and so the order bodies take colours in: the first bodies of a
 * project are quiet ones — a grey and four muted tints, each on a hue of its own
 * so a pair of them still reads apart — and the saturated hues of every family
 * follow, so a model only gets loud once it has many bodies.
 */
export const BODY_COLORS = [
  // Quiet tints: a neutral grey and four hues calmed down to a tint.
  '#9aa1a9',
  '#7a8fae',
  '#a3b593',
  '#ad8f79',
  '#a190ad',
  // Full-strength hues, family by family.
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
];

/**
 * Sketches are blue until the user picks another colour. The first palette
 * colour is a quiet grey now, and a sketch row has to read as a sketch rather
 * than as another body, so the blue is named here instead.
 */
export const SKETCH_COLOR = '#6ea8fe';

export function createModel(name = 'Model'): Model {
  return {
    type: 'model',
    id: createId('model'),
    name,
    features: [],
    bodies: [],
    metadata: {},
    view: {
      sectionPlanes: [],
    },
    historyEnd: null,
    variables: [],
    groups: [],
  };
}

export function createProject(name = 'Untitled project', modelName = 'Model'): Project {
  const now = new Date().toISOString();
  const model = createModel(modelName);
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId('project'),
    name,
    units: 'mm',
    superObjects: [model],
    activeSuperObjectId: model.id,
    variables: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function isModel(superObject: SuperObject): superObject is Model {
  return superObject.type === 'model';
}

/** The super-object the user is editing. A project always has at least one. */
export function activeModel(project: Project): Model {
  const active = project.superObjects.find(
    (superObject) => superObject.id === project.activeSuperObjectId,
  );
  const model = active ?? project.superObjects[0];
  if (!model) throw new Error('Project has no super-objects');
  return model;
}

export function updateActiveModel(project: Project, update: (model: Model) => Model): Project {
  const current = activeModel(project);
  const next = update(current);
  if (next === current) return project;
  return {
    ...project,
    superObjects: project.superObjects.map((superObject) =>
      superObject.id === current.id ? next : superObject,
    ),
  };
}

/** New models get the next free number in the project, "Model 2", "Model 3", … */
export function nextModelName(project: Project, base: string): string {
  const names = new Set(project.superObjects.map((superObject) => superObject.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

export function featureBodyId(featureId: string, index = 0): string {
  return `${featureId}:solid-${index}`;
}

/** A revolve starts as a full turn around the world Z axis. */
export function defaultRevolve(): Resolved<RevolveSpec> {
  return { axis: { kind: 'world', axis: 'z' }, start: 0, end: 360, inverted: false };
}

// An extrude turns every region it uses into its own body, so the body id is
// derived from the region id: stable while the region itself is unchanged.
export function extrudeBodyId(featureId: string, regionId: string): string {
  return `${featureId}:region-${regionId}`;
}

/** A shell keeps one new body per input body, named after that body. */
export function shellBodyId(featureId: string, sourceBodyId: string): string {
  return `${featureId}:shell-${sourceBodyId}`;
}

/**
 * An array copy is named after its seed and the position combination it sits
 * at, so changing a later direction keeps the copies of the earlier ones.
 */
export function arrayBodyId(featureId: string, sourceBodyId: string, key: string): string {
  return `${featureId}:array-${sourceBodyId}-${key}`;
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

export function objectMetadata(model: Model, objectId: string): ObjectMetadata {
  return model.metadata[objectId] ?? {};
}

export function objectName(model: Model, objectId: string, fallback: string): string {
  return objectMetadata(model, objectId).name ?? fallback;
}

export function objectVisible(model: Model, objectId: string): boolean {
  return objectMetadata(model, objectId).visible ?? true;
}

export function objectColor(model: Model, objectId: string, fallback: string): string {
  return objectMetadata(model, objectId).color ?? fallback;
}

/** Construction geometry is a helper, so it only shows when asked for. */
export function objectShowConstruction(model: Model, objectId: string): boolean {
  return objectMetadata(model, objectId).showConstruction ?? false;
}

export function resolveBody(model: Model, body: BodyRef): BodyObject {
  return {
    ...body,
    kind: body.kind ?? 'solid',
    name: objectName(model, body.id, isMeshObject(body) ? 'Mesh' : 'Body'),
    color: objectColor(model, body.id, BODY_COLORS[0] ?? '#6ea8fe'),
    visible: objectVisible(model, body.id),
  };
}
