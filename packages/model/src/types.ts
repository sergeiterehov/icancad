export const HISTORY_START = 'start';

export type Vec3 = [number, number, number];

export type MeshFormat = 'stl' | 'obj' | 'ply' | 'glb';

export interface Transform {
  translation: Vec3;
  rotation: Vec3;
  scale: number;
}

export type FeatureType =
  | 'primitive'
  | 'import-mesh'
  | 'convert-to-solid'
  | 'sketch'
  | 'extrude'
  | 'shell'
  | 'hole'
  | 'rib'
  | 'edge-treatment'
  | 'boolean'
  | 'delete-body'
  | 'transform';

export interface FeatureBase {
  id: string;
  name: string;
  suppressed: boolean;
}

export interface PrimitiveFeature extends FeatureBase {
  type: 'primitive';
  kind: 'box';
  params: { dx: number; dy: number; dz: number };
  transform: Transform;
}

export interface ImportMeshFeature extends FeatureBase {
  type: 'import-mesh';
  assetId: string;
  format: MeshFormat;
  transform: Transform;
  scale: number;
}

export interface ConvertToSolidFeature extends FeatureBase {
  type: 'convert-to-solid';
  sourceBodyId: string;
  mode: 'auto' | 'heal' | 'voxel';
  voxelSize?: number;
  targetTriangles?: number;
  tolerance?: number;
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
  value?: number;
  x?: number;
  y?: number;
}

export interface SketchFrame {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  normal: Vec3;
}

export type SketchPlaneRef =
  | { type: 'datum'; plane: 'XY' | 'XZ' | 'YZ'; offset: number }
  | {
      type: 'face';
      /** Absent until a face is picked; such a sketch is invalid. */
      bodyId?: string;
      topoId?: string;
      /** Distance along the face normal, away from the face. */
      offset?: number;
      frame?: SketchFrame;
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
    kind: 'vertex' | 'edge';
    bodyId: string;
    /** Vertex coordinate id, or the kernel edge id. */
    elementId: string;
  };
  /** Face the projection was taken from, when it came from a face. */
  faceId?: string;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: SketchPlaneRef;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  references: SketchReference[];
  projections?: SketchProjection[];
}

export type ExtrudeEnd = 'blind' | 'symmetric' | 'through-all';

export interface ExtrudeSecondDirection {
  end: 'blind' | 'through-all';
  distance: number;
}

/** What sweeps the profile: a straight pull or a turn around an axis. */
export type ExtrudeMethod = 'extrude' | 'revolve';

/**
 * The line a revolve turns its profile around. A world axis runs through the
 * origin, a body edge keeps the pose it was picked at so a rebuild can find it
 * again, and a sketch edge follows the line it was drawn as.
 */
export type RevolveAxis =
  | { kind: 'world'; axis: 'x' | 'y' | 'z' }
  | { kind: 'body-edge'; bodyId: string; edgeId: string; start: Vec3; end: Vec3 }
  | { kind: 'sketch-edge'; sketchId: string; entityId: string };

export interface RevolveSpec {
  axis: RevolveAxis;
  /** Degrees around the axis, measured right-handed; the sweep runs start…end. */
  start: number;
  end: number;
  /** Turns the sweep the other way round: both angles are negated. */
  inverted: boolean;
}

// A face of a solid body used as an extrude input. The face id is the OCCT
// traversal index, which is stable for as long as the body rebuilds the same
// way (persistent naming arrives in M5). The normal is captured at pick time so
// the operation keeps its direction when the body is rebuilt.
export interface BodyFaceRef {
  bodyId: string;
  faceId: string;
  normal: Vec3;
  origin: Vec3;
  /** Where the treatment handle sits, measured on the rim at pick time. */
  handle?: FaceTreatmentHandle;
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
 * An edge of a solid body used as an edge treatment input. Like a face ref it
 * keeps the pose it had when it was picked, so the edge can be found again
 * after a rebuild renumbers the traversal.
 */
export interface BodyEdgeRef {
  bodyId: string;
  edgeId: string;
  /** Faces on both sides of the edge, in tessellation order. */
  faceIds: number[];
  /** Start, middle and end of the edge polyline, in world space. */
  start: Vec3;
  mid: Vec3;
  end: Vec3;
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
  /** Picked objects in selection order: `s:<sketchId>#<regionId>` or `b:<bodyId>#<faceId>`. */
  objectOrder: string[];
  method: ExtrudeMethod;
  /** Axis and angles of a revolve; absent until the method is a revolve. */
  revolve?: RevolveSpec;
  end: ExtrudeEnd;
  distance: number;
  /** Extrude along the opposite side of the sketch plane or face normal. */
  reversed: boolean;
  /** Optional extrusion to the opposite side of the sketch plane. */
  secondDirection?: ExtrudeSecondDirection;
  op: 'new' | 'add' | 'subtract' | 'intersect';
  scope: 'all' | 'selected';
  bodyIds: string[];
  joinRegions: boolean;
}

export interface ShellFeature extends FeatureBase {
  type: 'shell';
  bodyId: string;
  removeFaces: EntityRef[];
  thickness: number;
  direction: 'inward' | 'outward';
}

export interface EntityRef {
  bodyId: string;
  topoId: string;
  fingerprint?: {
    surfaceType: string;
    measure: number;
    centroid: Vec3;
    normal: Vec3;
  };
}

export interface HoleSpec {
  kind: 'simple' | 'counterbore' | 'countersink';
  diameter: number;
  depth?: number;
  throughAll: boolean;
  clearance?: string;
  headDiameter?: number;
  headDepth?: number;
  angle?: number;
}

export interface HoleFeature extends FeatureBase {
  type: 'hole';
  bodyId: string;
  faceRef: EntityRef;
  positions: Array<{ x: number; y: number }>;
  spec: HoleSpec;
}

export interface RibFeature extends FeatureBase {
  type: 'rib';
  bodyId: string;
  sketchId: string;
  thickness: number;
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
  size: number;
}

export interface BooleanFeature extends FeatureBase {
  type: 'boolean';
  op: 'union' | 'subtract' | 'intersect';
  bodyIds: string[];
}

// Removing an object is an operation too: the body disappears from this point in
// the history, while its creating operation and its metadata stay untouched.
export interface DeleteBodyFeature extends FeatureBase {
  type: 'delete-body';
  bodyId: string;
}

export interface TransformFeature extends FeatureBase {
  type: 'transform';
  bodyId: string;
  transform: Transform;
}

export type Feature =
  | PrimitiveFeature
  | ImportMeshFeature
  | ConvertToSolidFeature
  | SketchFeature
  | ExtrudeFeature
  | ShellFeature
  | HoleFeature
  | RibFeature
  | EdgeTreatmentFeature
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
  topoId: string;
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

export interface CameraState {
  target: Vec3;
  distance: number;
  azimuth: number;
  polar: number;
}

export interface ViewState {
  camera: CameraState | null;
  sectionPlanes: SectionPlane[];
}

export interface Project {
  schemaVersion: 2;
  id: string;
  name: string;
  units: 'mm';
  features: Feature[];
  bodies: BodyRef[];
  metadata: Record<string, ObjectMetadata>;
  view: ViewState;
  historyEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FeatureErrorCode =
  | 'KERNEL_NOT_READY'
  | 'KERNEL_LOAD_FAILED'
  | 'SHAPE_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'NOT_IMPLEMENTED'
  | 'OP_FAILED';
