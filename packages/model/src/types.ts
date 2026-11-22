export const HISTORY_START = 'start';

export type Vec3 = [number, number, number];

export type MeshFormat = 'stl' | 'obj' | 'ply' | 'glb';

export const MESH_UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;

/** The length unit a mesh file is written in; the model itself is millimetres. */
export type MeshUnit = (typeof MESH_UNITS)[number];

export const DEFAULT_MESH_UNIT: MeshUnit = 'mm';

export const MILLIMETRES_PER_MESH_UNIT: Record<MeshUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/**
 * A numeric parameter written as a Python expression. The leading `=` the user
 * types in a field is a UI marker only and is never stored.
 */
export interface Formula {
  formula: string;
}

/** A numeric parameter: a literal or a formula that resolves to one. */
export type ParamValue = number | Formula;

export type ParamVec3 = [ParamValue, ParamValue, ParamValue];

export function isFormula(value: unknown): value is Formula {
  return typeof value === 'object' && value !== null && 'formula' in value;
}

/**
 * Replaces every parameter of a shape with the number it resolves to; strings,
 * ids and geometry snapshots keep their type.
 */
export type Resolved<T> = T extends ParamValue
  ? number
  : T extends readonly unknown[]
    ? { [K in keyof T]: Resolved<T[K]> }
    : T extends object
      ? { [K in keyof T]: Resolved<T[K]> }
      : T;

export type VariableType = 'number' | 'string';

/** A named project value, usable from any operation of the project. */
export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  /** number: a Python expression; string: the text itself. */
  source: string;
}

export interface Transform {
  translation: ParamVec3;
  rotation: ParamVec3;
  scale: ParamValue;
}

export type FeatureType =
  | 'primitive'
  | 'import-mesh'
  | 'import-step'
  | 'convert-to-solid'
  | 'sketch'
  | 'extrude'
  | 'shell'
  | 'hole'
  | 'rib'
  | 'edge-treatment'
  | 'array'
  | 'boolean'
  | 'delete-body'
  | 'transform';

export interface FeatureBase {
  id: string;
  name: string;
  suppressed: boolean;
  /** Folder the operation is shown in; the field is absent at the top level. */
  groupId?: string;
}

export type PrimitiveKind =
  'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'pyramid' | 'capsule';

interface PrimitiveBase extends FeatureBase {
  type: 'primitive';
  transform: Transform;
}

export interface BoxPrimitive extends PrimitiveBase {
  kind: 'box';
  params: { dx: ParamValue; dy: ParamValue; dz: ParamValue };
}

/** The radius is stored; the inspector shows the diameter. */
export interface SpherePrimitive extends PrimitiveBase {
  kind: 'sphere';
  params: { radius: ParamValue };
}

export interface CylinderPrimitive extends PrimitiveBase {
  kind: 'cylinder';
  params: { radius: ParamValue; height: ParamValue };
}

export interface ConePrimitive extends PrimitiveBase {
  kind: 'cone';
  /** A zero top radius makes a sharp cone. */
  params: { bottomRadius: ParamValue; topRadius: ParamValue; height: ParamValue };
}

/** The radii are stored; the inspector shows the diameters. */
export interface TorusPrimitive extends PrimitiveBase {
  kind: 'torus';
  params: { majorRadius: ParamValue; tubeRadius: ParamValue };
}

/** A regular pyramid: `radius` is the circumradius of the base polygon. */
export interface PyramidPrimitive extends PrimitiveBase {
  kind: 'pyramid';
  params: { sides: ParamValue; radius: ParamValue; height: ParamValue };
}

/** A capsule: `height` is the length of the straight cylindrical section. */
export interface CapsulePrimitive extends PrimitiveBase {
  kind: 'capsule';
  params: { radius: ParamValue; height: ParamValue };
}

export type PrimitiveFeature =
  | BoxPrimitive
  | SpherePrimitive
  | CylinderPrimitive
  | ConePrimitive
  | TorusPrimitive
  | PyramidPrimitive
  | CapsulePrimitive;

