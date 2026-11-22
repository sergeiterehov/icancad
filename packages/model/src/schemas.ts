import { z } from 'zod';
import { pruneEmptyGroups } from './groups';
import { DEFAULT_MESH_UNIT, MESH_UNITS, type Project } from './types';

export const PROJECT_SCHEMA_VERSION = 9;
/** Names in version 8 could move with geometry; such refs keep a pose fallback. */
const LEGACY_SCHEMA_VERSION = 8;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** A numeric parameter: a literal or a Python expression. */
const formula = z.object({ formula: z.string().trim().min(1) });
const param = (literal: z.ZodNumber) => z.union([literal, formula]);
const paramVec3 = z.tuple([param(z.number()), param(z.number()), param(z.number())]);

const transform = z.object({
  translation: paramVec3,
  rotation: paramVec3,
  scale: param(z.number()),
});

const featureBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  suppressed: z.boolean().default(false),
  groupId: z.string().min(1).optional(),
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
        dx: param(z.number().positive()),
        dy: param(z.number().positive()),
        dz: param(z.number().positive()),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('sphere'),
      params: z.object({ radius: param(z.number().positive()) }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('cylinder'),
      params: z.object({
        radius: param(z.number().positive()),
        height: param(z.number().positive()),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('cone'),
      params: z.object({
        bottomRadius: param(z.number().positive()),
        topRadius: param(z.number().nonnegative()),
        height: param(z.number().positive()),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('torus'),
      params: z.object({
        majorRadius: param(z.number().positive()),
        tubeRadius: param(z.number().positive()),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('pyramid'),
      params: z.object({
        sides: param(z.number().int().min(3).max(120)),
        radius: param(z.number().positive()),
        height: param(z.number().positive()),
      }),
    }),
    z.object({
      ...primitiveBase,
      kind: z.literal('capsule'),
      params: z.object({
        radius: param(z.number().positive()),
        height: param(z.number().positive()),
      }),
    }),
  ])
  .superRefine((value, context) => {
    // Formulas are checked after they resolve; literals are checked here.
    if (value.kind !== 'torus') return;
    const { tubeRadius, majorRadius } = value.params;
    if (
      typeof tubeRadius === 'number' &&
      typeof majorRadius === 'number' &&
      tubeRadius >= majorRadius
    ) {
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
  unit: z.enum(MESH_UNITS).default(DEFAULT_MESH_UNIT),
  transform,
  scale: param(z.number().positive()),
});

const importStepFeature = z.object({
  ...featureBase,
  type: z.literal('import-step'),
  assetId: z.string().min(1),
});

const convertToSolidFeature = z.object({
  ...featureBase,
  type: z.literal('convert-to-solid'),
  sourceBodyId: z.string().min(1),
  mode: z.enum(['auto', 'heal', 'voxel']),
  voxelSize: param(z.number().positive()).optional(),
  targetTriangles: param(z.number().int().positive()).optional(),
  tolerance: param(z.number().positive()).optional(),
});

const entityRef = z.object({
  bodyId: z.string().min(1),
  name: z.string().min(1),
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
    type: z.literal('elliptical-arc'),
    construction: z.boolean(),
    cx: z.number(),
    cy: z.number(),
    rx: z.number().positive(),
    ry: z.number().positive(),
    rotation: z.number(),
    startAngle: z.number(),
    endAngle: z.number(),
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
  'arc-length',
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
  value: param(z.number()).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  side: z.number().optional(),
  auto: z.boolean().optional(),
});

const sketchPlaneRef = z.union([
  z.object({
    type: z.literal('datum'),
    plane: z.enum(['XY', 'XZ', 'YZ']),
    offset: param(z.number()),
    inverted: z.boolean().optional(),
    rotation: paramVec3.optional(),
  }),
  z.object({
    type: z.literal('face'),
    bodyId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    offset: param(z.number()).optional(),
    rotation: paramVec3.optional(),
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
    name: z.string().min(1),
  }),
  faceName: z.string().min(1).optional(),
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
  name: z.string().min(1),
  normal: vec3,
  origin: vec3,
  legacyPose: z.boolean().optional(),
});

const revolveAxis = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('world'), axis: z.enum(['x', 'y', 'z']) }),
  z.object({
    kind: z.literal('body-edge'),
    bodyId: z.string().min(1),
    name: z.string().min(1),
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
  start: param(z.number()),
  end: param(z.number()),
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
  end: z.enum(['blind', 'symmetric', 'through-all', 'to-body']),
  distance: param(z.number()),
  toBody: z
    .object({
      kind: z.enum(['first', 'last']),
      bodyId: z.string().min(1).optional(),
      mode: z.enum(['solid', 'gap', 'shell']).optional(),
    })
    .optional(),
  toBodyOffset: param(z.number()).optional(),
  reversed: z.boolean().default(false),
  secondDirection: z
    .object({ end: z.enum(['blind', 'through-all']), distance: param(z.number()) })
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
  thickness: param(z.number().positive()),
  offset: param(z.number().nonnegative()).default(0),
  direction: z.enum(['inward', 'outward']),
});

const holeSpec = z.object({
  kind: z.enum(['simple', 'counterbore', 'countersink']),
  diameter: param(z.number().positive()),
  depth: param(z.number().positive()).optional(),
  throughAll: z.boolean(),
  clearance: z.string().optional(),
  headDiameter: param(z.number().positive()).optional(),
  headDepth: param(z.number().positive()).optional(),
  angle: param(z.number().positive()).optional(),
});

const holeFeature = z.object({
  ...featureBase,
  type: z.literal('hole'),
  bodyId: z.string().min(1),
  faceRef: entityRef,
  positions: z.array(z.object({ x: param(z.number()), y: param(z.number()) })),
  spec: holeSpec,
});

const ribFeature = z.object({
  ...featureBase,
  type: z.literal('rib'),
  bodyId: z.string().min(1),
  sketchId: z.string().min(1),
  thickness: param(z.number().positive()),
  direction: vec3,
});

const edgeTreatmentFeature = z.object({
  ...featureBase,
  type: z.literal('edge-treatment'),
  kind: z.enum(['fillet', 'chamfer']),
  faceRefs: z.array(
    z.object({
      bodyId: z.string().min(1),
      name: z.string().min(1),
      normal: vec3,
      origin: vec3,
      handle: z.object({ origin: vec3, direction: vec3, wedge: z.number().positive() }).optional(),
    }),
  ),
  edgeRefs: z.array(
    z.object({
      bodyId: z.string().min(1),
      name: z.string().min(1),
      start: vec3,
      mid: vec3,
      end: vec3,
      legacyPose: z.boolean().optional(),
      length: z.number().nonnegative().optional(),
      closed: z.boolean().optional(),
      bisector: vec3,
      wedge: z.number().positive().optional(),
      convex: z.boolean().optional(),
    }),
  ),
  size: param(z.number().positive()),
});

const arrayPath = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('body-edge'),
    bodyId: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('sketch-edge'),
    sketchId: z.string().min(1),
    entityId: z.string().min(1),
  }),
]);

