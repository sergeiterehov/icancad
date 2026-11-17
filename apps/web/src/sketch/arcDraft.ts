import { unwrapAngle, type Point2 } from '@icancad/sketch';

export function arcStartAngle(origin: Point2, start: Point2): number {
  return Math.atan2(start[1] - origin[1], start[0] - origin[0]);
}

// The third point of an arc can cross the ±π branch of atan2. Keeping the end
// angle unwrapped against the previous one makes the sweep continue instead of
// flipping the arc to the opposite side.
export function arcDraftEndAngle(
  origin: Point2,
  start: Point2,
  end: Point2,
  previousEnd: number | null,
): number {
  const startAngle = arcStartAngle(origin, start);
  const wrapped = Math.atan2(end[1] - origin[1], end[0] - origin[0]);
  const unwrapped = unwrapAngle(wrapped, previousEnd ?? startAngle);
  // One turn is the most an arc can show; without the clamp, dragging all the
  // way around would keep stacking turns on top of each other.
  const sweep = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, unwrapped - startAngle));
  return startAngle + sweep;
}
