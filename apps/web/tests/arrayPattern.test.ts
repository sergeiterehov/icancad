import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@icancad/model';
import {
  arrayCombinations,
  arrayPositionCount,
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  translationMatrix,
  type Matrix3x4,
} from '../src/kernel/array';

function apply(matrix: Matrix3x4, point: Vec3): Vec3 {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}

describe('array pattern math', () => {
  it('translates a point by the step', () => {
    expect(apply(translationMatrix([10, -5, 2]), [1, 1, 1])).toEqual([11, -4, 3]);
  });

  it('turns a point around a world axis', () => {
    const quarter = rotationMatrix([0, 0, 0], [0, 0, 1], Math.PI / 2);
    const turned = apply(quarter, [1, 0, 0]);
    expect(turned[0]).toBeCloseTo(0, 6);
    expect(turned[1]).toBeCloseTo(1, 6);
    expect(turned[2]).toBeCloseTo(0, 6);
  });

  it('keeps the point the axis runs through', () => {
    const turned = apply(rotationMatrix([0, 0, 5], [0, 1, 0], Math.PI / 3), [0, 0, 5]);
    expect(turned[0]).toBeCloseTo(0, 6);
    expect(turned[1]).toBeCloseTo(0, 6);
    expect(turned[2]).toBeCloseTo(5, 6);
  });

  it('applies the outer matrix after the inner one', () => {
    // Turn the point a quarter around Z, then push it 10 along X: (1,0,0)
    // becomes (0,1,0), so the result is (10,1,0). The other order would give
    // (11,0,0), which is what a product that ignores nesting would produce.
    const nested = multiplyMatrices(
      translationMatrix([10, 0, 0]),
      rotationMatrix([0, 0, 0], [0, 0, 1], Math.PI / 2),
    );
    const point = apply(nested, [1, 0, 0]);
    expect(point[0]).toBeCloseTo(10, 6);
    expect(point[1]).toBeCloseTo(1, 6);
  });

  it('leaves the identity matrix neutral', () => {
    const matrix = rotationMatrix([1, 2, 3], [0, 1, 0], 0.7);
    expect(multiplyMatrices(IDENTITY_MATRIX, matrix)).toEqual(matrix);
    expect(multiplyMatrices(matrix, IDENTITY_MATRIX)).toEqual(matrix);
  });

  it('counts the seed once and nests the directions', () => {
    expect(arrayPositionCount([3, 2])).toBe(6);
    expect(arrayPositionCount([1, 1])).toBe(1);
    const combinations = arrayCombinations([3, 2]);
    expect(combinations).toHaveLength(6);
    expect(combinations[0]).toEqual({ key: '0-0', indices: [0, 0] });
    expect(combinations[5]).toEqual({ key: '2-1', indices: [2, 1] });
    // The first direction runs outermost, so the copies of an earlier
    // direction keep their identity when a later direction is added.
    expect(combinations.slice(0, 3).map((combination) => combination.key)).toEqual([
      '0-0',
      '0-1',
      '1-0',
    ]);
  });
});
