import { z } from 'zod';
import { createId } from './ids';
import type { Project } from './types';

export const PROJECT_SCHEMA_VERSION = 3;

/** Projects written before super-objects kept the model at the top level. */
const LEGACY_SCHEMA_VERSION = 2;

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

const primitiveBase = {
  ...featureBase,
  type: z.literal('primitive'),
  transform,
};

const primitiveFeature = z
  .discriminatedUnion('kind', [
    z.object({
      ...primitiveBase,
      kind: z.literal('box'),
      params: z.object({
        dx: z.number().positive(),
        dy: z.number().positive(),
        dz: z.number().positive(),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('sphere'),
      params: z.object({ radius: z.number().positive() }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('cylinder'),
      params: z.object({ radius: z.number().positive(), height: z.number().positive() }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('cone'),
      params: z.object({
        bottomRadius: z.number().positive(),
        topRadius: z.number().nonnegative(),
        height: z.number().positive(),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('torus'),
      params: z.object({
        majorRadius: z.number().positive(),
        tubeRadius: z.number().positive(),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('pyramid'),
      params: z.object({
        sides: z.number().int().min(3).max(120),
        radius: z.number().positive(),
        height: z.number().positive(),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('capsule'),
      params: z.object({
        radius: z.number().positive(),
        height: z.number().positive(),
      }),
    }),
  ])
  .superRefine((value, context) => {
    if (value.kind === 'torus' && value.params.tubeRadius >= value.params.majorRadius) {
      context.addIssue({
        code: 'custom',
        path: ['params', 'tubeRadius'],
        message: 'The tube radius must be smaller than the major radius',
      });
    }
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
  'symmetric',
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
    inverted: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('face'),
    bodyId: z.string().min(1).optional(),
    topoId: z.string().min(1).optional(),
    offset: z.number().optional(),
    frame: z
      .object({
        origin: vec3,
        xAxis: vec3,
        yAxis: vec3,
        normal: vec3,
      })
      .optional(),
    inverted: z.boolean().optional(),
  }),
]);

const sketchReference = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  measure: z.enum(['length', 'angle', 'radius', 'diameter', 'x', 'y', 'rx', 'ry']),
});

const sketchProjection = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  source: z.object({
    kind: z.enum(['vertex', 'edge', 'silhouette']),
    bodyId: z.string().min(1),
    elementId: z.string().min(1),
  }),
  faceId: z.string().min(1).optional(),
});

const sketchFeature = z.object({
  ...featureBase,
  type: z.literal('sketch'),
  plane: sketchPlaneRef,
  entities: z.array(sketchEntity),
  constraints: z.array(sketchConstraint),
  references: z.array(sketchReference).default([]),
  projections: z.array(sketchProjection).default([]),
});

const bodyFaceRef = z.object({
  bodyId: z.string().min(1),
  faceId: z.string().min(1),
  normal: vec3,
  origin: vec3,
});

const revolveAxis = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('world'), axis: z.enum(['x', 'y', 'z']) }),
  z.object({
    kind: z.literal('body-edge'),
    bodyId: z.string().min(1),
    edgeId: z.string().min(1),
    start: vec3,
    end: vec3,
  }),
  z.object({
    kind: z.literal('sketch-edge'),
    sketchId: z.string().min(1),
    entityId: z.string().min(1),
  }),
]);

const revolveSpec = z.object({
  axis: revolveAxis,
  start: z.number(),
  end: z.number(),
  inverted: z.boolean().default(false),
});

const extrudeFeature = z.object({
  ...featureBase,
  type: z.literal('extrude'),
  sketchId: z.string().min(1).optional(),
  regions: z.array(z.string()),
  faceRefs: z.array(bodyFaceRef).default([]),
  objectOrder: z.array(z.string()).default([]),
  method: z.enum(['extrude', 'revolve']).default('extrude'),
  revolve: revolveSpec.optional(),
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
  bodyIds: z.array(z.string().min(1)).default([]),
  removeFaces: z.array(bodyFaceRef).default([]),
  thickness: z.number().positive(),
  offset: z.number().nonnegative().default(0),
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

const edgeTreatmentFeature = z.object({
  ...featureBase,
  type: z.literal('edge-treatment'),
  kind: z.enum(['fillet', 'chamfer']),
  faceRefs: z.array(
    z.object({
      bodyId: z.string().min(1),
      faceId: z.string().min(1),
      normal: vec3,
      origin: vec3,
      handle: z.object({ origin: vec3, direction: vec3, wedge: z.number().positive() }).optional(),
    }),
  ),
  edgeRefs: z.array(
    z.object({
      bodyId: z.string().min(1),
      edgeId: z.string().min(1),
      faceIds: z.array(z.number().int().nonnegative()),
      start: vec3,
      mid: vec3,
      end: vec3,
      bisector: vec3,
      wedge: z.number().positive().optional(),
      convex: z.boolean().optional(),
    }),
  ),
  size: z.number().positive(),
});

const arrayPath = z.object({
  kind: z.literal('sketch-edge'),
  sketchId: z.string().min(1),
  entityId: z.string().min(1),
});

const arrayDirection = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('linear'),
    direction: vec3,
    spacing: z.number(),
    count: z.number().int().min(1).max(100),
  }),
  z.object({
    kind: z.literal('rotation'),
    axis: revolveAxis,
    angle: z.number(),
    count: z.number().int().min(1).max(100),
  }),
  z.object({
    kind: z.literal('path'),
    path: arrayPath.nullable(),
    count: z.number().int().min(1).max(100),
  }),
]);

