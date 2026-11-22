import { unwrapAngle, type Point2 } from '@icancad/sketch';

/** The ellipse an arc tool is drawing, in its own frame. */
export interface EllipticalArcFrame {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Turn of the local X axis, in radians. */
  rotation: number;
  startAngle: number;
}

function localPoint(point: Point2, center: Point2, rotation: number): Point2 {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [cos * dx + sin * dy, -sin * dx + cos * dy];
}

function parameterOf(
  point: Point2,
  center: Point2,
  rotation: number,
  rx: number,
  ry: number,
): number {
  const local = localPoint(point, center, rotation);
  return Math.atan2(local[1] / ry, local[0] / rx);
}

/**
 * The ellipse three points describe: the centre, the end of one semi-axis, and
 * a point whose distance from the other axis gives the second one. The second
 * semi-axis is always perpendicular to the first, so the two clicks after the
 * centre set the length and the turn of the ellipse.
 */
export function ellipseFrame(
  center: Point2,
  major: Point2,
  minor: Point2,
): EllipticalArcFrame | null {
  const rx = Math.hypot(major[0] - center[0], major[1] - center[1]);
  if (!(rx > 1e-4)) return null;
  const rotation = Math.atan2(major[1] - center[1], major[0] - center[0]);
  const ry = Math.abs(localPoint(minor, center, rotation)[1]);
  if (!(ry > 1e-4)) return null;
  return {
    cx: center[0],
    cy: center[1],
    rx,
    ry,
    rotation,
    startAngle: parameterOf(major, center, rotation, rx, ry),
  };
}

/** The frame the four clicks of an elliptical arc describe. */
export function ellipticalArcFrame(
  center: Point2,
  major: Point2,
  minor: Point2,
  start: Point2,
): EllipticalArcFrame | null {
  const frame = ellipseFrame(center, major, minor);
  if (!frame) return null;
  return {
    ...frame,
    startAngle: parameterOf(start, center, frame.rotation, frame.rx, frame.ry),
  };
}

/** The parameter angle of a point on the ellipse of the frame. */
export function ellipticalArcParameter(frame: EllipticalArcFrame, point: Point2): number {
  return parameterOf(point, [frame.cx, frame.cy], frame.rotation, frame.rx, frame.ry);
}

/**
 * The end angle of the pointer, kept on the branch of the previous frame so
 * crossing the -π cut continues the same sweep instead of flipping the arc.
 */
export function ellipticalArcEndAngle(
  frame: EllipticalArcFrame,
  point: Point2,
  previous: number | null,
): number {
  return unwrapAngle(ellipticalArcParameter(frame, point), previous ?? frame.startAngle);
}

export function ellipticalArcPoint(frame: EllipticalArcFrame, angle: number): Point2 {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const x = Math.cos(angle) * frame.rx;
  const y = Math.sin(angle) * frame.ry;
  return [frame.cx + x * cos - y * sin, frame.cy + x * sin + y * cos];
}

/**
 * Where the clicks of an ellipse or an elliptical arc land on the curve. The
 * clicks name the centre, both half-axes and the two ends; only the centre and
 * the first half-axis are on the curve where they were clicked, so the markers
 * would otherwise float off the shape until the entity is built.
 */
export function ellipseDraftPoints(
  draft: readonly Point2[],
  frame: EllipticalArcFrame | null,
): Point2[] {
  if (!frame || draft.length < 2) return [...draft];
  const points: Point2[] = [draft[0]!, ellipticalArcPoint(frame, 0)];
  // The second half-axis is clicked anywhere on its line; only its distance
  // matters, so the handle sits at the end of the axis.
  if (draft.length >= 3) points.push(ellipticalArcPoint(frame, Math.PI / 2));
  if (draft.length >= 4) points.push(ellipticalArcPoint(frame, frame.startAngle));
  return points;
}
