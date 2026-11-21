import type { TessellationResult } from '@icancad/kernel';
import type {
  Resolved,
  SketchEntity,
  SketchFrame,
  Transform,
  Vec3,
} from '@icancad/model';
import { sketchPointToWorld, tessellateEntity } from '@icancad/sketch';
import type { Matrix3x4 } from './array';

/** A row-major 3x3, the part of an affine that turns and scales directions. */
export type Matrix3x3 = [number, number, number, number, number, number, number, number, number];

/** Bounds of one target, in world space. */
export interface TargetBounds {
  min: Vec3;
  max: Vec3;
}

/** How degrees turn a vector: a right-handed angle around a unit axis. */
function rotateAbout(vector: Vec3, axis: Vec3, degrees: number): Vec3 {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [x, y, z] = vector;
  const [ax, ay, az] = axis;
  const along = ax * x + ay * y + az * z;
  return [
    x * cos + (ay * z - az * y) * sin + ax * along * (1 - cos),
    y * cos + (az * x - ax * z) * sin + ay * along * (1 - cos),
    z * cos + (ax * y - ay * x) * sin + az * along * (1 - cos),
  ];
}

/**
 * The turn of a transform, as a 3x3. The angles are intrinsic rotations around
 * the axes as the previous turn left them, in X, Y then Z order — the same
 * order the sketch plane rotation uses: a vector meets Z first and X last.
 */
export function transformRotation(rotation: Vec3): Matrix3x3 {
  const [rx, ry, rz] = rotation;
  const apply = (vector: Vec3): Vec3 =>
    rotateAbout(rotateAbout(rotateAbout(vector, [0, 0, 1], rz), [0, 1, 0], ry), [1, 0, 0], rx);
  const x = apply([1, 0, 0]);
  const y = apply([0, 1, 0]);
  const z = apply([0, 0, 1]);
  // Columns are the turned basis vectors, so the matrix maps a local vector.
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** A right-handed turn of `degrees` around an axis, as a 3x3. */
export function axisRotation(axis: Vec3, degrees: number): Matrix3x3 {
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const unit: Vec3 = [axis[0] / length, axis[1] / length, axis[2] / length];
  const x = rotateAbout([1, 0, 0], unit, degrees);
  const y = rotateAbout([0, 1, 0], unit, degrees);
  const z = rotateAbout([0, 0, 1], unit, degrees);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** `after` applied on top of `before`. */
export function multiplyRotation(after: Matrix3x3, before: Matrix3x3): Matrix3x3 {
  const result = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let value = 0;
      for (let index = 0; index < 3; index += 1) {
        value += after[row * 3 + index]! * before[index * 3 + column]!;
      }
      result[row * 3 + column] = value;
    }
  }
  return result as Matrix3x3;
}

/**
 * The angles a turn came from, in the order `transformRotation` reads them:
 * `R = Rx·Ry·Rz`. At the poles the X and Z turns are one and the same, so the
 * turn is written on X and Z is left at zero.
 */
export function rotationAngles(rotation: Matrix3x3): Vec3 {
  const degrees = (radians: number) => {
    const value = (radians * 180) / Math.PI;
    // A tenth is finer than a handle can drag and keeps a field readable; a
    // turned-away axis writes zero, never a minus zero.
    const rounded = Math.round(value * 10) / 10;
    return rounded === 0 ? 0 : rounded;
  };
  const sy = Math.max(-1, Math.min(1, rotation[2]!));
  const ry = Math.asin(sy);
  if (Math.abs(sy) > 0.9999999) {
    return [degrees(Math.atan2(rotation[7]!, rotation[4]!)), degrees(ry), 0];
  }
  return [
    degrees(Math.atan2(-rotation[5]!, rotation[8]!)),
    degrees(ry),
    degrees(Math.atan2(-rotation[1]!, rotation[0]!)),
  ];
}

/**
 * A row-major 3x4 affine from the transform, turning and scaling around `pivot`.
 * `p' = P + R·(s·(p − P) + t)`: the offset is measured along the turned axes, so
 * the position fields and their arrows follow the object's own frame.
 */
export function transformMatrix(transform: Resolved<Transform>, pivot: Vec3): Matrix3x4 {
  const scale = transform.scale > 0 ? transform.scale : 1;
  const r = transformRotation(transform.rotation);
  const linear = r.map((value) => value * scale) as Matrix3x3;
  // The offset is authored in the object's frame, so it is turned with it.
  const moved = rotatePoint(r, transform.translation);
  const at = (row: 0 | 1 | 2): number =>
    moved[row]! +
    pivot[row]! -
    (linear[row * 3]! * pivot[0]! +
      linear[row * 3 + 1]! * pivot[1]! +
      linear[row * 3 + 2]! * pivot[2]!);
  return [
    linear[0]!,
    linear[1]!,
    linear[2]!,
    at(0),
    linear[3]!,
    linear[4]!,
    linear[5]!,
    at(1),
    linear[6]!,
    linear[7]!,
    linear[8]!,
    at(2),
  ];
}