export interface ImportMeshFeature extends FeatureBase {
  type: 'import-mesh';
  assetId: string;
  format: MeshFormat;
  unit: MeshUnit;
  transform: Transform;
  scale: ParamValue;
}

/** A STEP file kept as an asset; its bodies are rebuilt from the file. */
export interface ImportStepFeature extends FeatureBase {
  type: 'import-step';
  assetId: string;
}

export interface ConvertToSolidFeature extends FeatureBase {
  type: 'convert-to-solid';
  sourceBodyId: string;
  mode: 'auto' | 'heal' | 'voxel';
  voxelSize?: ParamValue;
  targetTriangles?: ParamValue;
  tolerance?: ParamValue;
}

export type SketchEntity =
  | { id: string; type: 'point'; construction: boolean; x: number; y: number }
  | {
      id: string;
      type: 'line';
      construction: boolean;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      id: string;
      type: 'arc';
      construction: boolean;
      cx: number;
      cy: number;
      r: number;
      startAngle: number;
      endAngle: number;
    }
  | { id: string; type: 'circle'; construction: boolean; cx: number; cy: number; r: number }
  | {
      id: string;
      type: 'ellipse';
      construction: boolean;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation: number;
    }
  | {
      id: string;
      type: 'elliptical-arc';
      construction: boolean;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      /** Turn of the local X axis, in degrees, like an ellipse. */
      rotation: number;
      /** Angles in the ellipse's own frame, in radians, like an arc. */
      startAngle: number;
      endAngle: number;
    }
  | { id: string; type: 'bezier'; construction: boolean; points: Array<[number, number]> };

export type ConstraintType =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal'
  | 'distance'
  | 'horizontal-distance'
  | 'vertical-distance'
  | 'angle'
  | 'arc-length'
  | 'radius'
  | 'diameter'
  | 'symmetric'
  | 'point-on-line'
  | 'point-on-circle'
  | 'point-on-ellipse'
  | 'fix';

export interface SketchConstraintRef {
  entityId: string;
  pointIndex?: number;
}

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  refs: SketchConstraintRef[];
  value?: ParamValue;
  x?: number;
  y?: number;
  /**
   * Created automatically from a snap or an alignment. Such a constraint may be
   * dropped when the solver shows that another one already implies it; an
   * authored constraint stays even when it is redundant.
   */
  auto?: boolean;
  /**
   * The side a distance was created on, or the way round an angle turns: `1` or
   * `-1`. It keeps a point from crossing to the other side of a line or a
   * circle when the referenced geometry is rebuilt elsewhere, and it lets an
   * angle keep a magnitude in the document while the solver still knows which
   * side of the first line the second one sits on.
   */
  side?: number;
}

export interface SketchFrame {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  normal: Vec3;
}

export type SketchPlaneRef =
  | {
      type: 'datum';
      plane: 'XY' | 'XZ' | 'YZ';
      offset: ParamValue;
      /** The sketch looks at the back of the plane, like a flipped section. */
      inverted?: boolean;
      /** Angles in degrees around the sketch axes X, Y and Z, applied in order. */
      rotation?: ParamVec3;
    }
  | {
      type: 'face';
      /** Absent until a face is picked; such a sketch is invalid. */
      bodyId?: string;
      /** Persistent name of the face the sketch stands on (ADR 0042). */
      name?: string;
      /** Distance along the face normal, away from the face. */
      offset?: ParamValue;
      frame?: SketchFrame;
      /** The sketch looks at the back of the face, like a flipped section. */
      inverted?: boolean;
      /** Angles in degrees around the sketch axes X, Y and Z, applied in order. */
      rotation?: ParamVec3;
    };

export type SketchMeasure = 'length' | 'angle' | 'radius' | 'diameter' | 'x' | 'y' | 'rx' | 'ry';

export interface SketchReference {
  id: string;
  entityId: string;
  measure: SketchMeasure;
}

