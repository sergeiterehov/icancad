import { buildParsedMesh } from './mesh';
import type { ParsedMesh } from './types';

type PlyScalar = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64';

interface PlyProperty {
  name: string;
  type: PlyScalar;
  list?: { countType: PlyScalar; itemType: PlyScalar };
}

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

const TYPE_ALIASES: Record<string, PlyScalar> = {
  char: 'int8',
  int8: 'int8',
  uchar: 'uint8',
  uint8: 'uint8',
  short: 'int16',
  int16: 'int16',
  ushort: 'uint16',
  uint16: 'uint16',
  int: 'int32',
  int32: 'int32',
  uint: 'uint32',
  uint32: 'uint32',
  float: 'float32',
  float32: 'float32',
  double: 'float64',
  float64: 'float64',
};

const TYPE_SIZES: Record<PlyScalar, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};

function scalarType(value: string): PlyScalar {
  const type = TYPE_ALIASES[value.toLowerCase()];
  if (!type) throw new Error(`Unsupported PLY property type: ${value}`);
  return type;
}

function findHeaderEnd(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode('end_header');
  outer: for (let index = 0; index <= bytes.length - marker.length; index += 1) {
    for (let offset = 0; offset < marker.length; offset += 1) {
      if (bytes[index + offset] !== marker[offset]) continue outer;
    }
    let end = index + marker.length;
    if (bytes[end] === 13) end += 1;
    if (bytes[end] === 10) end += 1;
    return end;
  }
  throw new Error('PLY header is incomplete');
}

export function parsePly(bytes: Uint8Array): ParsedMesh {
  const headerEnd = findHeaderEnd(bytes);
  const header = new TextDecoder().decode(bytes.subarray(0, headerEnd));
  let format = '';
  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;

  for (const rawLine of header.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === 'ply' || line.startsWith('comment') || line.startsWith('obj_info')) {
      continue;
    }
    if (line === 'end_header') break;
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') {
      format = parts[1] ?? '';
      continue;
    }
    if (parts[0] === 'element') {
      current = {
        name: (parts[1] ?? '').toLowerCase(),
        count: Number(parts[2] ?? 0),
        properties: [],
      };
      elements.push(current);
      continue;
    }
    if (parts[0] === 'property' && current) {
      if (parts[1] === 'list') {
        current.properties.push({
          name: (parts[4] ?? '').toLowerCase(),
          type: scalarType(parts[3] ?? ''),
          list: { countType: scalarType(parts[2] ?? ''), itemType: scalarType(parts[3] ?? '') },
        });
      } else {
        current.properties.push({
          name: (parts[2] ?? '').toLowerCase(),
          type: scalarType(parts[1] ?? ''),
        });
      }
    }
  }

  if (!format) throw new Error('PLY format is missing');
  if (format !== 'ascii' && format !== 'binary_little_endian' && format !== 'binary_big_endian') {
    throw new Error(`Unsupported PLY format: ${format}`);
  }
  const binary = format !== 'ascii';
  const little = format !== 'binary_big_endian';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = headerEnd;
  const ascii = binary
    ? null
    : new TextDecoder().decode(bytes.subarray(headerEnd)).trim().split(/\s+/).filter(Boolean);
  let token = 0;

  const readScalar = (type: PlyScalar): number => {
    if (ascii) {
      const value = Number(ascii[token++]);
      if (!Number.isFinite(value)) throw new Error('PLY contains an invalid number');
      return value;
    }
    const size = TYPE_SIZES[type];
    if (offset + size > bytes.byteLength) throw new Error('PLY file is truncated');
    let value: number;
    switch (type) {
      case 'int8':
        value = view.getInt8(offset);
        break;
      case 'uint8':
        value = view.getUint8(offset);
        break;
      case 'int16':
        value = view.getInt16(offset, little);
        break;
      case 'uint16':
        value = view.getUint16(offset, little);
        break;
      case 'int32':
        value = view.getInt32(offset, little);
        break;
      case 'uint32':
        value = view.getUint32(offset, little);
        break;
      case 'float32':
        value = view.getFloat32(offset, little);
        break;
      case 'float64':
        value = view.getFloat64(offset, little);
        break;
    }
    offset += size;
    return value;
  };

  const skipProperty = (property: PlyProperty): void => {
    if (property.list) {
      const count = readScalar(property.list.countType);
      if (!Number.isInteger(count) || count < 0) throw new Error('PLY has an invalid list size');
      for (let index = 0; index < count; index += 1) readScalar(property.list.itemType);
    } else {
      readScalar(property.type);
    }
  };

  const vertices: number[] = [];
  const triangles: number[] = [];

  for (const element of elements) {
    if (!Number.isInteger(element.count) || element.count < 0) {
      throw new Error('PLY has an invalid element count');
    }
    if (element.name === 'vertex') {
      for (let index = 0; index < element.count; index += 1) {
        let x = 0;
        let y = 0;
        let z = 0;
        for (const property of element.properties) {
          if (property.list) {
            skipProperty(property);
            continue;
          }
          const value = readScalar(property.type);
          if (property.name === 'x') x = value;
          else if (property.name === 'y') y = value;
          else if (property.name === 'z') z = value;
        }
        vertices.push(x, y, z);
      }
      continue;
    }
    if (element.name === 'face') {
      for (let index = 0; index < element.count; index += 1) {
        let face: number[] = [];
        for (const property of element.properties) {
          if (!property.list) {
            readScalar(property.type);
            continue;
          }
          const count = readScalar(property.list.countType);
          if (!Number.isInteger(count) || count < 0) {
            throw new Error('PLY has an invalid face size');
          }
          const values: number[] = [];
          for (let item = 0; item < count; item += 1) {
            values.push(readScalar(property.list.itemType));
          }
          if (property.name === 'vertex_indices' || property.name === 'vertex_index') {
            face = values;
          }
        }
        for (let item = 1; item < face.length - 1; item += 1) {
          triangles.push(face[0]!, face[item]!, face[item + 1]!);
        }
      }
      continue;
    }
    for (let index = 0; index < element.count; index += 1) {
      for (const property of element.properties) skipProperty(property);
    }
  }

  const vertexCount = vertices.length / 3;
  if (vertexCount === 0 || triangles.length === 0) throw new Error('PLY contains no triangles');
  const valid = triangles.filter(
    (index) => Number.isInteger(index) && index >= 0 && index < vertexCount,
  );
  if (valid.length !== triangles.length) {
    throw new Error('PLY contains an out-of-range vertex index');
  }

  return buildParsedMesh(new Float32Array(vertices), new Uint32Array(valid));
}