export function transformPoint(matrix: readonly number[], point: Vec3): Vec3 {
  return [
    matrix[0]! * point[0] + matrix[1]! * point[1] + matrix[2]! * point[2] + matrix[3]!,
    matrix[4]! * point[0] + matrix[5]! * point[1] + matrix[6]! * point[2] + matrix[7]!,
    matrix[8]! * point[0] + matrix[9]! * point[1] + matrix[10]! * point[2] + matrix[11]!,
  ];
}

export function rotatePoint(rotation: Matrix3x3, point: Vec3): Vec3 {
  return [
    rotation[0]! * point[0] + rotation[1]! * point[1] + rotation[2]! * point[2],
    rotation[3]! * point[0] + rotation[4]! * point[1] + rotation[5]! * point[2],
    rotation[6]! * point[0] + rotation[7]! * point[1] + rotation[8]! * point[2],
  ];
}

/** The inverse turn, for reading a world direction in the turned frame. */
export function transposeRotation(rotation: Matrix3x3): Matrix3x3 {
  return [
    rotation[0]!,
    rotation[3]!,
    rotation[6]!,
    rotation[1]!,
    rotation[4]!,
    rotation[7]!,
    rotation[2]!,
    rotation[5]!,
    rotation[8]!,
  ];
}

/** The other way round: a world direction read in the turned frame. */
export function unrotatePoint(rotation: Matrix3x3, point: Vec3): Vec3 {
  return [
    rotation[0]! * point[0] + rotation[3]! * point[1] + rotation[6]! * point[2],
    rotation[1]! * point[0] + rotation[4]! * point[1] + rotation[7]! * point[2],
    rotation[2]! * point[0] + rotation[5]! * point[1] + rotation[8]! * point[2],
  ];
}

/** Bounds of a tessellated body. */
export function meshBounds(mesh: TessellationResult): TargetBounds {
  return { min: [...mesh.bbox.min], max: [...mesh.bbox.max] };
}

/** Bounds of a sketch's geometry, placed in the world by its frame. */
export function sketchBounds(
  frame: SketchFrame,
  entities: readonly SketchEntity[],
): TargetBounds | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const entity of entities) {
    for (const point of tessellateEntity(entity, 64)) {
      const world = sketchPointToWorld(frame, point);
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, world[axis]!);
        max[axis] = Math.max(max[axis]!, world[axis]!);
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

export function boundsCentre(bounds: readonly TargetBounds[]): Vec3 | null {
  if (bounds.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of bounds) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!);
      max[axis] = Math.max(max[axis]!, box.max[axis]!);
    }
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/**
 * Where the operation turns and scales, and how big its handles are: the centre
 * of everything it moves, and half the diagonal of the whole selection, which
 * is what the scale grip measures against.
 */
export function transformPivot(
  bounds: readonly TargetBounds[],
): { origin: Vec3; radius: number } | null {
  if (bounds.length === 0) return null;
  const origin = boundsCentre(bounds) ?? [0, 0, 0];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of bounds) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!);
      max[axis] = Math.max(max[axis]!, box.max[axis]!);
    }
  }
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return { origin, radius: Math.max(diagonal / 2, 1) };
}

/** Scales one entity's coordinates about the sketch origin. */
export function scaleSketchEntity(entity: SketchEntity, factor: number): SketchEntity {
  const scale = (value: number) => value * factor;
  switch (entity.type) {
    case 'point':
      return { ...entity, x: scale(entity.x), y: scale(entity.y) };
    case 'line':
      return {
        ...entity,
        x1: scale(entity.x1),
        y1: scale(entity.y1),
        x2: scale(entity.x2),
        y2: scale(entity.y2),
      };
    case 'circle':
      return { ...entity, cx: scale(entity.cx), cy: scale(entity.cy), r: scale(entity.r) };
    case 'arc':
      return { ...entity, cx: scale(entity.cx), cy: scale(entity.cy), r: scale(entity.r) };
    case 'ellipse':
      return {
        ...entity,
        cx: scale(entity.cx),
        cy: scale(entity.cy),
        rx: scale(entity.rx),
        ry: scale(entity.ry),
      };
    case 'bezier':
      return {
        ...entity,
        points: entity.points.map(
          (point) => [scale(point[0]), scale(point[1])] as [number, number],
        ),
      };
  }
}

/**
 * The result of a transform on a sketch: its geometry is scaled about the
 * sketch origin while the plane moves with the whole selection. The new origin
 * is the transformed old one, so the two parts together are exactly the affine
 * applied to every point of the sketch.
 */
export function transformSketchGeometry(
  frame: SketchFrame,
  entities: readonly SketchEntity[],
  scale: number,
  rotation: Matrix3x3,
  matrix: Matrix3x4,
): { frame: SketchFrame; entities: SketchEntity[] } {
  const factor = scale > 0 ? scale : 1;
  return {
    frame: {
      origin: transformPoint(matrix, frame.origin),
      xAxis: rotatePoint(rotation, frame.xAxis),
      yAxis: rotatePoint(rotation, frame.yAxis),
      normal: rotatePoint(rotation, frame.normal),
    },
    entities: entities.map((entity) => scaleSketchEntity(entity, factor)),
  };
}
