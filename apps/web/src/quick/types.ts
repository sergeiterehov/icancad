import type { ExtrudeFeature, Vec3 } from '@icancad/model';

/** The element a quick operation is attached to. */
export type QuickTarget =
  | { kind: 'body-face'; bodyId: string; faceIds: string[] }
  | { kind: 'sketch'; sketchId: string; /** Empty means the whole sketch. */ regions: string[] };

export interface QuickFace {
  faceId: string;
  centroid: Vec3;
  /** Outward normal, verified against the material. */
  normal: Vec3;
}

export interface QuickTargetGeometry {
  target: QuickTarget;
  /** Where the handle sits and the positive drag direction. */
  origin: Vec3;
  direction: Vec3;
  /** Selected body faces, in selection order. */
  faces: QuickFace[];
  /** World points inside the sketch profile, used to predict the method. */
  samples: Vec3[];
  /** Body whose face hosts the sketch, when the sketch is bound to a face. */
  preferredBodyId?: string;
}

export type PredictedExtrudeOp = ExtrudeFeature['op'];

export interface ExtrudePrediction {
  op: PredictedExtrudeOp;
  /** Bodies the operation combines with; empty for a new body. */
  bodyIds: string[];
}

export function quickTargetKey(target: QuickTarget): string {
  return target.kind === 'body-face'
    ? `bf:${target.bodyId}:${target.faceIds.join(',')}`
    : `sk:${target.sketchId}:${target.regions.join(',')}`;
}
