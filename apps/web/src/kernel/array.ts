import type { Vec3 } from '@icancad/model';

/**
 * A row-major 3x4 affine, the layout `gp_Trsf.SetValues` takes in the kernel:
 * `a11 a12 a13 a14 / a21 a22 a23 a24 / a31 a32 a33 a34`.
 */
export type Matrix3x4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY_MATRIX: Matrix3x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function translationMatrix(offset: Vec3): Matrix3x4 {
  return [1, 0, 0, offset[0], 0, 1, 0, offset[1], 0, 0, 1, offset[2]];
}

/** A turn around a line: the axis point stays where it is. */
export function rotationMatrix(origin: Vec3, direction: Vec3, angle: number): Matrix3x4 {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length < 1e-9) return IDENTITY_MATRIX;
  const [x, y, z] = [direction[0] / length, direction[1] / length, direction[2] / length];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const one = 1 - cos;
  const r11 = cos + x * x * one;
  const r12 = x * y * one - z * sin;
  const r13 = x * z * one + y * sin;
  const r21 = y * x * one + z * sin;
  const r22 = cos + y * y * one;
  const r23 = y * z * one - x * sin;
  const r31 = z * x * one - y * sin;
  const r32 = z * y * one + x * sin;
  const r33 = cos + z * z * one;
  // The axis point is fixed, so the translation is what keeps it in place.
  const tx = origin[0] - (r11 * origin[0] + r12 * origin[1] + r13 * origin[2]);
  const ty = origin[1] - (r21 * origin[0] + r22 * origin[1] + r23 * origin[2]);
  const tz = origin[2] - (r31 * origin[0] + r32 * origin[1] + r33 * origin[2]);
  return [r11, r12, r13, tx, r21, r22, r23, ty, r31, r32, r33, tz];
}

/** `after` applied on top of `before`: the result moves a point the way both do. */
export function multiplyMatrices(after: Matrix3x4, before: Matrix3x4): Matrix3x4 {
  const at = [after[3]!, after[7]!, after[11]!];
  const result: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      result.push(
        after[row * 4]! * before[column]! +
          after[row * 4 + 1]! * before[4 + column]! +
          after[row * 4 + 2]! * before[8 + column]!,
      );
    }
    result.push(
      after[row * 4]! * before[3]! +
        after[row * 4 + 1]! * before[7]! +
        after[row * 4 + 2]! * before[11]! +
        at[row]!,
    );
  }
  return result as Matrix3x4;
}

export interface ArrayCombination {
  /** Stable name of the position, `0-2-1` for the indices of each direction. */
  key: string;
  indices: number[];
}

/**
 * Every position of a nested array, the seed (`0-0-…`) first. Direction one
 * runs outermost, so adding a later direction keeps the copies of the earlier
 * ones where they were.
 */
export function arrayCombinations(counts: readonly number[]): ArrayCombination[] {
  let combinations: ArrayCombination[] = [{ key: '', indices: [] }];
  for (const count of counts) {
    const next: ArrayCombination[] = [];
    for (const combination of combinations) {
      for (let index = 0; index < Math.max(1, count); index += 1) {
        next.push({
          key: combination.key === '' ? String(index) : `${combination.key}-${index}`,
          indices: [...combination.indices, index],
        });
      }
    }
    combinations = next;
  }
  return combinations;
}

/** Total copies an array makes, including the seed. */
export function arrayPositionCount(counts: readonly number[]): number {
  return counts.reduce((total, count) => total * Math.max(1, count), 1);
}
