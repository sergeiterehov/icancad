import type { TessellationResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { pointInMesh, probeDistance } from './geometry';
import type { ExtrudePrediction } from './types';

/** A face belongs to a body, so the drag side alone decides join or cut. */
export function predictBodyFaceOp(sign: number, bodyId: string): ExtrudePrediction {
  return sign < 0 ? { op: 'subtract', bodyIds: [bodyId] } : { op: 'add', bodyIds: [bodyId] };
}

export interface SketchPredictionInput {
  bodies: ReadonlyArray<{ id: string; mesh: TessellationResult }>;
  /** World points inside the profile at the sketch plane. */
  samples: readonly Vec3[];
  /** Unit direction of the drag, already signed. */
  direction: Vec3;
  /** Body of the face the sketch is drawn on, when there is one. */
  preferredBodyId?: string;
  /** Sign of the drag along the sketch's outward normal. */
  sign: number;
}

interface Evidence {
  bodyId: string;
  cut: number;
  join: number;
}

function normalize(direction: Vec3): Vec3 {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length <= 1e-9) return [0, 0, 1];
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

/**
 * The method is what the extrusion would do to the existing model: material
 * ahead of the profile means a cut, a profile sitting on a surface means a
 * join, and neither means a new body. Cut wins when both have evidence.
 */
export function predictSketchOp(input: SketchPredictionInput): ExtrudePrediction {
  const { samples } = input;
  if (samples.length === 0) return { op: 'new', bodyIds: [] };
  const direction = normalize(input.direction);
  const majority = Math.ceil(samples.length / 2);
  const evidence: Evidence[] = [];

  for (const body of input.bodies) {
    const epsilon = Math.max(0.01, probeDistance(body.mesh) * 0.5);
    let cut = 0;
    let join = 0;
    for (const sample of samples) {
      const before: Vec3 = [
        sample[0] - direction[0] * epsilon,
        sample[1] - direction[1] * epsilon,
        sample[2] - direction[2] * epsilon,
      ];
      const after: Vec3 = [
        sample[0] + direction[0] * epsilon,
        sample[1] + direction[1] * epsilon,
        sample[2] + direction[2] * epsilon,
      ];
      if (pointInMesh(body.mesh, after)) cut += 1;
      else if (pointInMesh(body.mesh, before)) join += 1;
    }
    if (cut > 0 || join > 0) evidence.push({ bodyId: body.id, cut, join });
  }

  const pick = (field: 'cut' | 'join'): Evidence | null => {
    const candidates = evidence.filter((entry) => entry[field] >= majority);
    if (candidates.length === 0) return null;
    const preferred = candidates.find((entry) => entry.bodyId === input.preferredBodyId);
    if (preferred) return preferred;
    return candidates.sort((left, right) => right[field] - left[field])[0] ?? null;
  };

  const cut = pick('cut');
  if (cut) return { op: 'subtract', bodyIds: [cut.bodyId] };
  const join = pick('join');
  if (join) return { op: 'add', bodyIds: [join.bodyId] };
  // A sketch drawn on a face always has a host body, even when most of the
  // profile hangs past the face and the probes cannot see material.
  if (input.preferredBodyId) {
    return input.sign < 0
      ? { op: 'subtract', bodyIds: [input.preferredBodyId] }
      : { op: 'add', bodyIds: [input.preferredBodyId] };
  }
  return { op: 'new', bodyIds: [] };
}