const arrayAxis = z.preprocess(
  (value) => {
    // An axis used to be a picked edge or an arc of a sketch. Both are gone, so
    // such an axis falls back to the world axis through the centre of the
    // model, which is where a rotation with nothing picked starts.
    if (value && typeof value === 'object') {
      const kind = (value as { kind?: unknown }).kind;
      if (kind === 'body-edge' || kind === 'sketch-edge' || kind === 'arc') {
        return { kind: 'world', axis: 'z' };
      }
    }
    return value;
  },
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('world'),
      axis: z.enum(['x', 'y', 'z']),
    }),
    z.object({
      kind: z.literal('face'),
      bodyId: z.string().min(1),
      name: z.string().min(1),
      origin: vec3,
      normal: vec3,
    }),
    z.object({
      kind: z.literal('sketch-face'),
      sketchId: z.string().min(1),
      faceId: z.string().min(1),
      origin: vec3,
      normal: vec3,
    }),
  ]),
);

const arrayDirectionShape = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('linear'),
    direction: vec3,
    spacing: param(z.number()),
    angle: param(z.number()).optional(),
    count: param(z.number().int().min(1).max(120)),
  }),
  z.object({
    kind: z.literal('rotation'),
    axis: arrayAxis,
    angle: param(z.number()),
    inverted: z.boolean().optional(),
    count: param(z.number().int().min(1).max(120)),
  }),
  z.object({
    kind: z.literal('path'),
    // Written while a path was a single curve; that is a chain of one.
    path: arrayPath.nullable().optional(),
    paths: z.array(arrayPath).optional(),
    count: param(z.number().int().min(1).max(120)),
  }),
]);

const arrayDirection = arrayDirectionShape.transform((direction) => {
  if (direction.kind !== 'path') return direction;
  return {
    kind: 'path' as const,
    paths: direction.paths ?? (direction.path ? [direction.path] : []),
    count: direction.count,
  };
});

// Projects written before the target was named honestly stored operations;
// they repeat the geometry of those operations, which is what 'geometry' means.
const arrayTarget = z.preprocess(
  (value) => (value === 'operations' ? 'geometry' : value),
  z.enum(['bodies', 'geometry']),
);

const arrayFeature = z.object({
  ...featureBase,
  type: z.literal('array'),
  target: arrayTarget,
  bodyIds: z.array(z.string().min(1)).default([]),
  featureIds: z.array(z.string().min(1)).default([]),
  directions: z.array(arrayDirection).default([]),
});

const booleanFeature = z.object({
  ...featureBase,
  type: z.literal('boolean'),
  op: z.enum(['union', 'subtract', 'intersect']),
  // Both lists start empty: the operation is configured from the inspector and
  // builds nothing until it has a body on each side.
  bodyIds: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
  keepBodies: z.boolean().default(false),
  keepTools: z.boolean().default(false),
});

const deleteBodyFeature = z.object({
  ...featureBase,
  type: z.literal('delete-body'),
  bodyId: z.string().min(1),
});

