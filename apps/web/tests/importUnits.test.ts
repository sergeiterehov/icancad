import type { MeshStats } from '@icancad/io';
import type { MeshUnit } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { importedMeshScale, scaledMeshStats } from '../src/kernel/importUnits';

const stats: MeshStats = {
  triangleCount: 12,
  vertexCount: 8,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  boundaryEdges: 0,
  watertight: true,
  volume: 1,
  surfaceArea: 6,
  componentCount: 1,
};

function source(unit: MeshUnit, scale = 1, transformScale = 1) {
  return { unit, scale, transform: { scale: transformScale } };
}

describe('imported mesh units', () => {
  it('converts every source unit to millimetres', () => {
    expect(importedMeshScale(source('mm'))).toBe(1);
    expect(importedMeshScale(source('cm'))).toBe(10);
    expect(importedMeshScale(source('m'))).toBe(1000);
    expect(importedMeshScale(source('in'))).toBe(25.4);
    expect(importedMeshScale(source('ft'))).toBe(304.8);
  });

  it('composes the unit with both scale fields', () => {
    expect(importedMeshScale(source('in', 2, 0.5))).toBeCloseTo(25.4);
  });

  it('scales volume and area with the mesh', () => {
    const scaled = scaledMeshStats(stats, 25.4, {
      min: [0, 0, 0],
      max: [25.4, 25.4, 25.4],
    });
    expect(scaled.bounds.max).toEqual([25.4, 25.4, 25.4]);
    expect(scaled.volume).toBeCloseTo(25.4 ** 3);
    expect(scaled.surfaceArea).toBeCloseTo(6 * 25.4 ** 2);
    expect(scaled.triangleCount).toBe(12);
    expect(scaled.watertight).toBe(true);
  });
});
