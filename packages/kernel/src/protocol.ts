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
}

export interface MakeBoxResult {
  shapeId: string;
  stats: ShapeStats;
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
  | 'NOT_IMPLEMENTED'
  | 'OP_FAILED';

export type KernelRequestPayload =
  | { type: 'health' }
  | { type: 'make-box'; params: BoxParams }
  | { type: 'tessellate'; shapeId: string; quality?: TessellationQuality }
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
