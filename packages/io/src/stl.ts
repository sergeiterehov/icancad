import { buildParsedMesh } from './mesh';
import type { MeshData, ParsedMesh, Vec3 } from './types';

const ASCII_VERTEX = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;

function computeNormal(positions: Float32Array, offset: number): [number, number, number] {
  const ax = positions[offset]!;
  const ay = positions[offset + 1]!;
  const az = positions[offset + 2]!;
  const bx = positions[offset + 3]!;
  const by = positions[offset + 4]!;
  const bz = positions[offset + 5]!;
  const cx = positions[offset + 6]!;
  const cy = positions[offset + 7]!;
  const cz = positions[offset + 8]!;
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return [0, 0, 0];
  return [nx / length, ny / length, nz / length];
}

export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  return 84 + triangles * 50 === bytes.byteLength;
}

function parseBinaryStl(bytes: Uint8Array): { positions: Float32Array; normals: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  let offset = 84;

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const base = triangle * 9;
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    const normalLength = Math.hypot(nx, ny, nz);
    offset += 12;

    for (let vertex = 0; vertex < 3; vertex += 1) {
      positions[base + vertex * 3] = view.getFloat32(offset + vertex * 12, true);
      positions[base + vertex * 3 + 1] = view.getFloat32(offset + vertex * 12 + 4, true);
      positions[base + vertex * 3 + 2] = view.getFloat32(offset + vertex * 12 + 8, true);
    }
    offset += 36 + 2;

    const fallback =
      normalLength > 0
        ? [nx / normalLength, ny / normalLength, nz / normalLength]
        : computeNormal(positions, base);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      normals[base + vertex * 3] = fallback[0]!;
      normals[base + vertex * 3 + 1] = fallback[1]!;
      normals[base + vertex * 3 + 2] = fallback[2]!;
    }
  }

  return { positions, normals };
}

function parseAsciiStl(bytes: Uint8Array): { positions: Float32Array; normals: Float32Array } {
  const text = new TextDecoder().decode(bytes);
  const values: number[] = [];
  ASCII_VERTEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASCII_VERTEX.exec(text)) !== null) {
    values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  const triangles = Math.floor(values.length / 9);
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const base = triangle * 9;
    for (let index = 0; index < 9; index += 1) {
      positions[base + index] = values[base + index]!;
    }
    const normal = computeNormal(positions, base);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      normals[base + vertex * 3] = normal[0];
      normals[base + vertex * 3 + 1] = normal[1];
      normals[base + vertex * 3 + 2] = normal[2];
    }
  }
  return { positions, normals };
}

export function parseStl(bytes: Uint8Array): ParsedMesh {
  const { positions, normals } = isBinaryStl(bytes) ? parseBinaryStl(bytes) : parseAsciiStl(bytes);
  const indices = new Uint32Array(positions.length / 3);
  for (let index = 0; index < indices.length; index += 1) indices[index] = index;
  return buildParsedMesh(positions, indices, normals);
}

export function exportStlBinary(meshes: readonly MeshData[], header = 'ICanCAD'): Uint8Array {
  let triangles = 0;
  for (const mesh of meshes) {
    triangles += mesh.indices.length > 0 ? mesh.indices.length / 3 : mesh.positions.length / 9;
  }

  const bytes = new Uint8Array(84 + triangles * 50);
  const view = new DataView(bytes.buffer);
  const headerBytes = new TextEncoder().encode(header.slice(0, 79));
  bytes.set(headerBytes, 0);
  view.setUint32(80, triangles, true);

  let offset = 84;
  for (const mesh of meshes) {
    const count = mesh.indices.length > 0 ? mesh.indices.length / 3 : mesh.positions.length / 9;
    for (let triangle = 0; triangle < count; triangle += 1) {
      const indices =
        mesh.indices.length > 0
          ? [
              mesh.indices[triangle * 3]!,
              mesh.indices[triangle * 3 + 1]!,
              mesh.indices[triangle * 3 + 2]!,
            ]
          : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
      const points = indices.map(
        (index) =>
          [
            mesh.positions[index * 3]!,
            mesh.positions[index * 3 + 1]!,
            mesh.positions[index * 3 + 2]!,
          ] as Vec3,
      );
      const [a, b, c] = points as [Vec3, Vec3, Vec3];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(offset, nx / length, true);
      view.setFloat32(offset + 4, ny / length, true);
      view.setFloat32(offset + 8, nz / length, true);
      offset += 12;
      for (const point of points) {
        view.setFloat32(offset, point[0], true);
        view.setFloat32(offset + 4, point[1], true);
        view.setFloat32(offset + 8, point[2], true);
        offset += 12;
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }

  return bytes;
}
