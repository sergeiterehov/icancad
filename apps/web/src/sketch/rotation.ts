import type { SketchFrame, Vec3 } from '@icancad/model';
import { rotateVector, type SketchRotationAngles } from '@icancad/sketch';

/** A rotation ring: the grip turns around `axis`, starting at `reference`. */
export interface SketchRotationRing {
  axis: Vec3;
  reference: Vec3;
  /** Right-handed angle of the grip, in radians. */
  angle: number;
}

/**
 * The three rings of a rotation gizmo, in X, Y and Z order. Each one rides the
 * axis of the frame as the previous turns left it, so the rings show the axes
 * the angles are applied around rather than a fixed world basis.
 */
export function sketchRotationRings(
  frame: SketchFrame,
  angles: SketchRotationAngles,
): SketchRotationRing[] {
  const radians = Math.PI / 180;
  const [x, y, z] = angles;
  const x1 = frame.xAxis;
  const y1 = rotateVector(frame.yAxis, frame.xAxis, x * radians);
  const z1 = rotateVector(frame.normal, frame.xAxis, x * radians);
  const x2 = rotateVector(x1, y1, y * radians);
  const z2 = rotateVector(z1, y1, y * radians);
  return [
    { axis: x1, reference: frame.yAxis, angle: x * radians },
    { axis: y1, reference: z1, angle: y * radians },
    { axis: z2, reference: x2, angle: z * radians },
  ];
}
