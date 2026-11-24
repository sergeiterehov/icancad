import type { SketchEntity } from '@icancad/model';
import { normalizeAngle, type Point2 } from './index';
import type { SketchEntityDraft } from './projection';

/**
 * Rounding a corner of two straight lines.
 *
 * A fillet replaces the corner with an arc of the requested radius that is
 * tangent to both lines, and the lines are shortened to where they now meet the
 * arc. Only lines take part: an arc or a Bezier corner needs its own tangent
 * search, which is a later step.
 *
 * The geometry here is exact — the tangent points, the centre and the sweep are
 * computed, not fitted — so the sketch keeps lines and arcs it can constrain.
 */

/** Two points closer than this are one point. */
const CORNER_TOLERANCE = 1e-3;

export type FilletFailure = 'selection' | 'not-connected' | 'collinear' | 'radius' | 'too-large';

export interface FilletSelection {
  /** The two lines that meet. */
  first: SketchEntity;
  second: SketchEntity;
  /** The shared corner the two lines meet at. */
  corner: Point2;
  /** Unit direction from the corner along each line, towards its far end. */
  firstDirection: Point2;
  secondDirection: Point2;
  /** Angle between those directions, in radians (0…π). */
  angle: number;
  /** Length of each line. */
  firstLength: number;
  secondLength: number;
}

export interface FilletShape {
  /** The arc that replaces the corner, from the first line to the second. */
  arc: Extract<SketchEntityDraft, { type: 'arc' }>;
  /** The two lines, shortened to the tangent points. */
  first: SketchEntity;
  second: SketchEntity;
  /** Which end of each line the trim moved: 0 for its start, 1 for its end. */
  firstEnd: 0 | 1;
  secondEnd: 0 | 1;
  radius: number;
  /** Where the arc meets the first and the second line. */
  firstJoint: Point2;
  secondJoint: Point2;
}

/** What the selection asks the fillet to round. */
export interface FilletCornerSearch {
  /** Every line of the sketch: a corner is rounded with both of its lines. */
  lines: readonly SketchEntity[];
  /** Lines whose ends are corners, selected one by one. */
  lineIds?: readonly string[];
  /** Points that are corners themselves. */
  points?: readonly Point2[];
}

function lineEnds(entity: SketchEntity): [Point2, Point2] | null {
  if (entity.type !== 'line') return null;
  return [
    [entity.x1, entity.y1],
    [entity.x2, entity.y2],
  ];
}

function distance(first: Point2, second: Point2): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function unit(from: Point2, to: Point2): Point2 | null {
  return normalize([to[0] - from[0], to[1] - from[1]]);
}

function normalize(vector: Point2): Point2 | null {
  const length = Math.hypot(vector[0], vector[1]);
  return length < 1e-12 ? null : [vector[0] / length, vector[1] / length];
}

/**
 * The corner two selected lines share: the point where they meet, and where
 * each of them goes from there. A selection without exactly two lines that
 * touch at one end has no corner to round.
 */
export function findFilletCorner(
  lines: readonly SketchEntity[],
): FilletSelection | { error: FilletFailure } {
  if (lines.length !== 2) return { error: 'selection' };
  const [first, second] = lines as [SketchEntity, SketchEntity];
  const firstEnds = lineEnds(first);
  const secondEnds = lineEnds(second);
  if (!firstEnds || !secondEnds) return { error: 'selection' };

  let corner: Point2 | null = null;
  let firstFar: Point2 | null = null;
  let secondFar: Point2 | null = null;
  for (const [index, point] of firstEnds.entries()) {
    for (const [other, candidate] of secondEnds.entries()) {
      if (distance(point, candidate) > CORNER_TOLERANCE) continue;
      corner = point;
      firstFar = firstEnds[1 - index]!;
      secondFar = secondEnds[1 - other]!;
    }
  }
  if (!corner || !firstFar || !secondFar) return { error: 'not-connected' };

  const firstDirection = unit(corner, firstFar);
  const secondDirection = unit(corner, secondFar);
  if (!firstDirection || !secondDirection) return { error: 'not-connected' };
  const dot = Math.min(
    1,
    Math.max(-1, firstDirection[0] * secondDirection[0] + firstDirection[1] * secondDirection[1]),
  );
  const angle = Math.acos(dot);
  // A corner has to turn: two lines in one direction have no corner at all.
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return { error: 'collinear' };

  return {
    first,
    second,
    corner,
    firstDirection,
    secondDirection,
    angle,
    firstLength: distance(corner, firstFar),
    secondLength: distance(corner, secondFar),
  };
}

/**
 * Every corner a selection describes: a selected line brings its own ends, a
 * selected point is a corner, and each one is rounded with the line that meets
 * it there — that line does not have to be selected. A junction of three or
 * more lines is skipped: there is no telling which pair the arc would replace.
 */
