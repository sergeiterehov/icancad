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
