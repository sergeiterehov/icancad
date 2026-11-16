import type { TessellationResult } from '@icancad/kernel';
import type { ArrayDirection, ArrayPath, SketchFeature, SketchFrame, Vec3 } from '@icancad/model';
import { sketchPointToWorld, tessellateEntity } from '@icancad/sketch';
import {
  arrayCombinations,
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  translationMatrix,
  type Matrix3x4,
} from './array';

/** Copies one array may make; matches the ceiling of the count field. */
export const MAX_ARRAY_COPIES = 120;

/** A rotation turns at most one full circle, in either direction. */
export const MAX_ARRAY_ANGLE = 360;

/** Whether a rotation closes on itself: a full turn has no copy at its end. */
export function isFullTurn(angle: number): boolean {
  return Math.abs(Math.abs(angle) - MAX_ARRAY_ANGLE) < 1e-6;
}

/**
 * The angle from one copy to the next. A full turn is a ring, so its copies
 * divide the circle itself: two copies at 360° sit at 0° and 180°, not at 0° and
 * 360°, which would put the last one on the first. Anything less than a full
 * turn spans its angle over the gaps, so the last copy lands on the angle.
 */
export function rotationStepDegrees(angle: number, count: number): number {
  if (count <= 1) return 0;
  return angle / (isFullTurn(angle) ? count : count - 1);
}

/** Two ends closer than this are the same point, in millimetres. */
export const PATH_JOIN_TOLERANCE = 1e-3;

/**
 * What a direction needs to be placed: the meshes for a body edge, and the
 * sketches the user drew for an axis or a path. The rebuild has all of it as
 * state, and the panel and the grips read the same thing from the stores.
 */
export interface ArrayPlacementContext {
  meshes: Record<string, TessellationResult>;
  sketches: readonly SketchFeature[];
  frames?: Record<string, SketchFrame>;
}

/** A run of world-space points the copies can follow. */
export interface PathPolyline {
  points: Vec3[];
  closed: boolean;
}

export function samePoint(a: Vec3, b: Vec3, tolerance = PATH_JOIN_TOLERANCE): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tolerance;
}

/**
 * The curve of one picked path as a world-space polyline. Curves that close on
 * themselves keep their closing point, so a ring reads as closed.
 */
export function pathPolyline(path: ArrayPath, context: ArrayPlacementContext): PathPolyline {
  if (path.kind === 'body-edge') {
    const mesh = context.meshes[path.bodyId];
    const edge = mesh?.edges?.find((candidate) => candidate.id === path.edgeId);
    if (!edge || edge.points.length < 6) throw new Error('ARRAY_PATH_MISSING');
    const points: Vec3[] = [];
    for (let index = 0; index < edge.points.length; index += 3) {
      points.push([edge.points[index]!, edge.points[index + 1]!, edge.points[index + 2]!]);
    }
    return { points, closed: edge.closed };
  }
  const sketch = context.sketches.find((candidate) => candidate.id === path.sketchId);
  const frame = context.frames?.[path.sketchId];
  if (!sketch || !frame) throw new Error('ARRAY_PATH_MISSING');
  const entity = sketch.entities.find((candidate) => candidate.id === path.entityId);
  if (!entity) throw new Error('ARRAY_PATH_MISSING');
  const closed =
    entity.type === 'circle' ||
    entity.type === 'ellipse' ||
    (entity.type === 'bezier' &&
      Math.hypot(
        entity.points[0]![0] - entity.points[entity.points.length - 1]![0],
        entity.points[0]![1] - entity.points[entity.points.length - 1]![1],
      ) < 1e-6);
  const points = tessellateEntity(entity, 96);
  if (points.length < 2) throw new Error('ARRAY_PATH_MISSING');
  const world = points.map((point) => sketchPointToWorld(frame, point));
  if (closed) world.push(world[0]!);
  return { points: world, closed };
}

/**
 * The picked curves joined into one chain, in the order that makes them meet
 * end to end. Null means the set does not form a single run, which the caller
 * reports instead of repeating the copies over a broken route.
 */
