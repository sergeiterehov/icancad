import { describe, expect, it } from 'vitest';
import { parseGlb, parseObj, parsePly } from '../src';

const cubeVertices = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

const cubeFaces = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
];

const objCube = [
  ...cubeVertices.map((vertex) => `v ${vertex.join(' ')}`),
  ...cubeFaces.map((face) => `f ${face.map((index) => index + 1).join(' ')}`),
].join('\n');

function asciiPly(): string {
  return [
    'ply',
    'format ascii 1.0',
    `element vertex ${cubeVertices.length}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${cubeFaces.length}`,
    'property list uchar int vertex_indices',
    'end_header',
    ...cubeVertices.map((vertex) => vertex.join(' ')),
    ...cubeFaces.map((face) => `3 ${face.join(' ')}`),
  ].join('\n');
}

function binaryPly(): Uint8Array {
  const header = new TextEncoder().encode(
    [
      'ply',
      'format binary_little_endian 1.0',
      `element vertex ${cubeVertices.length}`,
      'property float x',
      'property float y',
      'property float z',
      `element face ${cubeFaces.length}`,
      'property list uchar int vertex_indices',
      'end_header',
      '',
    ].join('\n'),
  );
  const vertexBytes = cubeVertices.length * 12;
  const faceBytes = cubeFaces.length * 13;
  const bytes = new Uint8Array(header.length + vertexBytes + faceBytes);
  bytes.set(header);
  const view = new DataView(bytes.buffer);
  let offset = header.length;
  for (const vertex of cubeVertices) {
    for (const value of vertex) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  }
  for (const face of cubeFaces) {
    view.setUint8(offset, face.length);
    offset += 1;
    for (const index of face) {
      view.setInt32(offset, index, true);
      offset += 4;
    }
  }
  return bytes;
}

function buildGlb(json: unknown, binary: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binaryLength;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(jsonBytes, 20);
  const binaryStart = 20 + jsonLength;
  view.setUint32(binaryStart, binaryLength, true);
  view.setUint32(binaryStart + 4, 0x004e4942, true);
  bytes.set(binary, binaryStart + 8);
  return bytes;
}

function triangleGlb(): Uint8Array {
  const binary = new Uint8Array(48);
  const view = new DataView(binary.buffer);
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  let offset = 0;
  for (const position of positions) {
    for (const value of position) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  }
  view.setUint16(offset, 0, true);
  view.setUint16(offset + 2, 1, true);
  view.setUint16(offset + 4, 2, true);
  return buildGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, translation: [10, 0, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ byteLength: 42 }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    },
    binary,
  );
}

function expectCube(mesh: ReturnType<typeof parseObj>): void {
  expect(mesh.stats.triangleCount).toBe(12);
  expect(mesh.stats.bounds.min).toEqual([0, 0, 0]);
  expect(mesh.stats.bounds.max).toEqual([1, 1, 1]);
  expect(mesh.stats.watertight).toBe(true);
  expect(mesh.stats.volume).toBeCloseTo(1);
  expect(mesh.stats.surfaceArea).toBeCloseTo(6);
  expect(mesh.stats.componentCount).toBe(1);
}

describe('mesh import formats', () => {
  it('parses OBJ triangles and polygons', () => {
    expectCube(parseObj(new TextEncoder().encode(objCube)));
  });

  it('parses ASCII and binary PLY', () => {
    expectCube(parsePly(new TextEncoder().encode(asciiPly())));
    expectCube(parsePly(binaryPly()));
  });

  it('parses GLB with node transforms and converts Y-up to Z-up', () => {
    const mesh = parseGlb(triangleGlb());
    expect(mesh.stats.triangleCount).toBe(1);
    expect(mesh.stats.bounds.min[0]).toBeCloseTo(10);
    expect(mesh.stats.bounds.max[0]).toBeCloseTo(11);
    expect(mesh.stats.bounds.min[2]).toBeCloseTo(0);
    expect(mesh.stats.bounds.max[2]).toBeCloseTo(1);
  });
});
