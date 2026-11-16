import type { SketchEntity, SketchFeature, SketchFrame } from '@icancad/model';
import { sketchTopology } from '@icancad/sketch';
import { describe, expect, it } from 'vitest';
import { sketchRegionPlane } from '../src/sketch/regionPlane';

/** The sketch plane frame the tests measure in: plain sketch coordinates. */
const FRAME: SketchFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function sketchWith(entities: SketchEntity[]): SketchFeature {
  return {
    id: 'feat_sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints: [],
    references: [],
  };
}

function line(id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity {
  return { id, type: 'line', construction: false, x1, y1, x2, y2 };
}

/** Region ids of a sketch, smallest first, so a test can name the one it means. */
function regionIds(sketch: SketchFeature): string[] {
  return sketchTopology(sketch.entities).faces.map((face) => face.id);
}

/** Centre of the region as the plane of it reports, in sketch coordinates. */
function regionCentre(sketch: SketchFeature, regionId: string): [number, number] {
  const plane = sketchRegionPlane(sketch, regionId, FRAME);
  expect(plane).not.toBeNull();
  return [plane!.origin[0], plane!.origin[1]];
}

describe('sketch region plane', () => {
  it('centres a region on the middle of its extent, not on its material', () => {
    // An L: the material sits in two arms, so its mass centre is at (41.7,
    // 58.3), while the middle of the region — where a turn around it belongs —
    // is the middle of the square it fills half of.
    const sketch = sketchWith([
      line('a', 0, 0, 50, 0),
      line('b', 50, 0, 50, 50),
      line('c', 50, 50, 100, 50),
      line('d', 100, 50, 100, 100),
      line('e', 100, 100, 0, 100),
      line('f', 0, 100, 0, 0),
    ]);
    const [x, y] = regionCentre(sketch, regionIds(sketch)[0]!);
    expect(x).toBeCloseTo(50, 9);
    expect(y).toBeCloseTo(50, 9);
  });

  it('reaches the exact corner of an arc', () => {
    // A wedge led by an arc from 10° to 100°. The arc's highest point is at 90°,
    // which is not one of the points the outline is drawn with, so a flattened
    // outline stops short of it by the sagitta of its chords.
    const radius = 40;
    const start = (10 * Math.PI) / 180;
    const end = (100 * Math.PI) / 180;
    const sketch = sketchWith([
      {
        id: 'arc',
        type: 'arc',
        construction: false,
        cx: 0,
        cy: 0,
        r: radius,
        startAngle: start,
        endAngle: end,
      },
      line(
        'chord',
        radius * Math.cos(end),
        radius * Math.sin(end),
        radius * Math.cos(start),
        radius * Math.sin(start),
      ),
    ]);
    const [x, y] = regionCentre(sketch, regionIds(sketch)[0]!);
    expect(x).toBeCloseTo((radius * Math.cos(end) + radius * Math.cos(start)) / 2, 6);
    expect(y).toBeCloseTo((radius * Math.sin(start) + radius) / 2, 6);
  });

  it('measures a turned ellipse in its own axes', () => {
    const turn = 20;
    const rotation = (turn * Math.PI) / 180;
    const sketch = sketchWith([
      {
        id: 'ellipse',
        type: 'ellipse',
        construction: false,
        cx: 0,
        cy: 0,
        rx: 40,
        ry: 20,
        rotation: turn,
      },
      line('cut', 10, -30, 10, 30),
    ]);
    // The cap right of x = 10 reaches the ellipse's own corner, which the
    // outline of the ellipse runs past only by chord.
    const corner = Math.hypot(
      40 * Math.cos(rotation),
      20 * Math.sin(rotation),
    );
    const ids = regionIds(sketch);
    expect(ids.length).toBeGreaterThan(1);
    // The cap is the region that starts at the cut, so its middle lies right of
    // it; the rest of the ellipse has its middle on the other side.
    const centre = ids
      .map((id) => regionCentre(sketch, id))
      .find((point) => point[0] > 10);
    expect(centre!).toBeDefined();
    expect(corner).toBeGreaterThan(10);
    // Only the reach along x is asserted: the cap is not symmetric about the
    // x axis once the ellipse is turned, so its middle in y is not the axis.
    expect(centre![0]).toBeCloseTo((10 + corner) / 2, 6);
  });

  it('has no plane for a region that is gone', () => {
    const sketch = sketchWith([
      line('a', 0, 0, 10, 0),
      line('b', 10, 0, 10, 10),
      line('c', 10, 10, 0, 0),
    ]);
    expect(sketchRegionPlane(sketch, 'face_missing', FRAME)).toBeNull();
  });
});