/**
 * A sketch entity derived from 3D geometry. The entity itself is the snapshot:
 * while the source still exists the geometry is regenerated from it, and when
 * the link is gone the snapshot stays and is reported as a warning. Projected
 * entities are linked to their source by id and never edited by hand.
 */
export interface SketchProjection {
  id: string;
  entityId: string;
  source: {
    kind: 'vertex' | 'edge' | 'silhouette';
    bodyId: string;
    /** Persistent name of the vertex, edge or silhouette part (ADR 0042). */
    name: string;
  };
  /** Persistent name of the face the projection was taken from, if any. */
  faceName?: string;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: SketchPlaneRef;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  references: SketchReference[];
  projections?: SketchProjection[];
}

export type ExtrudeEnd = 'blind' | 'symmetric' | 'through-all' | 'to-body';

export interface ExtrudeSecondDirection {
  end: 'blind' | 'through-all';
  distance: ParamValue;
}

/**
 * Where a "to body" extrude ends: on the face of the body that looks towards
 * the profile (`first`) or on the one away from it (`last`).
 */
export interface ExtrudeToBody {
  kind: 'first' | 'last';
  /** A picked body to stop at; without one the sweep takes the nearest or farthest. */
  bodyId?: string;
  /**
   * How the sweep ends on that body: solid ends on the surface, gap stops the
   * given distance in front of it, shell keeps a layer of that thickness standing
   * on it. Absent in older documents, where the sign of the offset carried it.
   */
  mode?: ExtrudeToBodyMode;
}

/** Where a "to body" sweep ends relative to the surface that stops it. */
export type ExtrudeToBodyMode = 'solid' | 'gap' | 'shell';

/** What sweeps the profile: a straight pull or a turn around an axis. */
export type ExtrudeMethod = 'extrude' | 'revolve';

/**
 * The line a revolve turns its profile around. A world axis runs through the
 * origin, a body edge keeps the pose it was picked at so a rebuild can find it
 * again, and a sketch edge follows the line it was drawn as.
 */
export type RevolveAxis =
  | { kind: 'world'; axis: 'x' | 'y' | 'z' }
  | { kind: 'body-edge'; bodyId: string; name: string; start: Vec3; end: Vec3 }
  | { kind: 'sketch-edge'; sketchId: string; entityId: string };

export interface RevolveSpec {
  axis: RevolveAxis;
  /** Degrees around the axis, measured right-handed; the sweep runs start…end. */
  start: ParamValue;
  end: ParamValue;
  /** Turns the sweep the other way round: both angles are negated. */
  inverted: boolean;
}

// A face of a solid body used as a downstream input. `name` is the persistent
// topology name the kernel gave the face (ADR 0042); the pose is a cache for
// handles and for resolving the rare case of a split face.
export interface BodyFaceRef {
  bodyId: string;
  name: string;
  normal: Vec3;
  origin: Vec3;
  /** Where the treatment handle sits, measured on the rim at pick time. */
  handle?: FaceTreatmentHandle;
  /**
   * The reference was written by schema 8, whose names could change when a
   * parameter changed. The stored pose is used when the name no longer exists,
   * so a project saved by that build keeps working (ADR 0042).
   */
  legacyPose?: boolean;
}

/** Arrow of an edge treatment on a face: it stands on the first rim edge. */
export interface FaceTreatmentHandle {
  origin: Vec3;
  /** Points into the corner, toward the face the treatment creates. */
  direction: Vec3;
  /** Angle between the two faces at that rim edge, in radians. */
  wedge: number;
}

/**
 * An edge of a solid body used as a downstream input. `name` is the persistent
 * topology name the kernel gave the edge (ADR 0042); the pose is a cache for the
 * handle and for telling apart the pieces of a split edge.
 */