export function findFilletCorners(search: FilletCornerSearch): FilletSelection[] {
  const { lines } = search;
  const byId = new Map(lines.map((line) => [line.id, line]));
  const corners: Point2[] = [...(search.points ?? [])];
  for (const id of search.lineIds ?? []) {
    const line = byId.get(id);
    const ends = line ? lineEnds(line) : null;
    if (ends) corners.push(...ends);
  }

  // The lines that end somewhere are bucketed by the cell their end falls in,
  // so a corner is completed from its neighbourhood and not from a scan of the
  // whole sketch: this runs on every pointer move.
  const cells = new Map<string, SketchEntity[]>();
  for (const line of lines) {
    for (const end of lineEnds(line) ?? []) {
      const key = cellKey(end);
      const bucket = cells.get(key);
      if (bucket) bucket.push(line);
      else cells.set(key, [line]);
    }
  }
  const touching = (corner: Point2, out: Map<string, SketchEntity>) => {
    out.clear();
    for (const key of neighbourhood(corner)) {
      for (const line of cells.get(key) ?? []) out.set(line.id, line);
    }
    return [...out.values()].filter((line) =>
      lineEnds(line)?.some((end) => distance(end, corner) <= CORNER_TOLERANCE),
    );
  };

  const found: FilletSelection[] = [];
  const seen = new Set<string>();
  const near = new Map<string, SketchEntity>();
  for (const corner of corners) {
    const meeting = touching(corner, near);
    if (meeting.length !== 2) continue;
    const selection = findFilletCorner(meeting);
    if ('error' in selection) continue;
    const key = `${meeting
      .map((line) => line.id)
      .sort()
      .join('|')}@${selection.corner.map((value) => value.toFixed(4)).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(selection);
  }
  return found;
}

/** The cell an end falls in, at the tolerance the corner search works to. */
function cellKey(point: Point2): string {
  return `${Math.floor(point[0] / CORNER_TOLERANCE)},${Math.floor(point[1] / CORNER_TOLERANCE)}`;
}

/** The cells a corner can reach: its own and its eight neighbours. */
function neighbourhood(point: Point2): string[] {
  const x = Math.floor(point[0] / CORNER_TOLERANCE);
  const y = Math.floor(point[1] / CORNER_TOLERANCE);
  const keys: string[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) keys.push(`${x + dx},${y + dy}`);
  }
  return keys;
}

/**
 * The radius a pointer describes. The pointer rides the middle of the arc, so
 * dragging away from the corner grows the fillet by exactly what is seen: the
 * arc's middle stands `R · (1/sin(θ/2) − 1)` off the corner.
 */
export function radiusAtPointer(selection: FilletSelection, pointer: Point2): number {
  const sine = Math.sin(selection.angle / 2);
  // A corner that is all but flat has no arc to ride: the pointer cannot make
  // one that fits, and the shape refuses it on its own terms.
  const rise = Math.max(1 - sine, 0.02);
  return Math.max(0, (distance(selection.corner, pointer) * sine) / rise);
}

/**
 * The arc of a corner and the two lines shortened to it.
 *
 * The tangent points sit at `R / tan(θ/2)` from the corner along each line, and
 * the centre on the bisector at `R / sin(θ/2)`. A radius whose tangent points
 * would run past the far end of a line cannot be cut out of these lines, and
 * says so instead of drawing a corner that is not there.
 */
export function filletShape(
  selection: FilletSelection,
  radius: number,
): FilletShape | { error: FilletFailure } {
  if (!Number.isFinite(radius) || radius < 1e-6) return { error: 'radius' };
  const trim = radius / Math.tan(selection.angle / 2);
  if (trim > selection.firstLength || trim > selection.secondLength) return { error: 'too-large' };

  const { corner, firstDirection, secondDirection, angle } = selection;
  const firstJoint: Point2 = [
    corner[0] + firstDirection[0] * trim,
    corner[1] + firstDirection[1] * trim,
  ];
  const secondJoint: Point2 = [
    corner[0] + secondDirection[0] * trim,
    corner[1] + secondDirection[1] * trim,
  ];
  // The centre sits on the bisector, half an angle away from both lines: a
  // vector, not a point, so it is normalised on its own and not from the corner.
  const bisector = normalize([
    firstDirection[0] + secondDirection[0],
    firstDirection[1] + secondDirection[1],
  ]);
  if (!bisector) return { error: 'collinear' };
  const centreDistance = radius / Math.sin(angle / 2);
  const centre: Point2 = [
    corner[0] + bisector[0] * centreDistance,
    corner[1] + bisector[1] * centreDistance,
  ];

  const startAngle = Math.atan2(firstJoint[1] - centre[1], firstJoint[0] - centre[0]);
  const endAngle = Math.atan2(secondJoint[1] - centre[1], secondJoint[0] - centre[0]);
  // The arc spans π − θ, so the short way round is the one that bulges towards
  // the corner; the other half turn would wrap through the shape.
  const ccwSweep = normalizeAngle(endAngle - startAngle);
  const sweep = ccwSweep > Math.PI ? ccwSweep - Math.PI * 2 : ccwSweep;

  return {
    arc: {
      type: 'arc',
      construction: selection.first.construction && selection.second.construction,
      cx: centre[0],
      cy: centre[1],
      r: radius,
      startAngle,
      endAngle: startAngle + sweep,
    },
    first: trimLine(selection.first, corner, firstJoint),
    second: trimLine(selection.second, corner, secondJoint),
    firstEnd: endAt(selection.first, corner),
    secondEnd: endAt(selection.second, corner),
    radius,
    firstJoint,
    secondJoint,
  };
}

/** Which end of a line stands at the corner. */
function endAt(entity: SketchEntity, corner: Point2): 0 | 1 {
  if (entity.type !== 'line') return 0;
  return distance([entity.x1, entity.y1], corner) <= distance([entity.x2, entity.y2], corner)
    ? 0
    : 1;
}

/** The line with the end that stood at the corner moved to the tangent point. */
function trimLine(entity: SketchEntity, corner: Point2, tangent: Point2): SketchEntity {
  if (entity.type !== 'line') return entity;
  return endAt(entity, corner) === 0
    ? { ...entity, x1: tangent[0], y1: tangent[1] }
    : { ...entity, x2: tangent[0], y2: tangent[1] };
}
