import { describe, expect, it } from 'vitest';
import { exportStlBinary, isBinaryStl, parseStl } from '../src/stl';

const triangle = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('STL', () => {
  it('round-trips a binary STL', () => {
    const bytes = exportStlBinary([triangle]);
    expect(isBinaryStl(bytes)).toBe(true);
    const parsed = parseStl(bytes);
    expect(parsed.stats.triangleCount).toBe(1);
    expect(parsed.stats.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    expect(Array.from(parsed.positions.slice(0, 9))).toEqual(Array.from(triangle.positions));
  });

  it('parses an ASCII STL', () => {
    const ascii = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 5 0 0
    vertex 0 5 0
  endloop
endfacet
endsolid test`;
    const parsed = parseStl(new TextEncoder().encode(ascii));
    expect(parsed.stats.triangleCount).toBe(1);
    expect(parsed.stats.bounds.max).toEqual([5, 5, 0]);
    expect(isBinaryStl(new TextEncoder().encode(ascii))).toBe(false);
  });

  it('parses uppercase ASCII STL keywords', () => {
    const ascii = `SOLID test
FACET NORMAL 0 0 1
  OUTER LOOP
    VERTEX 0 0 0
    VERTEX 5 0 0
    VERTEX 0 5 0
  ENDLOOP
ENDFACET
ENDSOLID test`;
    const parsed = parseStl(new TextEncoder().encode(ascii));
    expect(parsed.stats.triangleCount).toBe(1);
    expect(isBinaryStl(new TextEncoder().encode(ascii))).toBe(false);
  });

  it('parses ASCII STL numbers with exponents', () => {
    const ascii = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 5.0e-1 0 0
    vertex 0 5.0E+1 0
  endloop
endfacet
endsolid test`;
    const parsed = parseStl(new TextEncoder().encode(ascii));
    expect(parsed.stats.triangleCount).toBe(1);
    expect(parsed.stats.bounds.max).toEqual([0.5, 50, 0]);
  });

  it('accepts binary STL files with trailing bytes', () => {
    const bytes = exportStlBinary([triangle]);
    const padded = new Uint8Array(bytes.byteLength + 13);
    padded.set(bytes);
    padded.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], bytes.byteLength);
    expect(isBinaryStl(padded)).toBe(true);
    expect(parseStl(padded).stats.triangleCount).toBe(1);
  });

  it('recovers a binary STL whose header count is zero', () => {
    const bytes = exportStlBinary([triangle]);
    new DataView(bytes.buffer).setUint32(80, 0, true);
    expect(isBinaryStl(bytes)).toBe(true);
    expect(parseStl(bytes).stats.triangleCount).toBe(1);
  });

  it('reports boundary edges for open meshes', () => {
    const parsed = parseStl(exportStlBinary([triangle]));
    expect(parsed.stats.boundaryEdges).toBe(3);
    expect(parsed.stats.watertight).toBe(false);
  });
});
