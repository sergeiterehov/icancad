import { z } from 'zod';
import type { Project } from './types';

export const PROJECT_SCHEMA_VERSION = 2;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

const transform = z.object({
  translation: vec3,
  rotation: vec3,
  scale: z.number(),
});

const featureBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  suppressed: z.boolean().default(false),
};

const primitiveFeature = z.object({
  ...featureBase,
  type: z.literal('primitive'),
  kind: z.literal('box'),
  params: z.object({
    dx: z.number().positive(),
    dy: z.number().positive(),
    dz: z.number().positive(),
  }),
  transform,
});

const importMeshFeature = z.object({
  ...featureBase,
  type: z.literal('import-mesh'),
  assetId: z.string().min(1),
  format: z.enum(['stl', 'obj', 'ply', 'glb']).default('stl'),
  transform,
  scale: z.number().positive(),
});

const convertToSolidFeature = z.object({
  ...featureBase,
  type: z.literal('convert-to-solid'),
  sourceBodyId: z.string().min(1),
  mode: z.enum(['auto', 'heal', 'voxel']),
  voxelSize: z.number().positive().optional(),
  targetTriangles: z.number().int().positive().optional(),
  tolerance: z.number().positive().optional(),
});

const entityRef = z.object({
  bodyId: z.string().min(1),
  topoId: z.string().min(1),
  fingerprint: z
    .object({
      surfaceType: z.string(),
      measure: z.number(),
      centroid: vec3,
      normal: vec3,
    })
    .optional(),
});

const sketchEntity = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('point'),
    construction: z.boolean(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('line'),
    construction: z.boolean(),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('arc'),
    construction: z.boolean(),
    cx: z.number(),
    cy: z.number(),
    r: z.number().positive(),
    startAngle: z.number(),
    endAngle: z.number(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('circle'),
    construction: z.boolean(),
    cx: z.number(),
    cy: z.number(),
    r: z.number().positive(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('ellipse'),
    construction: z.boolean(),
    cx: z.number(),
    cy: z.number(),
    rx: z.number().positive(),
    ry: z.number().positive(),
    rotation: z.number(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('bezier'),
    construction: z.boolean(),
    points: z.array(z.tuple([z.number(), z.number()])).min(2),
  }),
]);

const constraintType = z.enum([
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'tangent',
  'equal',
  'distance',
  'horizontal-distance',
  'vertical-distance',
  'angle',
  'radius',
  'diameter',
  'concentric',
  'symmetric',
  'midpoint',
  'point-on-line',
  'point-on-circle',
  'point-on-ellipse',
  'fix',
]);

