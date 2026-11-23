import type { SketchEntity } from '@icancad/model';
import type { Point2 } from '@icancad/sketch';
import { ellipseFrame, type EllipticalArcFrame } from './ellipticalArcDraft';
import type { SketchTool } from './tool';

/**
 * The construction a draft implies, drawn thin and dotted under the solid
 * preview: the whole circle an arc is cut from, the whole ellipse an elliptical
 * arc belongs to, and the axes of either. A creator reads its radius, its
 * second half-axis or its angle from these, so they are shown before the click
 * that fixes it.
 *
 * The markers come from `draftMarkers`: they already sit on the curve, so the
 * spokes end on the shape instead of following the pointer.
 */
export function draftGuides(
  tool: SketchTool,
  markers: readonly Point2[],
  hover: Point2 | null,
  newId: () => string,
): SketchEntity[] {
  const centre = markers[0];
  if (!centre) return [];
  const guide = (entity: Record<string, unknown>): SketchEntity =>
    ({ ...entity, id: newId(), construction: false }) as SketchEntity;
  const line = (from: Point2, to: Point2) =>
    guide({ type: 'line', x1: from[0], y1: from[1], x2: to[0], y2: to[1] });
  const circle = (radius: number) =>
    radius > 1e-4 ? [guide({ type: 'circle', cx: centre[0], cy: centre[1], r: radius })] : [];
  const axes = (frame: EllipticalArcFrame, whole: boolean): SketchEntity[] => {
    const cos = Math.cos(frame.rotation);
    const sin = Math.sin(frame.rotation);
    const major: Point2 = [frame.cx + cos * frame.rx, frame.cy + sin * frame.rx];
    const minor: Point2 = [frame.cx - sin * frame.ry, frame.cy + cos * frame.ry];
    const guides: SketchEntity[] = [];
    if (whole) {
      guides.push(
        guide({
          type: 'ellipse',
          cx: frame.cx,
          cy: frame.cy,
          rx: frame.rx,
          ry: frame.ry,
          rotation: (frame.rotation * 180) / Math.PI,
        }),
      );
    }
    guides.push(line([frame.cx, frame.cy], major), line([frame.cx, frame.cy], minor));
    return guides;
  };

  if (tool === 'arc') {
    const reach = markers[1] ?? hover;
    if (!reach) return [];
    // The spokes end on the rim, so the angle of the arc is read from the shape.
    const spokes = markers.slice(1);
    if (spokes.length === 0 && hover) spokes.push(hover);
    return [
      ...circle(Math.hypot(reach[0] - centre[0], reach[1] - centre[1])),
      ...spokes.map((point) => line(centre, point)),
    ];
  }

  if (tool === 'ellipse' || tool === 'elliptical-arc') {
    const major = markers[1] ?? hover;
    if (!major) return [];
    const rx = Math.hypot(major[0] - centre[0], major[1] - centre[1]);
    if (!(rx > 1e-4)) return [];
    const frame = ellipseFrame(centre, major, markers[2] ?? hover ?? major) ?? {
      cx: centre[0],
      cy: centre[1],
      rx,
      ry: rx * 0.5,
      rotation: Math.atan2(major[1] - centre[1], major[0] - centre[0]),
      startAngle: 0,
    };
    // Before the second half-axis is picked the ellipse is only a guess, so it
    // is drawn as the full ellipse the shape will belong to.
    return axes(frame, true);
  }

  return [];
}
