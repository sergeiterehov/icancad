import type { SketchEntity } from '@icancad/model';
import { entityControlPoints, type Point2 } from '@icancad/sketch';
import { describe, expect, it } from 'vitest';
import { arcDraftPoints, arcStartAngle } from '../src/sketch/arcDraft';
import { ellipseDraftPoints, ellipticalArcFrame } from '../src/sketch/ellipticalArcDraft';

describe('draft markers of a curve tool', () => {
  it('sit on the ellipse the clicks describe', () => {
    // Centre, the end of the first half-axis, a point naming the second one,
    // and the start angle — clicked well away from the curve.
    const draft: Point2[] = [
      [0, 0],
      [20, 0],
      [3, 7],
      [6, 9],
    ];
    const frame = ellipticalArcFrame(draft[0]!, draft[1]!, draft[2]!, draft[3]!)!;
    const markers = ellipseDraftPoints(draft, frame);
    const entity: SketchEntity = {
      id: 'e',
      type: 'elliptical-arc',
      construction: false,
      cx: frame.cx,
      cy: frame.cy,
      rx: frame.rx,
      ry: frame.ry,
      rotation: (frame.rotation * 180) / Math.PI,
      startAngle: frame.startAngle,
      endAngle: frame.startAngle,
    };
    const handles = entityControlPoints(entity);
    // Centre, both axis handles and the start point of the finished entity.
    for (const index of [0, 1, 2, 3]) {
      expect(markers[index]![0]).toBeCloseTo(handles[index === 3 ? 3 : index]![0], 6);
      expect(markers[index]![1]).toBeCloseTo(handles[index === 3 ? 3 : index]![1], 6);
    }
  });

  it('leaves the markers alone before the ellipse has a frame', () => {
    expect(ellipseDraftPoints([[0, 0]], null)).toEqual([[0, 0]]);
    expect(
      ellipseDraftPoints(
        [
          [0, 0],
          [5, 5],
        ],
        null,
      ),
    ).toEqual([
      [0, 0],
      [5, 5],
    ]);
  });

  it('moves the end of an arc onto its circle', () => {
    const origin: Point2 = [0, 0];
    const start: Point2 = [10, 0];
    const clicked: Point2 = [0, 30];
    const endAngle = arcStartAngle(origin, clicked);
    const markers = arcDraftPoints(origin, start, endAngle);
    expect(markers).toHaveLength(3);
    expect(markers[2]![0]).toBeCloseTo(0, 6);
    expect(markers[2]![1]).toBeCloseTo(10, 6);
  });
});