const sketchConstraint = z.object({
  id: z.string().min(1),
  type: constraintType,
  refs: z
    .array(
      z.object({
        entityId: z.string().min(1),
        pointIndex: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
  value: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const sketchPlaneRef = z.union([
  z.object({
    type: z.literal('datum'),
    plane: z.enum(['XY', 'XZ', 'YZ']),
    offset: z.number(),
  }),
  z.object({
    type: z.literal('face'),
    bodyId: z.string().min(1),
    topoId: z.string().min(1),
    frame: z
      .object({
        origin: vec3,
        xAxis: vec3,
        yAxis: vec3,
        normal: vec3,
      })
      .optional(),
  }),
]);

const sketchReference = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  measure: z.enum(['length', 'angle', 'radius', 'diameter', 'x', 'y', 'rx', 'ry']),
});

const sketchFeature = z.object({
  ...featureBase,
  type: z.literal('sketch'),
  plane: sketchPlaneRef,
  entities: z.array(sketchEntity),
  constraints: z.array(sketchConstraint),
  references: z.array(sketchReference).default([]),
});

const bodyFaceRef = z.object({
  bodyId: z.string().min(1),
  faceId: z.string().min(1),
  normal: vec3,
  origin: vec3,
});

const extrudeFeature = z.object({
  ...featureBase,
  type: z.literal('extrude'),
  sketchId: z.string().min(1).optional(),
  regions: z.array(z.string()),
  faceRefs: z.array(bodyFaceRef).default([]),
  objectOrder: z.array(z.string()).default([]),
  end: z.enum(['blind', 'symmetric', 'through-all']),
  distance: z.number(),
  reversed: z.boolean().default(false),
  secondDirection: z
    .object({ end: z.enum(['blind', 'through-all']), distance: z.number() })
    .optional(),
  op: z.enum(['new', 'add', 'subtract', 'intersect']),
  scope: z.enum(['all', 'selected']),
  bodyIds: z.array(z.string()),
  joinRegions: z.boolean(),
});

const shellFeature = z.object({
  ...featureBase,
  type: z.literal('shell'),
  bodyId: z.string().min(1),
  removeFaces: z.array(entityRef),
  thickness: z.number().positive(),
  direction: z.enum(['inward', 'outward']),
});

const holeSpec = z.object({
  kind: z.enum(['simple', 'counterbore', 'countersink']),
  diameter: z.number().positive(),
  depth: z.number().positive().optional(),
  throughAll: z.boolean(),
  clearance: z.string().optional(),
  headDiameter: z.number().positive().optional(),
  headDepth: z.number().positive().optional(),
  angle: z.number().positive().optional(),
});

const holeFeature = z.object({
  ...featureBase,
  type: z.literal('hole'),
  bodyId: z.string().min(1),
  faceRef: entityRef,
  positions: z.array(z.object({ x: z.number(), y: z.number() })),
  spec: holeSpec,
});

const ribFeature = z.object({
  ...featureBase,
  type: z.literal('rib'),
  bodyId: z.string().min(1),
  sketchId: z.string().min(1),
  thickness: z.number().positive(),
  direction: vec3,
});

const filletFeature = z.object({
  ...featureBase,
  type: z.literal('fillet'),
  bodyId: z.string().min(1),
  edges: z.array(entityRef),
  radius: z.number().positive(),
});

const chamferFeature = z.object({
  ...featureBase,
  type: z.literal('chamfer'),
  bodyId: z.string().min(1),
  edges: z.array(entityRef),
  distance: z.number().positive(),
});

const booleanFeature = z.object({
  ...featureBase,
  type: z.literal('boolean'),
  op: z.enum(['union', 'subtract', 'intersect']),
  bodyIds: z.array(z.string().min(1)).min(2),
});

const deleteBodyFeature = z.object({
  ...featureBase,
  type: z.literal('delete-body'),
  bodyId: z.string().min(1),
});

const transformFeature = z.object({
  ...featureBase,
  type: z.literal('transform'),
  bodyId: z.string().min(1),
  transform,
});

export const featureSchema = z.discriminatedUnion('type', [
  primitiveFeature,
  importMeshFeature,
  convertToSolidFeature,
  sketchFeature,
  extrudeFeature,
  shellFeature,
  holeFeature,
  ribFeature,
  filletFeature,
  chamferFeature,
  booleanFeature,
  deleteBodyFeature,
  transformFeature,
]);

const bodyRef = z.object({
  id: z.string().min(1),
  createdBy: z.string().min(1),
  kind: z.enum(['solid', 'mesh']).optional(),
});

const objectMetadata = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  visible: z.boolean().optional(),
  bodyIndex: z.number().int().optional(),
});

const sectionPlane = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  origin: vec3,
  normal: vec3,
  offset: z.number(),
  visible: z.boolean(),
});

const viewState = z.object({
  camera: z
    .object({
      target: vec3,
      distance: z.number().positive(),
      azimuth: z.number(),
      polar: z.number(),
    })
    .nullable(),
  sectionPlanes: z.array(sectionPlane),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  units: z.literal('mm'),
  features: z.array(featureSchema),
  bodies: z.array(bodyRef),
  metadata: z.record(z.string(), objectMetadata),
  view: viewState,
  historyEnd: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProjectFileErrorCode = 'INVALID_PROJECT' | 'UNSUPPORTED_SCHEMA_VERSION';

export class ProjectFileError extends Error {
  readonly code: ProjectFileErrorCode;

  constructor(code: ProjectFileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectFileError';
    this.code = code;
  }
}

export function parseProject(input: unknown): Project {
  const envelope = z.object({ schemaVersion: z.number() }).passthrough().safeParse(input);
  if (!envelope.success) {
    throw new ProjectFileError('INVALID_PROJECT', 'Project file has no schemaVersion', {
      cause: envelope.error,
    });
  }
  if (envelope.data.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectFileError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported project schema version: ${envelope.data.schemaVersion}`,
    );
  }
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProjectFileError('INVALID_PROJECT', 'Project file is invalid', {
      cause: parsed.error,
    });
  }
  // Projects written before mesh objects had their own kind stored imported
  // meshes as bodies without a `kind`. Recognise them from their operation so
  // they never become solid-body targets after loading.
  const project = parsed.data as Project;
  const importedFeatureIds = new Set(
    project.features
      .filter((feature) => feature.type === 'import-mesh')
      .map((feature) => feature.id),
  );
  return {
    ...project,
    bodies: project.bodies.map((body) => ({
      ...body,
      kind: importedFeatureIds.has(body.createdBy) ? 'mesh' : (body.kind ?? 'solid'),
    })),
  };
}
