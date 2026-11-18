import type { CameraDragMode } from './cameraControls';

/**
 * How a sketch sees the camera.
 *
 * A sketch is drawn flat, on its plane: a view that faces the plane is the only
 * one where a curve is a curve and not a foreshortened line. So while the camera
 * faces the plane, a gesture that would turn the view pans it instead — the
 * sheet moves, the plane does not tilt — and as soon as the view is taken off
 * the plane, by the nav cube or by any other turn, rotation is rotation again.
 */

/** How far the view may drift from the sketch normal and still face the plane. */
export const SKETCH_FACING_DEGREES = 2;

const DEGREES = Math.PI / 180;

/**
 * Whether a turntable view looks straight at a plane with this normal. The eye
 * sits along the normal when the sketch is aligned (`alignSketch`), so facing the
 * plane is the eye direction matching the normal.
 */
export function facesPlane(
  azimuth: number,
  polar: number,
  normal: readonly [number, number, number],
  tolerance = SKETCH_FACING_DEGREES * DEGREES,
): boolean {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return false;
  const dot =
    (Math.sin(polar) * Math.cos(azimuth) * normal[0] +
      Math.sin(polar) * Math.sin(azimuth) * normal[1] +
      Math.cos(polar) * normal[2]) /
    length;
  return dot >= Math.cos(tolerance);
}

/** What a turn of the camera does in a sketch: a facing view pans instead. */
export function sketchTurnMode(facing: boolean): CameraDragMode {
  return facing ? 'pan' : 'orbit';
}

type Vec3 = readonly [number, number, number];

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * The roll that puts the sketch's own Y axis up and its X axis to the right.
 * The turntable basis of a view along the plane normal has some arbitrary up;
 * rolling about the eye direction by this angle makes the sketch axes match the
 * screen axes, so a turned sketch opens the way it was drawn.
 */
export function sketchViewRoll(azimuth: number, polar: number, yAxis: Vec3): number {
  const eye: Vec3 = [
    Math.sin(polar) * Math.cos(azimuth),
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
  ];
  const upHint: Vec3 = Math.abs(Math.cos(polar)) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  const right = normalize(cross(upHint, eye));
  const up = normalize(cross(eye, right));
  const turn = cross(up, yAxis);
  return Math.atan2(
    turn[0] * eye[0] + turn[1] * eye[1] + turn[2] * eye[2],
    up[0] * yAxis[0] + up[1] * yAxis[1] + up[2] * yAxis[2],
  );
}
