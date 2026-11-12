import type { Vec3 } from '@icancad/model';

export interface TessellationQuality {
  linearDeflection: number;
  angularDeflection: number;
}

export const DEFAULT_TESSELLATION_QUALITY: TessellationQuality = {
  linearDeflection: 0.1,
  angularDeflection: 0.5,
};

/**
 * A B-rep edge of a tessellated body. Edges shared by the same two faces are
 * merged into one polyline, so seams inside a single face stay out. Ids follow
 * the deterministic face/edge traversal of the shape, which is what a future
 * fillet or chamfer needs to address the same edge.
 */
export interface BodyEdge {
  id: string;
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
}

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

export type ProfileCurve = ProfileLine | ProfileArc | ProfileCircle;

export interface ProfileLoop {
  curves: ProfileCurve[];
}

export interface ProfileRegion {
  outer: ProfileLoop;
  holes: ProfileLoop[];
}

export interface MakePrismParams {
  shapeId: string;
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  regions: ProfileRegion[];
  /** Signed extrusion distances along the plane normal; one or two of them. */
  distances: number[];
}

export interface MakeFacePrismParams {
  shapeId: string;
  sourceShapeId: string;
  /** OCCT face traversal index, the same one tessellation reports in `faceIds`. */
  faceId: number;
  /** Outward normal of the face, captured by the viewport at pick time. */
  normal: Vec3;
  /** Signed extrusion distances along the normal. */
  distances: number[];
}

export interface BooleanParams {
  shapeId: string;
  baseShapeId: string;
  toolShapeId: string;
  op: 'fuse' | 'cut' | 'common';
  /**
   * Report which base face every result face came from. Faces an operation does
   * not touch keep their identity, so this is what tells a created face from a
   * face that was already there.
   */
  trackFaces?: boolean;
}

export interface EdgeTreatmentParams {
  shapeId: string;
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
  | 'NOT_IMPLEMENTED'
  | 'OP_FAILED';

export type KernelRequestPayload =
  | { type: 'health' }
  | { type: 'make-box'; params: BoxParams }
  | { type: 'make-prism'; params: MakePrismParams }
  | { type: 'make-face-prism'; params: MakeFacePrismParams }
  | { type: 'boolean'; params: BooleanParams }
  | { type: 'split-solids'; params: SplitSolidsParams }
  | { type: 'edge-treatment'; params: EdgeTreatmentParams }
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