export interface BodyEdgeRef {
  bodyId: string;
  name: string;
  /** Start, middle and end of the edge polyline, in world space. */
  start: Vec3;
  mid: Vec3;
  end: Vec3;
  /** A schema 8 reference: the pose is used when the name is gone. */
  legacyPose?: boolean;
  /** Length and closure of the picked polyline, kept for the handle. */
  length?: number;
  closed?: boolean;
  /** Bisector of the two face normals, pointing away from the material. */
  bisector: Vec3;
  /** Angle between the two faces at the edge, measured where the face appears. */
  wedge?: number;
  /** The material fills the corner, so the created face lies inside the body. */
  convex?: boolean;
}

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  /** Absent until the operation is given objects to extrude. */
  sketchId?: string;
  regions: string[];
  /** Faces of solid bodies, used in addition to (or instead of) sketch faces. */
  faceRefs: BodyFaceRef[];
  /** Picked objects in selection order: `s:<sketchId>#<regionId>` or `b:<faceName>`. */
  objectOrder: string[];
  method: ExtrudeMethod;
  /** Axis and angles of a revolve; absent until the method is a revolve. */
  revolve?: RevolveSpec;
  end: ExtrudeEnd;
  distance: ParamValue;
  /** The body a `to-body` extent stops at; absent for every other extent. */
  toBody?: ExtrudeToBody;
  /**
   * Millimetres measured from the face the extrusion ends on, not from the
   * profile plane. A size once `mode` says how the sweep ends there; a document
   * from before that carries the way in the sign of this number instead.
   */
  toBodyOffset?: ParamValue;
  /** Extrude along the opposite side of the sketch plane or face normal. */
  reversed: boolean;
  /** Optional extrusion to the opposite side of the sketch plane. */
  secondDirection?: ExtrudeSecondDirection;
  op: 'new' | 'add' | 'subtract' | 'intersect';
  scope: 'all' | 'selected';
  bodyIds: string[];
  joinRegions: boolean;
}

/**
 * Hollows bodies in place (`inward`, a cavity) or grows a new body around them
 * (`outward`, a shell). Faces listed in `removeFaces` stay open.
 */
export interface ShellFeature extends FeatureBase {
  type: 'shell';
  /** Whole bodies to hollow; a picked face also makes its body a target. */
  bodyIds: string[];
  /** Faces left open in the wall. */
  removeFaces: BodyFaceRef[];
  /** Wall thickness in millimetres. */
  thickness: ParamValue;
  /** Gap between the input surface and an outward shell; 0 for a cavity. */
  offset: ParamValue;
  direction: 'inward' | 'outward';
}

export interface EntityRef {
  bodyId: string;
  /** Persistent topology name of the referenced face (ADR 0042). */
  name: string;
}

export interface HoleSpec {
  kind: 'simple' | 'counterbore' | 'countersink';
  diameter: ParamValue;
  depth?: ParamValue;
  throughAll: boolean;
  clearance?: string;
  headDiameter?: ParamValue;
  headDepth?: ParamValue;
  angle?: ParamValue;
}

export interface HoleFeature extends FeatureBase {
  type: 'hole';
  bodyId: string;
  faceRef: EntityRef;
  positions: Array<{ x: ParamValue; y: ParamValue }>;
  spec: HoleSpec;
}

export interface RibFeature extends FeatureBase {
  type: 'rib';
  bodyId: string;
  sketchId: string;
  thickness: ParamValue;
  direction: Vec3;
}

export type EdgeTreatmentKind = 'fillet' | 'chamfer';

/**
 * One operation for both kinds of edge treatment (ADR 0015). The kind is a
 * property of the operation, so the same tool creates either and the history
 * still tells them apart.
 */
export interface EdgeTreatmentFeature extends FeatureBase {
  type: 'edge-treatment';
  kind: EdgeTreatmentKind;
  /** Faces whose boundary edges are treated. */
  faceRefs: BodyFaceRef[];
  /** Edges picked one by one. */
  edgeRefs: BodyEdgeRef[];
  /** Requested radius (fillet) or leg distance (chamfer), in millimetres. */
  size: ParamValue;
}

