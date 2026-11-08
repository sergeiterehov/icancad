import { buildParsedMesh } from './mesh';
import type { ParsedMesh } from './types';

function parseVertexIndex(token: string, vertexCount: number): number | null {
  const raw = token.split('/')[0];
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value === 0) return null;
  return value < 0 ? vertexCount + value : value - 1;
}

export function parseObj(bytes: Uint8Array): ParsedMesh {
  const text = new TextDecoder().decode(bytes);
  const positions: number[] = [];
  const faces: number[][] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        positions.push(x, y, z);
      }
      continue;
    }
    if (parts[0] === 'f' && parts.length >= 4) {
      const face: number[] = [];
      for (let index = 1; index < parts.length; index += 1) {
        const vertex = parseVertexIndex(parts[index]!, positions.length / 3);
        if (vertex !== null) face.push(vertex);
      }
      if (face.length >= 3) faces.push(face);
    }
  }

  if (positions.length === 0 || faces.length === 0) {
    throw new Error('OBJ contains no triangles');
  }

  const indices: number[] = [];
  for (const face of faces) {
    for (let index = 1; index < face.length - 1; index += 1) {
      indices.push(face[0]!, face[index]!, face[index + 1]!);
    }
  }

  return buildParsedMesh(new Float32Array(positions), new Uint32Array(indices));
}