const arrayFeature = z.object({
  ...featureBase,
  type: z.literal('array'),
  target: z.enum(['bodies', 'operations']),
  bodyIds: z.array(z.string().min(1)).default([]),
  featureIds: z.array(z.string().min(1)).default([]),
  directions: z.array(arrayDirection).default([]),
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

// Primitives share `type` and differ by `kind`, so they form their own
// discriminated union; the rest keep the faster discriminator on `type`.
export const featureSchema = z.union([
  primitiveFeature,
  z.discriminatedUnion('type', [
    importMeshFeature,
    convertToSolidFeature,
    sketchFeature,
    extrudeFeature,
    shellFeature,
    holeFeature,
    ribFeature,
    edgeTreatmentFeature,
    arrayFeature,
    booleanFeature,
    deleteBodyFeature,
    transformFeature,
  ]),
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
  showConstruction: z.boolean().optional(),
});

const sectionPlane = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  origin: vec3,
  normal: vec3,
  offset: z.number(),
  visible: z.boolean(),
  face: z.object({ bodyId: z.string().min(1), topoId: z.string().min(1) }).nullish(),
  inverted: z.boolean().optional(),
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

const modelSchema = z.object({
  type: z.literal('model'),
  id: z.string().min(1),
  name: z.string().min(1),
  features: z.array(featureSchema),
  bodies: z.array(bodyRef),
  metadata: z.record(z.string(), objectMetadata),
  view: viewState,
  historyEnd: z.string().nullable(),
});

// A union so assembly can join without another schema version bump.
const superObjectSchema = z.discriminatedUnion('type', [modelSchema]);

export const projectSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    units: z.literal('mm'),
    superObjects: z.array(superObjectSchema).min(1),
    activeSuperObjectId: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine(
    (project) =>
      project.superObjects.some((superObject) => superObject.id === project.activeSuperObjectId),
    { message: 'The active super-object is missing', path: ['activeSuperObjectId'] },
  );

const legacyProjectSchema = z.object({
  schemaVersion: z.literal(LEGACY_SCHEMA_VERSION),
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

function migrateLegacyProject(
  legacy: z.infer<typeof legacyProjectSchema>,
  modelName: string,
): unknown {
  const model = {
    type: 'model',
    id: createId('model'),
    name: modelName,
    features: legacy.features,
    bodies: legacy.bodies,
    metadata: legacy.metadata,
    view: legacy.view,
    historyEnd: legacy.historyEnd,
  };
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: legacy.id,
    name: legacy.name,
    units: legacy.units,
    superObjects: [model],
    activeSuperObjectId: model.id,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
}

export interface ParseProjectOptions {
  /** Name of the model a version 2 document is migrated into. */
  modelName?: string;
}

export type ProjectFileErrorCode = 'INVALID_PROJECT' | 'UNSUPPORTED_SCHEMA_VERSION';

export class ProjectFileError extends Error {
  readonly code: ProjectFileErrorCode;

  constructor(code: ProjectFileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectFileError';
    this.code = code;
  }
}

export function parseProject(input: unknown, options: ParseProjectOptions = {}): Project {
  const envelope = z.object({ schemaVersion: z.number() }).passthrough().safeParse(input);
  if (!envelope.success) {
    throw new ProjectFileError('INVALID_PROJECT', 'Project file has no schemaVersion', {
      cause: envelope.error,
    });
  }
  const version = envelope.data.schemaVersion;
  let candidate = input;
  if (version === LEGACY_SCHEMA_VERSION) {
    const legacy = legacyProjectSchema.safeParse(input);
    if (!legacy.success) {
      throw new ProjectFileError('INVALID_PROJECT', 'Project file is invalid', {
        cause: legacy.error,
      });
    }
    candidate = migrateLegacyProject(legacy.data, options.modelName ?? 'Model');
  } else if (version !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectFileError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported project schema version: ${version}`,
    );
  }
  const parsed = projectSchema.safeParse(candidate);
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
    project.superObjects.flatMap((superObject) =>
      superObject.features
        .filter((feature) => feature.type === 'import-mesh')
        .map((feature) => feature.id),
    ),
  );
  return {
    ...project,
    superObjects: project.superObjects.map((superObject) => ({
      ...superObject,
      bodies: superObject.bodies.map((body) => ({
        ...body,
        kind: importedFeatureIds.has(body.createdBy) ? 'mesh' : (body.kind ?? 'solid'),
      })),
    })),
  };
}