/**
 * A boolean operation between two lists of bodies (ADR 0036). It never changes
 * its inputs: the result is a new body, and each list decides whether its
 * bodies survive the operation.
 */
export interface BooleanFeature extends FeatureBase {
  type: 'boolean';
  op: 'union' | 'subtract' | 'intersect';
  /** The first list: the material the operation starts from. */
  bodyIds: string[];
  /** The second list: bodies combined with, cut away or intersected with. */
  toolIds: string[];
  /** Keep the first-list bodies in the model after the operation. */
  keepBodies?: boolean;
  /** Keep the second-list bodies in the model after the operation. */
  keepTools?: boolean;
}

// Removing an object is an operation too: the body disappears from this point in
// the history, while its creating operation and its metadata stay untouched.
export interface DeleteBodyFeature extends FeatureBase {
  type: 'delete-body';
  bodyId: string;
}

/**
 * Moves, turns and scales picked objects as one, around the centre of their
 * bounds. Bodies are transformed in place; a sketch is its result — the plane
 * it lies on and its geometry — from this point of the history on, so the
 * sketch itself stays parametric.
 */
export interface TransformFeature extends FeatureBase {
  type: 'transform';
  /** Solid bodies to move. */
  bodyIds: string[];
  /** Sketches whose result to move; they must stand before the operation. */
  sketchIds: string[];
  transform: Transform;
}

/**
 * What an array repeats: picked bodies, or the geometry of picked operations
 * (the material they added and removed, repeated as a stamp).
 */
export type ArrayTarget = 'bodies' | 'geometry';

/**
 * A curve the copies follow: an edge of a body, or a curve drawn in a sketch
 * plane. Several of them make one path when they meet end to end.
 */
export type ArrayPath =
  | { kind: 'body-edge'; bodyId: string; name: string }
  | { kind: 'sketch-edge'; sketchId: string; entityId: string };
/**
 * One step of an array. `count` includes the seed, so 1 leaves only the
 * original. Directions are applied one after another: the second one repeats
 * the whole result of the first (ADR 0029).
 */
export type ArrayDirection =
  | {
      kind: 'linear';
      direction: Vec3;
      spacing: ParamValue;
      /**
       * Tilt of the direction, in degrees. Two directions of a grid meet at any
       * angle instead of a right one, which is what turns a box of copies into
       * a parallelepiped (ADR 0029).
       */
      angle?: ParamValue;
      count: ParamValue;
    }
  | {
      kind: 'rotation';
      axis: ArrayRotationAxis;
      /**
       * Total angle the copies span, in degrees, 0…360; the step is the angle
       * over the gaps. The span is always positive: which way the copies turn
       * is a state of its own, so the field never shows a minus sign.
       */
      angle: ParamValue;
      /** The copies turn the other way round: the span is measured backwards. */
      inverted?: boolean;
      count: ParamValue;
    }
  /** `paths` is empty while the direction waits for curves to be picked. */
  | { kind: 'path'; paths: ArrayPath[]; count: ParamValue };

/**
 * What the copies of a rotation turn around: a world axis through the centre of
 * the model, or the normal of a picked planar face, through the centre of that
 * face. The pose is captured at pick time, so the turn survives a rebuild that
 * renumbers faces.
 */
export type ArrayRotationAxis =
  | { kind: 'world'; axis: 'x' | 'y' | 'z' }
  | {
      kind: 'face';
      bodyId: string;
      /** Persistent name of the face the rotation turns around (ADR 0042). */
      name: string;
      /** Centre of the face: the point the copies turn around. */
      origin: Vec3;
      /** Normal of the face: the direction of the axis, right-handed. */
      normal: Vec3;
    }
  | {
      /** A region of a sketch: its plane is the plane of the sketch. */
      kind: 'sketch-face';
      sketchId: string;
      faceId: string;
      origin: Vec3;
      normal: Vec3;
    };

/**
 * Repeats bodies along one or more directions. The copies are new bodies of
 * their own; the seeds stay where they are.
 */
