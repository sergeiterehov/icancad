import type { Vec3 } from '@icancad/model';

export interface TessellationQuality {
  linearDeflection: number;
  angularDeflection: number;
}

export const DEFAULT_TESSELLATION_QUALITY: TessellationQuality = {
  linearDeflection: 0.1,
  angularDeflection: 0.5,
};

export interface TessellationResult {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceIds: Uint32Array;
  triangleCount: number;
  vertexCount: number;
  bbox: { min: Vec3; max: Vec3 };
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
  | 'NOT_IMPLEMENTED'
  | 'OP_FAILED';

export type KernelRequestPayload =
  | { type: 'health' }
  | { type: 'make-box'; params: BoxParams }
  | { type: 'make-prism'; params: MakePrismParams }
  | { type: 'make-face-prism'; params: MakeFacePrismParams }
  | { type: 'boolean'; params: BooleanParams }
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