export function chainPolyline(
  paths: readonly ArrayPath[],
  context: ArrayPlacementContext,
): PathPolyline | null {
  if (paths.length === 0) return null;
  const curves = paths.map((path) => pathPolyline(path, context).points);
  let points = [...curves[0]!];
  const queue = curves.slice(1);
  while (queue.length > 0) {
    const head = points[0]!;
    const tail = points[points.length - 1]!;
    let used = -1;
    for (const [index, candidate] of queue.entries()) {
      const start = candidate[0]!;
      const end = candidate[candidate.length - 1]!;
      if (samePoint(tail, start)) points = [...points, ...candidate.slice(1)];
      else if (samePoint(tail, end)) points = [...points, ...[...candidate].reverse().slice(1)];
      else if (samePoint(head, end)) points = [...candidate.slice(0, -1), ...points];
      else if (samePoint(head, start)) {
        points = [...[...candidate].reverse().slice(0, -1), ...points];
      } else continue;
      used = index;
      break;
    }
    // A curve that meets neither end leaves the run broken wherever it is put.
    if (used < 0) return null;
    queue.splice(used, 1);
  }
  const closed = points.length > 2 && samePoint(points[0]!, points[points.length - 1]!);
  return { points, closed };
}

export function polylineDistances(points: readonly Vec3[]): number[] {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    cumulative.push(
      cumulative[index - 1]! +
        Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]),
    );
  }
  return cumulative;
}

export function polylineLength(points: readonly Vec3[]): number {
  const cumulative = polylineDistances(points);
  return cumulative[cumulative.length - 1] ?? 0;
}

export function pointAtDistance(
  points: readonly Vec3[],
  cumulative: readonly number[],
  distance: number,
): Vec3 {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const target = Math.min(Math.max(distance, 0), total);
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index]! < target) index += 1;
  const previous = points[index - 1]!;
  const point = points[index]!;
  const span = cumulative[index]! - cumulative[index - 1]!;
  const t = span > 1e-12 ? (target - cumulative[index - 1]!) / span : 0;
  return [
    previous[0] + (point[0] - previous[0]) * t,
    previous[1] + (point[1] - previous[1]) * t,
    previous[2] + (point[2] - previous[2]) * t,
  ];
}

/** A point of the polyline at `t` of its length, and the direction it runs in. */
export function pointAlongPath(path: PathPolyline, t: number): { point: Vec3; tangent: Vec3 } {
  const cumulative = polylineDistances(path.points);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const distance = Math.max(0, Math.min(1, t)) * total;
  const point = pointAtDistance(path.points, cumulative, distance);
  const ahead = pointAtDistance(path.points, cumulative, Math.min(total, distance + 0.5));
  const behind = pointAtDistance(path.points, cumulative, Math.max(0, distance - 0.5));
  const tangent: Vec3 = [ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]];
  const length = Math.hypot(tangent[0], tangent[1], tangent[2]);
  return {
    point,
    tangent:
      length < 1e-9 ? [1, 0, 0] : [tangent[0] / length, tangent[1] / length, tangent[2] / length],
  };
}

export function clampArrayCount(count: number): number {
  return Math.max(1, Math.min(MAX_ARRAY_COPIES, Math.floor(count)));
}

/**
 * The world axis a tilted straight direction turns around: a horizontal
 * direction tilts inside the horizontal plane and a vertical one inside the
 * plane of X, so any two directions of a grid can meet at any angle.
 */
export function tiltAxisOf(direction: Vec3): Vec3 {
  const [x, y, z] = direction;
  return Math.abs(z) >= Math.abs(x) && Math.abs(z) >= Math.abs(y)
    ? [1, 0, 0]
    : [0, 0, 1];
}

/** `direction` turned by `angle` degrees around the hinge of `tiltAxisOf`. */
export function tiltedDirection(direction: Vec3, angle: number): Vec3 {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length < 1e-9) throw new Error('ARRAY_DIRECTION_MISSING');
  const unit: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
  if (!Number.isFinite(angle) || Math.abs(angle) < 1e-9) return unit;
  const axis = tiltAxisOf(unit);
  const radians = (angle * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const turn = cross(axis, unit);
  const along = axis[0] * unit[0] + axis[1] * unit[1] + axis[2] * unit[2];
  return [
    unit[0] * cosine + turn[0] * sine + axis[0] * along * (1 - cosine),
    unit[1] * cosine + turn[1] * sine + axis[1] * along * (1 - cosine),
    unit[2] * cosine + turn[2] * sine + axis[2] * along * (1 - cosine),
  ];
}

/** The copies of one linear direction: translations along its unit vector. */
function linearMatrices(
  direction: Extract<ArrayDirection, { kind: 'linear' }>,
  count: number,
): Matrix3x4[] {
  const unit = tiltedDirection(direction.direction, direction.angle ?? 0);
  return Array.from({ length: count }, (_, index) =>
    translationMatrix([
      unit[0] * direction.spacing * index,
      unit[1] * direction.spacing * index,
      unit[2] * direction.spacing * index,
    ]),
  );
}

