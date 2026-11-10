import { describe, expect, it } from 'vitest';
import type { SketchEntity } from '@icancad/model';
import { sketchProfiles, type ProfileCurve } from '../src/index';
import arcSketch from './fixtures/arc-sketch.json';

function line(id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity {
  return { id, type: 'line', construction: false, x1, y1, x2, y2 };
}

function rectangle(): SketchEntity[] {
  return [
    line('l1', 0, 0, 20, 0),
    line('l2', 20, 0, 20, 10),
    line('l3', 20, 10, 0, 10),
    line('l4', 0, 10, 0, 0),
  ];
}

describe('sketch profiles', () => {
  it('builds an outer loop that walks the rectangle counter-clockwise', () => {
    const [region] = sketchProfiles(rectangle());
    expect(region).toBeDefined();
    expect(region!.area).toBeCloseTo(200, 6);
    expect(region!.holes).toEqual([]);

    const curves = region!.outer.curves;
    expect(curves).toHaveLength(4);
    const start = curves[0]!;
    expect(start.type).toBe('line');
    // The loop must be chained: every curve starts where the previous one ended.
    for (let index = 0; index < curves.length; index += 1) {
      const current = curves[index]! as Extract<typeof curves[number], { type: 'line' }>;
      const next = curves[(index + 1) % curves.length]! as typeof current;
      expect(Math.hypot(next.x1 - current.x2, next.y1 - current.y2)).toBeLessThan(1e-9);
    }
  });

  it('keeps arcs as arcs and marks the ones walked backwards', () => {
    const entities: SketchEntity[] = [
      line('b1', 0, 0, 40, 0),
      { id: 'a1', type: 'arc', construction: false, cx: 20, cy: 0, r: 20, startAngle: 0, endAngle: Math.PI },
    ];
    const [region] = sketchProfiles(entities);
    const arc = region!.outer.curves.find((curve) => curve.type === 'arc');
    expect(arc).toBeDefined();
    expect(arc).toMatchObject({ cx: 20, cy: 0, r: 20 });
  });

  it('moves a circle into the hole of its enclosing face', () => {
    const circle: SketchEntity = {
      id: 'c1',
      type: 'circle',
      construction: false,
      cx: 10,
      cy: 5,
      r: 3,
    };
    const regions = sketchProfiles([...rectangle(), circle]);
    expect(regions).toHaveLength(2);
    const ring = regions.find((candidate) => candidate.holes.length === 1);
    const disk = regions.find((candidate) => candidate.holes.length === 0 && candidate.outer.curves.length === 1);
    expect(ring?.holes[0]!.curves[0]).toMatchObject({ type: 'circle', cx: 10, cy: 5, r: 3 });
    expect((ring?.holes[0]!.curves[0] as { reversed?: boolean }).reversed).toBe(true);
    expect(disk?.area).toBeCloseTo(Math.PI * 9, 0);
  });

  it('keeps intersecting circle boundaries as exact arcs', () => {
    const a: SketchEntity = { id: 'a', type: 'circle', construction: false, cx: 0, cy: 0, r: 10 };
    const b: SketchEntity = {
      id: 'b',
      type: 'circle',
      construction: false,
      cx: 12,
      cy: 0,
      r: 10,
    };
    const regions = sketchProfiles([a, b]);
    expect(regions).toHaveLength(3);
    for (const region of regions) {
      // One exact arc from each circle, not a chain of chords.
      expect(region.outer.curves).toHaveLength(2);
      for (const curve of region.outer.curves) expect(curve.type).toBe('arc');
      expectClosedChain(region.outer.curves);
    }
  });

  it('ignores construction geometry and open contours', () => {
    expect(sketchProfiles([line('open1', 0, 0, 10, 0), line('open2', 10, 0, 10, 10)])).toEqual([]);
    const construction = [
      ...rectangle().map((entity) => ({ ...entity, construction: true })),
    ] as SketchEntity[];
    expect(sketchProfiles(construction)).toEqual([]);
  });
});

describe('sketch profiles of clockwise arcs', () => {
  it('keeps the geometry of a clockwise quarter arc', () => {
    const entities: SketchEntity[] = [
      line('l1', 0, 0, 10, 0),
      { id: 'a1', type: 'arc', construction: false, cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: -Math.PI / 2 },
      line('l2', 0, -10, 0, 0),
    ];
    const regions = sketchProfiles(entities);
    expect(regions).toHaveLength(1);
    const arc = regions[0]!.outer.curves.find((curve) => curve.type === 'arc') as
      | { startAngle: number; endAngle: number; reversed?: boolean }
      | undefined;
    expect(arc).toBeDefined();
    expect(arc!.endAngle).toBeGreaterThan(arc!.startAngle);
    expect(arc!.endAngle - arc!.startAngle).toBeCloseTo(Math.PI / 2, 6);
    expect(regions[0]!.area).toBeCloseTo((Math.PI * 100) / 4, 0);
  });
});

describe('sketch profiles of a real drawing', () => {
  it('closes a profile that mixes lines with a clockwise arc', () => {
    const entities = arcSketch as unknown as SketchEntity[];
    const regions = sketchProfiles(entities);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.outer.curves).toHaveLength(4);
    expect(regions[0]!.outer.curves.filter((curve) => curve.type === 'arc')).toHaveLength(1);
    expect(regions[0]!.depth).toBe(0);
    expectClosedChain(regions[0]!.outer.curves);
  });
});

function curveStart(curve: ProfileCurve): [number, number] {
  if (curve.type === 'line') return [curve.x1, curve.y1];
  if (curve.type === 'circle') return [curve.cx + curve.r, curve.cy];
  const angle = curve.reversed ? curve.endAngle : curve.startAngle;
  return [curve.cx + Math.cos(angle) * curve.r, curve.cy + Math.sin(angle) * curve.r];
}

function curveEnd(curve: ProfileCurve): [number, number] {
  if (curve.type === 'line') return [curve.x2, curve.y2];
  if (curve.type === 'circle') return [curve.cx + curve.r, curve.cy];
  const angle = curve.reversed ? curve.startAngle : curve.endAngle;
  return [curve.cx + Math.cos(angle) * curve.r, curve.cy + Math.sin(angle) * curve.r];
}

// The kernel builds a wire from these curves, so they have to join end to end.
function expectClosedChain(curves: readonly ProfileCurve[]): void {
  for (let index = 0; index < curves.length; index += 1) {
    const end = curveEnd(curves[index]!);
    const next = curveStart(curves[(index + 1) % curves.length]!);
    expect(Math.hypot(next[0] - end[0], next[1] - end[1])).toBeLessThan(1e-6);
  }
}