export interface ArrayFeature extends FeatureBase {
  type: 'array';
  target: ArrayTarget;
  /** Bodies directly picked when `target` is `bodies`. */
  bodyIds: string[];
  /** Operations whose created bodies are repeated when `target` is `operations`. */
  featureIds: string[];
  directions: ArrayDirection[];
}

export type Feature =
  | PrimitiveFeature
  | ImportMeshFeature
  | ImportStepFeature
  | ConvertToSolidFeature
  | SketchFeature
  | ExtrudeFeature
  | ShellFeature
  | HoleFeature
  | RibFeature
  | EdgeTreatmentFeature
  | ArrayFeature
  | BooleanFeature
  | DeleteBodyFeature
  | TransformFeature;

// An object is a ref produced by an operation; its properties live in
// `Project.metadata` under the same id (ADR 0007). Imported meshes are objects
// of their own kind: they render and select like bodies but have no B-rep, so
// they can never be used as solid body targets.
export interface BodyRef {
  id: string;
  createdBy: string;
  kind?: 'solid' | 'mesh';
}

export interface ObjectMetadata {
  name?: string;
  color?: string;
  visible?: boolean;
  /** Number in a body name, kept so numbering never repeats (ADR 0009). */
  bodyIndex?: number;
  /** Sketches: draw construction geometry in the 3D view (hidden by default). */
  showConstruction?: boolean;
}

export interface SectionFaceRef {
  bodyId: string;
  /** Persistent topology name of the face the section follows (ADR 0042). */
  name: string;
}

export interface SectionPlane {
  id: string;
  name: string;
  origin: Vec3;
  normal: Vec3;
  offset: number;
  visible: boolean;
  /**
   * Face the plane follows, or `null` while the face mode is on and nothing has
   * been picked yet. `origin` and `normal` keep the last pose, which is the
   * fallback once the face is gone.
   */
  face?: SectionFaceRef | null;
  /** Cut away the side the normal points to instead of the one behind it. */
  inverted?: boolean;
}

/**
 * What a model remembers about looking at it. The camera is not part of it: the
 * view is the app's, not the document's, so a project opened anywhere starts
 * from the default pose and is fitted to its content.
 */
export interface ViewState {
  sectionPlanes: SectionPlane[];
}

/**
 * Everything that is edited in 3D and listed in the object tree: one model of
 * the project. A future assembly is another super-object kind, so the project
 * stores a discriminated list rather than a flat feature history.
 */
export interface Model {
  type: 'model';
  id: string;
  name: string;
  features: Feature[];
  bodies: BodyRef[];
  metadata: Record<string, ObjectMetadata>;
  view: ViewState;
  historyEnd: string | null;
  /** Named values visible only in this model. */
  variables: Variable[];
  /** Folders of the timeline; they never change the build order. */
  groups: FeatureGroup[];
}

/**
 * A folder of the operations strip (ADR 0032). It holds no order of its own:
 * its place and its contents follow the order of the operations it owns.
 */
export interface FeatureGroup {
  id: string;
  name: string;
  parentId: string | null;
}

/** The project's top level: models now, assemblies later. */
export type SuperObject = Model;

export interface Project {
  schemaVersion: 9;
  id: string;
  name: string;
  units: 'mm';
  superObjects: SuperObject[];
  activeSuperObjectId: string;
  /** Named values shared by every model of the project. */
  variables: Variable[];
  createdAt: string;
  updatedAt: string;
}

export type ResolvedFeature = Resolved<Feature>;

/** A model with every formula replaced by the number it resolves to. */
export type ResolvedModel = Omit<Model, 'features'> & { features: ResolvedFeature[] };

export type FeatureErrorCode =
  | 'KERNEL_NOT_READY'
  | 'KERNEL_LOAD_FAILED'
  | 'SHAPE_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'NOT_IMPLEMENTED'
  | 'OP_FAILED'
  | 'CONSTRAINT_CONFLICT'
  | 'EXPRESSION_ERROR'
  | 'BOOLEAN_EMPTY';
