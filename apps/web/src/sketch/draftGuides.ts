import type { SketchEntity } from '@icancad/model';
import type { Point2 } from '@icancad/sketch';
import { ellipseFrame, type EllipticalArcFrame } from './ellipticalArcDraft';
import type { SketchTool } from './tool';

/**
 * The construction a draft implies, drawn thin and dotted under the solid
 * preview: the whole circle an arc is cut from, the ellipse an elliptical arc
 * belongs to, and the axes of either ellipse. A creator reads its radius or its
 * angle from these, so they are shown before the click that fixes it.
 */
export function draftGuides(
  tool: SketchTool,
  draft: readonly Point2[],
  hover: Point2 | null,
  newId: () => string,
): SketchEntity[] {
  const center = draft[0];
  if (!center) return [];
  const guide = (entity: Record<string, unknown>): SketchEntity =>
    ({ ...entity, id: newId(), construction: false }) as SketchEntity;
  const line = (from: Point2, to: Point2) =>
    guide({ type: 'line', x1: from[0], y1: from[1], x2: to[0], y2: to[1] });
  const circle = (middle: Point2, reach: Point2) => {
    const r = Math.hypot(reach[0] - middle[0], reach[1] - middle[1]);
    return r > 1e-4 ? [guide({ type: 'circle', cx: middle[0], cy: middle[1], r })] : [];
  };
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
    const reach = draft[1] ?? hover;
    if (!reach) return [];
    const spokes: Point2[] = draft.slice(1);
    // The pointer is the start radius or the end angle while either is open.
    if (hover && draft.length < 3) spokes.push(hover);
    return [...circle(center, reach), ...spokes.map((point) => line(center, point))];
  }

  if (tool === 'elliptical-arc' || tool === 'ellipse') {
    const fullArc = tool === 'elliptical-arc';
    if (draft.length < 2) {
      // Before the first axis exists, the pointer only names a length: a circle
      // for the arc, whose radius it becomes, and a half-height ellipse for the
      // ellipse tool, whose second radius is not chosen yet.
      const reach = hover;
      if (!reach) return [];
      const radius = Math.hypot(reach[0] - center[0], reach[1] - center[1]);
      if (!(radius > 1e-4)) return [];
      if (!fullArc) {
        return axes(
          {
            cx: center[0],
            cy: center[1],
            rx: radius,
            ry: radius * 0.5,
            rotation: Math.atan2(reach[1] - center[1], reach[0] - center[0]),
            startAngle: 0,
          },
          false,
        );
      }
      return circle(center, reach);
    }
    const frame = ellipseFrame(center, draft[1]!, draft[2] ?? hover ?? draft[1]!);
    return frame ? axes(frame, fullArc) : [];
  }

  return [];
}
