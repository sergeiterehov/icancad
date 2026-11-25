import type { Vec3 } from '@icancad/model';

export interface TessellationQuality {
  linearDeflection: number;
  angularDeflection: number;
}

export const DEFAULT_TESSELLATION_QUALITY: TessellationQuality = {
  // Fine enough that a fillet keeps a round silhouette and the shading across
  // a tangent edge has no visible crease, coarse enough to keep picking and
  // the rebuild previews cheap.
  linearDeflection: 0.05,
  angularDeflection: 0.2,
};

/**
 * A B-rep edge of a tessellated body. Edges shared by the same two faces are
 * merged into one polyline, so seams inside a single face stay out. Ids follow
 * the deterministic face/edge traversal of the shape, which is what a future
 * fillet or chamfer needs to address the same edge.
 */
export interface BodyEdge {
  id: string;
  /** Persistent name: the same edge keeps it across rebuilds (ADR 0042). */
  name?: string;
  /** Historical names the edge still answers to after a merge or a split. */
  aliases?: string[];
  /** Face traversal indices on both sides of the edge, in tessellation order. */
  faceIds: number[];
  /** Flat world-space points of the polyline. */
  points: number[];
  closed: boolean;
  /** Angle the two faces open through, in radians. */
  wedge?: number;
  /** False when the material fills the corner, which is what a fillet here adds to. */
  convex?: boolean;
}

/**
 * The plane a flat face lies in, measured on the surface itself rather than on
 * its triangles. A sketch placed on a face takes this plane, so a cut that
 * starts on the face begins on the surface instead of a fraction of a micron
 * under it — which is enough to leave a skin the boolean keeps.
 */
export interface FacePlane {
  origin: Vec3;
  normal: Vec3;
}

export interface TessellationResult {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceIds: Uint32Array;
  triangleCount: number;
  vertexCount: number;
  bbox: { min: Vec3; max: Vec3 };
  /** Solid bodies only: imported meshes have no B-rep edges. */
  edges?: BodyEdge[];
  /** Persistent name of every face, aligned with `faceIds` (ADR 0042). */
  faceNames?: string[];
  /** Historical names of every face, including its canonical one. */
  faceAliases?: string[][];
  /** Operation that owns every face, aligned with `faceIds`. */
  faceOwners?: string[];
  /** Exact plane of every flat face, aligned with `faceIds`; null when curved. */
  facePlanes?: (FacePlane | null)[];
}

export interface ShapeStats {
  faces: number;
  edges: number;
  /** Number of separate solids in the shape; more than one means disjoint parts. */
  solids: number;
}

export interface HealthResult {
  occtVersion: string;
  loadMs: number;
}

export interface BoxParams {
  shapeId: string;
  dx: number;
  dy: number;
  dz: number;
  /** Corner the box grows from; the origin when omitted. */
  at?: [number, number, number];
  /** Scope of the operation that creates the body, used for face names. */
  name?: string;
}

interface PrimitiveParamsBase {
  shapeId: string;
  /** Anchor of the primitive: a corner for a box, a centre otherwise. */
  at?: [number, number, number];
  /** Scope of the operation that creates the body, used for face names. */
  name?: string;
}

export type MakePrimitiveParams = PrimitiveParamsBase &
  (
    | { kind: 'box'; dx: number; dy: number; dz: number }
    | { kind: 'sphere'; radius: number }
    | { kind: 'cylinder'; radius: number; height: number }
    | { kind: 'cone'; bottomRadius: number; topRadius: number; height: number }
    | { kind: 'torus'; majorRadius: number; tubeRadius: number }
    | { kind: 'pyramid'; sides: number; radius: number; height: number }
    | { kind: 'capsule'; radius: number; height: number }
  );

export interface MakeBoxResult {
  shapeId: string;
  stats: ShapeStats;
  /**
   * With `trackFaces`: index of the base-shape face each result face came from,
   * in shape order, or -1 for a face this operation created.
   */
  facesFromBase?: number[];
}

export interface SplitSolidsParams {
  shapeId: string;
  /** Extracted solids get ids `${prefix}:solid-${index}`. */
  prefix: string;
}

