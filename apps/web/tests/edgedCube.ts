import type { TessellationResult } from '@icancad/kernel';
import { cubeMesh } from './cubeMesh';

/** Cube of `size` with the 12 real B-rep edges of a box. */
export function edgedCube(size = 20): TessellationResult {
  const edges: NonNullable<TessellationResult['edges']> = [];
  const add = (from: [number, number, number], to: [number, number, number], faceIds: number[]) => {
    const name = faceIds.map((id) => `fixture/${['-x', '+x', '-y', '+y', '-z', '+z'][id]}`).sort().join('|');
    edges.push({
      id: String(edges.length),
      faceIds,
      points: [...from, ...to],
      closed: false,
      name,
      aliases: [name],
    });
  };
  for (const y of [0, size]) {
    for (const z of [0, size]) {
      add([0, y, z], [size, y, z], [y === 0 ? 2 : 3, z === 0 ? 4 : 5]);
    }
  }
  for (const x of [0, size]) {
    for (const z of [0, size]) {
      add([x, 0, z], [x, size, z], [x === 0 ? 0 : 1, z === 0 ? 4 : 5]);
    }
  }
  for (const x of [0, size]) {
    for (const y of [0, size]) {
      add([x, y, 0], [x, y, size], [x === 0 ? 0 : 1, y === 0 ? 2 : 3]);
    }
  }
  return { ...cubeMesh(size), edges };
}
