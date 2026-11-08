import { buildParsedMesh } from './mesh';
import type { ParsedMesh } from './types';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
}

interface GltfMesh {
  primitives: GltfPrimitive[];
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfDocument {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: GltfBufferView[];
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
}

const COMPONENT_SIZE: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const COMPONENT_COUNT: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function readComponent(view: DataView, offset: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5120: {
      const value = view.getInt8(offset);
      return normalized ? Math.max(value / 127, -1) : value;
    }
    case 5121: {
      const value = view.getUint8(offset);
      return normalized ? value / 255 : value;
    }
    case 5122: {
      const value = view.getInt16(offset, true);
      return normalized ? Math.max(value / 32767, -1) : value;
    }
    case 5123: {
      const value = view.getUint16(offset, true);
      return normalized ? value / 65535 : value;
    }
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      throw new Error(`Unsupported GLB component type: ${type}`);
  }
}

function readAccessor(
  document: GltfDocument,
  accessors: GltfAccessor[],
  views: GltfBufferView[],
  binary: Uint8Array,
  index: number,
): Float32Array {
  const accessor = accessors[index];
  if (!accessor) throw new Error(`GLB accessor ${index} is missing`);
  if (accessor.sparse) throw new Error('Sparse GLB accessors are not supported');
  if (accessor.bufferView === undefined) throw new Error(`GLB accessor ${index} has no bufferView`);
  const bufferView = views[accessor.bufferView];
  if (!bufferView) throw new Error(`GLB bufferView ${accessor.bufferView} is missing`);
  if (bufferView.buffer !== 0) throw new Error('Only the GLB binary buffer is supported');
  const components = COMPONENT_COUNT[accessor.type];
  if (!components) throw new Error(`Unsupported GLB accessor type: ${accessor.type}`);
  const componentSize = COMPONENT_SIZE[accessor.componentType];
  if (!componentSize) throw new Error(`Unsupported GLB component type: ${accessor.componentType}`);
  const stride = bufferView.byteStride ?? components * componentSize;
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  if (base + stride * (accessor.count - 1) + components * componentSize > binary.byteLength) {
    throw new Error('GLB accessor exceeds the binary chunk');
  }
  const values = new Float32Array(accessor.count * components);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < components; component += 1) {
      values[item * components + component] = readComponent(
        view,
        base + item * stride + component * componentSize,
        accessor.componentType,
        accessor.normalized ?? false,
      );
    }
  }
  return values;
}

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row]! * b[column * 4]! +
        a[4 + row]! * b[column * 4 + 1]! +
        a[8 + row]! * b[column * 4 + 2]! +
        a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

function nodeMatrix(node: GltfNode): number[] {
  if (node.matrix && node.matrix.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const x2 = qx! + qx!;
  const y2 = qy! + qy!;
  const z2 = qz! + qz!;
  const xx = qx! * x2;
  const xy = qx! * y2;
  const xz = qx! * z2;
  const yy = qy! * y2;
  const yz = qy! * z2;
  const zz = qz! * z2;
  const wx = qw! * x2;
  const wy = qw! * y2;
  const wz = qw! * z2;
  return [
    (1 - (yy + zz)) * sx!,
    (xy + wz) * sx!,
    (xz - wy) * sx!,
    0,
    (xy - wz) * sy!,
    (1 - (xx + zz)) * sy!,
    (yz + wx) * sy!,
    0,
    (xz + wy) * sz!,
    (yz - wx) * sz!,
    (1 - (xx + yy)) * sz!,
    0,
    tx!,
    ty!,
    tz!,
    1,
  ];
}

function transformPosition(
  matrix: readonly number[],
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  ];
}

export function parseGlb(bytes: Uint8Array): ParsedMesh {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67) {
    throw new Error('File is not a binary glTF');
  }
  if (header.getUint32(4, true) !== 2) throw new Error('Only GLB version 2 is supported');

  let offset = 12;
  let document: GltfDocument | null = null;
  let binary: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = header.getUint32(offset, true);
    const type = header.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.byteLength) throw new Error('GLB chunk is truncated');
    if (type === 0x4e4f534a) {
      document = JSON.parse(
        new TextDecoder().decode(bytes.subarray(start, start + length)),
      ) as GltfDocument;
    } else if (type === 0x004e4942) {
      binary = bytes.subarray(start, start + length);
    }
    offset = start + length;
  }

  if (!document) throw new Error('GLB has no JSON chunk');
  if (!binary) throw new Error('GLB has no binary chunk');
  const accessors = document.accessors ?? [];
  const views = document.bufferViews ?? [];
  const meshes = document.meshes ?? [];
  const nodes = document.nodes ?? [];

  const children = new Set<number>();
  for (const node of nodes) for (const child of node.children ?? []) children.add(child);
  const sceneNodes = document.scenes?.[document.scene ?? 0]?.nodes;
  const roots =
    sceneNodes ?? nodes.map((_, index) => index).filter((index) => !children.has(index));

  const positions: number[] = [];
  const indices: number[] = [];
  const visited = new Set<number>();

  const addMesh = (meshIndex: number, matrix: readonly number[]): void => {
    const mesh = meshes[meshIndex];
    if (!mesh) throw new Error(`GLB mesh ${meshIndex} is missing`);
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4)
        throw new Error('Only GLB triangle primitives are supported');
      const positionAccessor = primitive.attributes.POSITION;
      if (positionAccessor === undefined) continue;
      const source = readAccessor(document!, accessors, views, binary!, positionAccessor);
      const vertexCount = source.length / 3;
      const base = positions.length / 3;
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const [x, y, z] = transformPosition(
          matrix,
          source[vertex * 3]!,
          source[vertex * 3 + 1]!,
          source[vertex * 3 + 2]!,
        );
        // glTF is Y-up; the CAD viewport is Z-up.
        positions.push(x, -z, y);
      }
      if (primitive.indices === undefined) {
        for (let vertex = 0; vertex < vertexCount; vertex += 1) indices.push(base + vertex);
      } else {
        const sourceIndices = readAccessor(document!, accessors, views, binary!, primitive.indices);
        for (const value of sourceIndices) indices.push(base + value);
      }
    }
  };

  const visit = (index: number, parent: readonly number[]): void => {
    if (visited.has(index)) return;
    visited.add(index);
    const node = nodes[index];
    if (!node) return;
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) addMesh(node.mesh, matrix);
    for (const child of node.children ?? []) visit(child, matrix);
  };

  for (const root of roots) visit(root, identity());

  if (positions.length === 0 || indices.length === 0) throw new Error('GLB contains no triangles');
  const vertexCount = positions.length / 3;
  const valid = indices.filter(
    (value) => Number.isInteger(value) && value >= 0 && value < vertexCount,
  );
  if (valid.length !== indices.length) throw new Error('GLB contains an out-of-range vertex index');
  return buildParsedMesh(new Float32Array(positions), new Uint32Array(valid));
}