export interface SplitSolid {
  shapeId: string;
  /**
   * For every face of the solid, in shape order, its index among the faces of
   * the split shape. Untouched faces are the very same B-rep faces, so a
   * boolean that later moves them keeps their identity.
   */
  facesFromShape: number[];
  stats: ShapeStats;
  /** Volume of the solid, used to pick the part that keeps the body. */
  volume: number;
  /** Centre of mass, a deterministic tie-breaker for equal volumes. */
  center: [number, number, number];
}

export interface SplitSolidsResult {
  solids: SplitSolid[];
}

export interface ProfileLine {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ProfileArc {
  type: 'arc';
  cx: number;
  cy: number;
  r: number;
  /** Radians, counter-clockwise from `startAngle` to `endAngle`. */
  startAngle: number;
  endAngle: number;
  /** The contour walks this curve from end to start. */
  reversed?: boolean;
}

export interface ProfileCircle {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
  reversed?: boolean;
}

/**
 * An exact ellipse on the sketch plane: the full curve when `startAngle` is
 * absent, otherwise the arc between the two angles of the frame `rotation`
 * describes.
 */
export interface ProfileEllipse {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Turn of the local X axis, in radians. */
  rotation: number;
  startAngle?: number;
  endAngle?: number;
  reversed?: boolean;
}

/**
 * A B-spline on the sketch plane: the poles in sketch coordinates, the degree
 * and the knots with their multiplicities. A curve the sketch draws as a Bezier
 * is one span of this, clamped at both ends, so it reaches the kernel exactly
 * instead of as a polyline of it.
 */
export interface ProfileBSpline {
  type: 'bspline';
  poles: Array<[number, number]>;
  /** One weight per pole; absent when the curve is not rational. */
  weights?: number[];
  degree: number;
  knots: number[];
  /** One multiplicity per knot. */
  multiplicities: number[];
  reversed?: boolean;
}

export type ProfileCurve =
  ProfileLine | ProfileArc | ProfileCircle | ProfileEllipse | ProfileBSpline;

export interface ProfileLoop {
  curves: ProfileCurve[];
  /**
   * Stable key of every curve, parallel to `curves`. The key comes from the
   * sketch topology and names the side face the curve sweeps into.
   */
  keys?: string[];
}

export interface ProfileRegion {
  /** Stable key of the sketch region, used to scope the names it creates. */
  key?: string;
  outer: ProfileLoop;
  holes: ProfileLoop[];
}

export interface MakePrismParams {
  shapeId: string;
  /** Scope of the operation, used for cap and side names. */
  name?: string;
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  regions: ProfileRegion[];
  /** Signed extrusion distances along the plane normal; one or two of them. */
  distances: number[];
  /**
   * How far the first sweep reaches back behind the plane, so a tool that
   * stands on a face shares material with the body instead of only touching
   * it. The overlap is part of the same prism, never a second one.
   */
  embed?: number;
}

export interface MakeFacePrismParams {
  shapeId: string;
  /** Scope of the operation, used for the names it creates. */
  name?: string;
  sourceShapeId: string;
  /** OCCT face traversal index, the same one tessellation reports in `faceIds`. */
  faceId: number;
  /** Outward normal of the face, captured by the viewport at pick time. */
  normal: Vec3;
  /** Signed extrusion distances along the normal. */
  distances: number[];
  /**
   * Whether the prism is a tool for a boolean rather than a body of its own.
   * A tool may reach a sliver behind its face so it overlaps what it joins.
   */
  embed?: boolean;
}

/** A line a revolve turns around: a point on it and its direction. */
export interface RevolveAxisLine {
  origin: Vec3;
  direction: Vec3;
}

export interface MakeRevolveParams {
  shapeId: string;
  /** Scope of the operation, used for cap and side names. */
  name?: string;
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  regions: ProfileRegion[];
  axis: RevolveAxisLine;
  /** Radians, right-handed around the axis: the profile turns from start to end. */
  startAngle: number;
  endAngle: number;
}

export interface MakeFaceRevolveParams {
  shapeId: string;
  /** Scope of the operation, used for the names it creates. */
  name?: string;
  sourceShapeId: string;
  faceId: number;
  axis: RevolveAxisLine;
  startAngle: number;
  endAngle: number;
}

export interface BooleanParams {
  shapeId: string;
  /** Scope of the operation, used for the faces it creates. */
  name?: string;
  baseShapeId: string;
  toolShapeId: string;
  op: 'fuse' | 'cut' | 'common';
  /** Give every result face this operation as its owner, as the app did before. */
  reown?: boolean;
  /**
   * Report which base face every result face came from. Faces an operation does
   * not touch keep their identity, so this is what tells a created face from a
   * face that was already there.
   */
  trackFaces?: boolean;
}

/**
 * The same boolean applied to many placements of the same tools in one go. OCCT
 * treats the placed tools as one set, which is several times faster than a
 * boolean per placement: an array of twenty bosses is one operation instead of
 * twenty.
 */
export interface BooleanAllParams {
  shapeId: string;
  /** Scope of the operation, used for the faces it creates. */
  name?: string;
  baseShapeId: string;
  /**
   * Each tool copied to where it applies. `key` scopes the names of the copy,
   * which is what keeps the copies of one array apart.
   */
  tools: Array<{ sourceShapeId: string; matrix: number[]; key?: string }>;
  op: 'fuse' | 'cut' | 'common';
  trackFaces?: boolean;
  reown?: boolean;
}

export interface EdgeTreatmentParams {
  shapeId: string;
  /** Scope of the operation, used for the faces it creates. */
  name?: string;
  /** Body the edges belong to. */
  sourceShapeId: string;
  kind: 'fillet' | 'chamfer';
  /** Faces whose boundary edges are treated. */
  faceIds: number[];
  /** Edge ids from the tessellation of the source shape. */
  edgeIds: string[];
  /** Requested radius (fillet) or leg distance (chamfer), in millimetres. */
  size: number;
}

export interface EdgeTreatmentResult {
  shapeId: string;
  stats: ShapeStats;
  /** Size the solid was actually built with; never above the request. */
  applied: number;
  /** Largest size that still produced a valid solid for this edge set. */
  limit: number;
  /** Source face index of every result face, or -1 for a treated one. */
  facesFromBase: number[];
  edgeCount: number;
}

export interface ShellParams {
  shapeId: string;
  /** Scope of the operation, used for the faces it creates. */
  name?: string;
  /** Body to hollow or wrap. */
  sourceShapeId: string;
  /** Give every result face this operation as its owner, as the app did before. */
  reown?: boolean;
  /** Faces of the body left open. */
  removeFaceIds: number[];
  thickness: number;
  /** Gap between the input surface and an outward shell; ignored inward. */
  offset: number;
  /** `inward` cuts a cavity, `outward` grows a body around the input. */
  direction: 'inward' | 'outward';
}

export interface OffsetShapeParams {
  shapeId: string;
  /** Scope of the operation, used for the faces it creates. */
  name?: string;
  /** Body whose surface is moved. */
  sourceShapeId: string;
  /**
   * Distance the surface moves along its own normal: positive grows the body,
   * negative shrinks it.
   */
  distance: number;
}

export interface ShellResult {
  shapeId: string;
  stats: ShapeStats;
  /** Thickness the wall was actually built with; never above the request. */
  applied: number;
  /**
   * For every face of the result, the index of the source face it is. An
   * inward shell keeps the outside of the body, so those faces stay owned by the
   * operation that made them; the new cavity faces report -1.
   */
  facesFromBase?: number[];
}

/**
 * Copies a shape at a placement. The matrix is a row-major 3x4 affine,
 * `a11 a12 a13 a14 a21 … a34`, which is the layout `gp_Trsf.SetValues` takes.
 */
export interface TransformShapeParams {
  shapeId: string;
  sourceShapeId: string;
  matrix: number[];
  /**
   * Instance scope prefixed to every name of the copy. An array stamp passes
   * `<arrayId>/<stamp>` so the copy answers to its own scoped names.
   */
  nameScope?: string;
  /** Owner to record on the copy; absent keeps the source owners. */
  owner?: string;
}

/** Asks where the middle of one face of a body is. */
export interface FaceCentreParams {
  shapeId: string;
  faceId: number;
  /**
   * Normal of the face, which fixes the plane to measure the face in. The
   * caller knows it from what it drew; the surface of the face may no longer say
   * it, because an offset re-stores a plane as a B-spline.
   */
  normal: Vec3;
}

export interface FaceCentreResult {
  /**
   * Middle of the face's extent in its own plane. Not the centre of mass: a
   * face with a notch or a hole has its mass centre off to one side, while a
   * turn around the face has to look centred.
   */
  origin: Vec3;
}

/** A body written into a STEP file: its kernel shape, name and colour. */
export interface StepBody {
  shapeId: string;
  name: string;
  /** `#rrggbb`, the colour the object has in the model. */
  color: string;
}

export interface ExportStepParams {
  bodies: StepBody[];
}

export interface ExportStepResult {
  /** Bytes of an AP214 STEP file. */
  data: Uint8Array;
}

/** One body found in a STEP file before it is built in the document. */
export interface StepBodyInfo {
  name: string;
  /** `#rrggbb`, or null when the file carries no colour for the body. */
  color: string | null;
}

export interface InspectStepParams {
  /** Bytes of the STEP file. */
  data: Uint8Array;
}

export interface InspectStepResult {
  bodies: StepBodyInfo[];
}

export interface ImportStepParams {
  data: Uint8Array;
  /** Kernel shape ids are `${prefix}:step-${index}`. */
  prefix: string;
  /** Scope of the import operation, used for face names. */
  name?: string;
}

export interface ImportStepBody {
  shapeId: string;
  stats: ShapeStats;
}

export interface ImportStepResult {
  bodies: ImportStepBody[];
}

export type KernelStatusPhase = 'loading-occt' | 'ready' | 'error';

export interface KernelStatusEvent {
  type: 'status';
  phase: KernelStatusPhase;
  ratio?: number;
  occtVersion?: string;
  loadMs?: number;
  message?: string;
}

export type KernelErrorCode =
  | 'SHAPE_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'FACE_NOT_PLANAR'
  | 'NO_EDGES'
  | 'EDGE_TREATMENT_FAILED'
  | 'SHELL_FAILED'
  | 'OFFSET_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'OP_FAILED';

export type KernelRequestPayload =
  | { type: 'health' }
  | { type: 'make-box'; params: BoxParams }
  | { type: 'make-primitive'; params: MakePrimitiveParams }
  | { type: 'make-prism'; params: MakePrismParams }
  | { type: 'make-face-prism'; params: MakeFacePrismParams }
  | { type: 'make-revolve'; params: MakeRevolveParams }
  | { type: 'make-face-revolve'; params: MakeFaceRevolveParams }
  | { type: 'boolean'; params: BooleanParams }
  | { type: 'boolean-all'; params: BooleanAllParams }
  | { type: 'split-solids'; params: SplitSolidsParams }
  | { type: 'edge-treatment'; params: EdgeTreatmentParams }
  | { type: 'shell'; params: ShellParams }
  | { type: 'offset-shape'; params: OffsetShapeParams }
  | { type: 'transform-shape'; params: TransformShapeParams }
  | { type: 'face-centre'; params: FaceCentreParams }
  | { type: 'export-step'; params: ExportStepParams }
  | { type: 'inspect-step'; params: InspectStepParams }
  | { type: 'import-step'; params: ImportStepParams }
  | { type: 'tessellate'; shapeId: string; quality?: TessellationQuality }
  | { type: 'topology'; shapeId: string }
  | { type: 'dispose'; shapeId: string };

export type KernelRequest = KernelRequestPayload & { id: number };

export interface KernelSuccess {
  id: number;
  ok: true;
  result: unknown;
}

export interface KernelFailure {
  id: number;
  ok: false;
  error: { code: KernelErrorCode; message: string };
}

export type KernelResponse = KernelSuccess | KernelFailure;
