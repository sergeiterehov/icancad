import type { SketchEntity } from '@icancad/model';
import { entityControlPoints, type Point2 } from '@icancad/sketch';
import { describe, expect, it } from 'vitest';
import { draftMarkers } from '../src/sketch/draftMarkers';
import { ellipticalArcFrame } from '../src/sketch/ellipticalArcDraft';

/** Distance from a point to the ellipse of a frame, in its own coordinates. */
function offCurve(
  frame: { cx: number; cy: number; rx: number; ry: number; rotation: number },
  point: Point2,
) {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const dx = point[0] - frame.cx;
  const dy = point[1] - frame.cy;
  const x = cos * dx + sin * dy;
  const y = -sin * dx + cos * dy;
  return Math.abs((x * x) / (frame.rx * frame.rx) + (y * y) / (frame.ry * frame.ry) - 1);
}

describe('draft markers', () => {
  it('keep the radius step of an arc under the pointer', () => {
    const result = draftMarkers('arc', [[0, 0]], [10, 0]);
    expect(result.markers).toEqual([[0, 0]]);
    expect(result.cursorAtPointer).toBe(true);
  });

  it('move the end of an arc onto its circle', () => {
    // The end click only names an angle, so the marker is not where the pointer
    // is but on the rim at that angle.
    const result = draftMarkers(
      'arc',
      [
        [0, 0],
        [10, 0],
      ],
      [0, 30],
    );
    expect(result.cursorAtPointer).toBe(false);
    expect(result.markers).toHaveLength(3);
    expect(result.markers[2]![0]).toBeCloseTo(0, 6);
    expect(result.markers[2]![1]).toBeCloseTo(10, 6);
  });

  it('keep the half-axis handles of an ellipse on the ellipse', () => {
    const draft: Point2[] = [
      [0, 0],
      [20, 0],
    ];
    const hover: Point2 = [4, 7];
    const result = draftMarkers('ellipse', draft, hover);
    expect(result.cursorAtPointer).toBe(false);
    const frame = ellipticalArcFrame([0, 0], [20, 0], hover, [0, 0])!;
    // Centre, the major handle, and the minor handle the pointer is naming.
    expect(result.markers).toHaveLength(3);
    expect(offCurve(frame, result.markers[1]!)).toBeLessThan(1e-6);
    expect(offCurve(frame, result.markers[2]!)).toBeLessThan(1e-6);
  });

  it('put both ends of an elliptical arc on the ellipse', () => {
    const draft: Point2[] = [
      [0, 0],
      [20, 0],
      [3, 6],
      [7, 11],
    ];
    const hover: Point2 = [-9, 4];
    const result = draftMarkers('elliptical-arc', draft, hover);
    expect(result.cursorAtPointer).toBe(false);
    const frame = ellipticalArcFrame(draft[0]!, draft[1]!, draft[2]!, draft[3]!)!;
    expect(result.markers).toHaveLength(5);
    for (const marker of result.markers.slice(1)) {
      expect(offCurve(frame, marker)).toBeLessThan(1e-6);
    }
  });

  it('match the control points of the finished elliptical arc', () => {
    const draft: Point2[] = [
      [0, 0],
      [20, 0],
      [3, 6],
      [7, 11],
    ];
    const frame = ellipticalArcFrame(draft[0]!, draft[1]!, draft[2]!, draft[3]!)!;
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
    const markers = draftMarkers('elliptical-arc', draft, [3, 6]).markers;
    const handles = entityControlPoints(entity);
    // Centre, both axis handles and the start point line up with the entity.
    for (const index of [0, 1, 2, 3]) {
      expect(markers[index]![0]).toBeCloseTo(handles[index]![0], 6);
      expect(markers[index]![1]).toBeCloseTo(handles[index]![1], 6);
    }
  });

  it('draw the pointer itself for a tool that takes free points', () => {
    const result = draftMarkers('line', [[0, 0]], [5, 5]);
    expect(result.markers).toEqual([[0, 0]]);
    expect(result.cursorAtPointer).toBe(true);
  });
});