const AXIS_DIRECTIONS: Record<'x' | 'y' | 'z', Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function unit(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The line a rotation direction turns around, in world space.
 *
 * A world axis runs through the centre of the model: the copies swing around it
 * at whatever distance they happen to be, so the freedom is the angle and the
 * count only. A picked face turns them around its normal, through the centre of
 * the face.
 */
export function rotationAxisOf(
  direction: Extract<ArrayDirection, { kind: 'rotation' }>,
): { origin: Vec3; direction: Vec3 } | null {
  const axis = direction.axis;
  if (axis.kind === 'world') {
    return { origin: [0, 0, 0], direction: AXIS_DIRECTIONS[axis.axis] };
  }
  // A face of a body and a region of a sketch both store the centre and the
  // normal they were picked with, so the turn is the same line either way.
  const normal = unit(axis.normal);
  if (!normal) return null;
  return { origin: axis.origin, direction: normal };
}

/**
 * The angle the copies of a rotation actually turn by: the span of the direction
 * is always positive, and `inverted` is what turns it the other way round.
 */
export function rotationSpan(direction: Extract<ArrayDirection, { kind: 'rotation' }>): number {
  const span = Math.max(0, Math.min(MAX_ARRAY_ANGLE, Math.abs(direction.angle)));
  return direction.inverted ? -span : span;
}

/**
 * The placements of one direction, the seed (`0`) first. A rotation spans its
 * whole angle over the copies asked for, so the step is the angle divided by
 * the gaps between them.
 */
export function directionMatrices(
  direction: ArrayDirection,
  context: ArrayPlacementContext,
): Matrix3x4[] {
  const count = clampArrayCount(direction.count);
  if (direction.kind === 'linear') return linearMatrices(direction, count);
  if (direction.kind === 'rotation') {
    const axis = rotationAxisOf(direction);
    if (!axis) throw new Error('ARRAY_AXIS_MISSING');
    const span = rotationSpan(direction);
    // A turn of nothing would stack every copy on the seed.
    if (Math.abs(span) < 1e-6) throw new Error('ARRAY_ANGLE_EMPTY');
    const step = (rotationStepDegrees(span, count) * Math.PI) / 180;
    return Array.from({ length: count }, (_, index) =>
      rotationMatrix(axis.origin, axis.direction, step * index),
    );
  }
  if (direction.paths.length === 0) throw new Error('ARRAY_PATH_MISSING');
  const path = chainPolyline(direction.paths, context);
  if (!path) throw new Error('ARRAY_PATH_BROKEN');
  const total = polylineLength(path.points);
  if (total < 1e-6) throw new Error('ARRAY_PATH_EMPTY');
  const cumulative = polylineDistances(path.points);
  const start = path.points[0]!;
  return Array.from({ length: count }, (_, index) => {
    // A closed path puts the last copy before the start, so the ring has no
    // doubled body where it closes.
    const t = count === 1 ? 0 : index / (path.closed ? count : count - 1);
    const point = pointAtDistance(path.points, cumulative, total * t);
    return translationMatrix([point[0] - start[0], point[1] - start[1], point[2] - start[2]]);
  });
}

/**
 * Every placement of an array but the seed. Directions nest: the matrix of a
 * combination is the product of its directions, first direction innermost.
 */
export function arrayPlacementMatrices(
  counts: readonly number[],
  perDirection: ReadonlyArray<readonly Matrix3x4[]>,
): Array<{ key: string; matrix: Matrix3x4 }> {
  return arrayCombinations(counts)
    .filter((combination) => combination.indices.some((index) => index !== 0))
    .map((combination) => {
      let matrix = IDENTITY_MATRIX;
      for (let step = 0; step < perDirection.length; step += 1) {
        matrix = multiplyMatrices(perDirection[step]![combination.indices[step]!]!, matrix);
      }
      return { key: combination.key, matrix };
    });
}

/** Placements of the whole array, resolving every direction first. */
export function arrayDirections(
  directions: readonly ArrayDirection[],
  context: ArrayPlacementContext,
): { counts: number[]; placements: Array<{ key: string; matrix: Matrix3x4 }> } {
  const counts = directions.map((direction) => clampArrayCount(direction.count));
  const perDirection = directions.map((direction) => directionMatrices(direction, context));
  return { counts, placements: arrayPlacementMatrices(counts, perDirection) };
}
