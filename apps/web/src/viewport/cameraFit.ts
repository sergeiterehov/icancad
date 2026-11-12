export const FIT_MARGIN_PX = 50;

export const CAMERA_FOV_DEGREES = 35;

/** Ground grid and sketch-plane caps reach beyond the model. */
export const CAMERA_REACH = 5000;

/**
 * Eye distance and depth range for an orthographic view. Zoom changes only the
 * frustum size, so the eye keeps a constant clearance behind the content:
 * following the zoom with the eye would move it inside the model, where the
 * near plane clips exactly what is being inspected.
 */
export function cameraFrustum(
  distance: number,
  radius: number,
): { eye: number; near: number; far: number } {
  const span = Math.max(radius, 1);
  const eye = Math.max(distance, 0.01) + span * 2;
  return {
    eye,
    near: Math.max(0.01, distance * 0.001),
    far: eye + span * 2 + CAMERA_REACH,
  };
}

// Distance at which content of the given size fits the viewport with a fixed
// margin on every side. Content is measured in camera right/up units.
export function fitDistance(
  spanU: number,
  spanV: number,
  width: number,
  height: number,
  marginPx = FIT_MARGIN_PX,
  fovDegrees = CAMERA_FOV_DEGREES,
): number {
  const tan = Math.tan((fovDegrees * Math.PI) / 180 / 2);
  const usableWidth = Math.max(1, width - marginPx * 2);
  const usableHeight = Math.max(1, height - marginPx * 2);
  const aspect = width / height;
  const forHeight = (spanV * height) / (2 * tan * usableHeight);
  const forWidth = (spanU * width) / (2 * tan * aspect * usableWidth);
  return Math.max(forHeight, forWidth, 0.05);
}

// Ease in / ease out (cubic) for every animated camera move.
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// Rotation always takes the shorter arc so 350° → 10° does not spin the model.
export function shortestAngle(from: number, to: number): number {
  const turn = Math.PI * 2;
  let delta = (((to - from) % turn) + turn) % turn;
  if (delta > Math.PI) delta -= turn;
  return delta;
}