const transformFeature = z.object({
  ...featureBase,
  type: z.literal('transform'),
  // Both lists start empty: the operation is configured from the inspector and
  // moves nothing until objects are picked.
  bodyIds: z.array(z.string().min(1)).default([]),
  sketchIds: z.array(z.string().min(1)).default([]),
  transform,
});

// Primitives share `type` and differ by `kind`, so they form their own
// discriminated union; the rest keep the faster discriminator on `type`.
export const featureSchema = z.union([
  primitiveFeature,
  z.discriminatedUnion('type', [
    importMeshFeature,
    importStepFeature,
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
  face: z.object({ bodyId: z.string().min(1), name: z.string().min(1) }).nullish(),
  inverted: z.boolean().optional(),
});

const viewState = z.object({
  // The camera is deliberately absent: a view belongs to the app that shows the
  // model, not to the model. Documents that still carry one lose it here.
  sectionPlanes: z.array(sectionPlane),
});

const featureGroup = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().min(1).nullable(),
});

const variableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['number', 'string']),
  source: z.string(),
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
  variables: z.array(variableSchema).default([]),
  groups: z.array(featureGroup).default([]),
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
    variables: z.array(variableSchema).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine(
    (project) =>
      project.superObjects.some((superObject) => superObject.id === project.activeSuperObjectId),
    { message: 'The active super-object is missing', path: ['activeSuperObjectId'] },
  );

/**
 * Marks topology references written by version 8. Their names were derived
 * from face keys, so a parameter change could rename a face or an edge; the
 * pose stored next to the name is what resolves them in that case.
 */
function markLegacyPose(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) markLegacyPose(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const hasPose = typeof record.normal !== 'undefined' && typeof record.origin !== 'undefined';
  const hasEdgePose =
    typeof record.start !== 'undefined' &&
    typeof record.mid !== 'undefined' &&
    typeof record.end !== 'undefined';
  if (
    typeof record.bodyId === 'string' &&
    typeof record.name === 'string' &&
    typeof record.kind === 'undefined' &&
    (hasPose || hasEdgePose)
  ) {
    record.legacyPose = true;
  }
  for (const item of Object.values(record)) markLegacyPose(item);
}

export interface ParseProjectOptions {
  /** Reserved for callers that name the model of a fresh document. */
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

export function parseProject(input: unknown, _options: ParseProjectOptions = {}): Project {
  const envelope = z.object({ schemaVersion: z.number() }).passthrough().safeParse(input);
  if (!envelope.success) {
    throw new ProjectFileError('INVALID_PROJECT', 'Project file has no schemaVersion', {
      cause: envelope.error,
    });
  }
  const version = envelope.data.schemaVersion;
  // Version 8 wrote names that could move with geometry. Its references are
  // read with a pose fallback so opening and editing such a project does not
  // lose a fillet or a chamfer; version 9 writes names that do not move.
  if (version !== PROJECT_SCHEMA_VERSION && version !== LEGACY_SCHEMA_VERSION) {
    throw new ProjectFileError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported project schema version: ${version}`,
    );
  }
  const inputObject = input as Record<string, unknown>;
  const parsed = projectSchema.safeParse({
    ...inputObject,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  });
  if (!parsed.success) {
    throw new ProjectFileError('INVALID_PROJECT', 'Project file is invalid', {
      cause: parsed.error,
    });
  }
  // Projects written before mesh objects had their own kind stored imported
  // meshes as bodies without a `kind`. Recognise them from their operation so
  // they never become solid-body targets after loading.
  const project = parsed.data as Project;
  if (version === LEGACY_SCHEMA_VERSION) markLegacyPose(project);
  const importedFeatureIds = new Set(
    project.superObjects.flatMap((superObject) =>
      superObject.features
        .filter((feature) => feature.type === 'import-mesh')
        .map((feature) => feature.id),
    ),
  );
  return {
    ...project,
    superObjects: project.superObjects.map((superObject) =>
      pruneEmptyGroups({
        ...superObject,
        features: superObject.features.map(normalizeFeature),
        bodies: superObject.bodies.map((body) => ({
          ...body,
          kind: importedFeatureIds.has(body.createdBy) ? 'mesh' : (body.kind ?? 'solid'),
        })),
      }),
    ),
  };
}

/**
 * Brings one operation to the shape the rest of the app expects. A rotation span
 * used to carry its direction as the sign of the angle: the sign is a state of
 * its own now, so an old direction becomes a positive span plus `inverted`.
 */
function normalizeFeature(feature: Project['superObjects'][number]['features'][number]) {
  if (feature.type !== 'array') return feature;
  let changed = false;
  const directions = feature.directions.map((direction) => {
    if (direction.kind !== 'rotation' || typeof direction.angle !== 'number') return direction;
    const span = Math.max(0, Math.min(360, Math.abs(direction.angle)));
    const inverted = direction.angle < 0 ? !direction.inverted : (direction.inverted ?? false);
    if (span === direction.angle && inverted === (direction.inverted ?? false)) {
      return direction;
    }
    changed = true;
    return { ...direction, angle: span, inverted };
  });
  return changed ? { ...feature, directions } : feature;
}
