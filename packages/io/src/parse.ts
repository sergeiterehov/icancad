import { parseGlb } from './glb';
import { parseObj } from './obj';
import { parsePly } from './ply';
import { parseStl } from './stl';
import type { ParsedMesh } from './types';

export type MeshFormat = 'stl' | 'obj' | 'ply' | 'glb';

export function parseMesh(bytes: Uint8Array, format: MeshFormat): ParsedMesh {
  switch (format) {
    case 'stl':
      return parseStl(bytes);
    case 'obj':
      return parseObj(bytes);
    case 'ply':
      return parsePly(bytes);
    case 'glb':
      return parseGlb(bytes);
  }
}
