import type { TessellationResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { multiplyMatrices, type Matrix3x4 } from './array';

/**
 * The affine from one placement to another: `after · before⁻¹`. A fast preview
 * applies the difference between two states of the operation to the meshes it
 * already has, so a drag does not wait for the kernel.
 */
export function placementDelta(after: Matrix3x4, before: Matrix3x4): Matrix3x4 | null {
  const inverse = invertPlacement(before);
  return inverse ? multiplyMatrices(after, inverse) : null;
}

function invertPlacement(matrix: Matrix3x4): Matrix3x4 | null {
  const [a, b, c, x, d, e, f, y, g, h, i, z] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const inverse = [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
  // The translation of the inverse is the old origin read the other way round.
  const tx = -(inverse[0]! * x + inverse[1]! * y + inverse[2]! * z);
  const ty = -(inverse[3]! * x + inverse[4]! * y + inverse[5]! * z);
  const tz = -(inverse[6]! * x + inverse[7]! * y + inverse[8]! * z);
  return [inverse[0]!, inverse[1]!, inverse[2]!, tx, inverse[3]!, inverse[4]!, inverse[5]!, ty, inverse[6]!, inverse[7]!, inverse[8]!, tz];
}

/**
 * A tessellation moved by an affine. Positions, normals, bounds and edge
 * polylines are turned; indices and face ids describe the same triangles and
 * are shared with the source.
 */
export function transformMesh(mesh: TessellationResult, matrix: Matrix3x4): TessellationResult {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = matrix;
  // Normals take the inverse transpose; a turn with a uniform scale turns them
  // as it turns the surface.
  const normalMatrix = invertTranspose([a, b, c, d, e, f, g, h, i]);

  const positions = new Float32Array(mesh.positions.length);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index]!;
    const y = mesh.positions[index + 1]!;
    const z = mesh.positions[index + 2]!;
    const movedX = a * x + b * y + c * z + tx;
    const movedY = d * x + e * y + f * z + ty;
    const movedZ = g * x + h * y + i * z + tz;
    positions[index] = movedX;
    positions[index + 1] = movedY;
    positions[index + 2] = movedZ;
    if (movedX < min[0]) min[0] = movedX;
    if (movedY < min[1]) min[1] = movedY;
    if (movedZ < min[2]) min[2] = movedZ;
    if (movedX > max[0]) max[0] = movedX;
    if (movedY > max[1]) max[1] = movedY;
    if (movedZ > max[2]) max[2] = movedZ;
  }

  const normals = new Float32Array(mesh.normals.length);
  for (let index = 0; index < mesh.normals.length; index += 3) {
    const x = mesh.normals[index]!;
    const y = mesh.normals[index + 1]!;
    const z = mesh.normals[index + 2]!;
    const nx = normalMatrix[0] * x + normalMatrix[1] * y + normalMatrix[2] * z;
    const ny = normalMatrix[3] * x + normalMatrix[4] * y + normalMatrix[5] * z;
    const nz = normalMatrix[6] * x + normalMatrix[7] * y + normalMatrix[8] * z;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[index] = nx / length;
    normals[index + 1] = ny / length;
    normals[index + 2] = nz / length;
  }

  const edges = mesh.edges?.map((edge) => {
    const points = [...edge.points];
    for (let index = 0; index < points.length; index += 3) {
      const x = points[index]!;
      const y = points[index + 1]!;
      const z = points[index + 2]!;
      points[index] = a * x + b * y + c * z + tx;
      points[index + 1] = d * x + e * y + f * z + ty;
      points[index + 2] = g * x + h * y + i * z + tz;
    }
    return { ...edge, points };
  });

  const bbox =
    Number.isFinite(min[0]) && Number.isFinite(max[0])
      ? { min, max }
      : { min: [...mesh.bbox.min] as Vec3, max: [...mesh.bbox.max] as Vec3 };

  return {
    ...mesh,
    positions,
    normals,
    bbox,
    ...(edges ? { edges } : {}),
  };
}

type Matrix3x3Tuple = [
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

/** Inverse transpose of a row-major 3x3, which is what normals follow. */
function invertTranspose(m: readonly number[]): Matrix3x3Tuple {
  const [a, b, c, d, e, f, g, h, i] = m as [
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
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  // The transpose of the inverse is the cofactor matrix over the determinant.
  // Cofactors are written row by row: `C_ij` belongs at `i * 3 + j`.
  return [
    (e * i - f * h) / determinant,
    (f * g - d * i) / determinant,
    (d * h - e * g) / determinant,
    (c * h - b * i) / determinant,
    (a * i - c * g) / determinant,
    (b * g - a * h) / determinant,
    (b * f - c * e) / determinant,
    (c * d - a * f) / determinant,
    (a * e - b * d) / determinant,
  ];
}
