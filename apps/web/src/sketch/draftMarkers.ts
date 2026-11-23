import type { Point2 } from '@icancad/sketch';
import { arcDraftEndAngle, arcDraftPoints } from './arcDraft';
import {
  ellipseFrame,
  ellipticalArcEndAngle,
  ellipticalArcPoint,
  type EllipticalArcFrame,
} from './ellipticalArcDraft';
import type { SketchTool } from './tool';

export interface DraftMarkers {
  /** Points the draft shows, in the order the tool names its steps. */
  markers: Point2[];
  /** Whether the pointer itself is one of them and is drawn where it is. */
  cursorAtPointer: boolean;
}

const NONE: DraftMarkers = { markers: [], cursorAtPointer: true };

/**
 * The frame the ellipse of a draft has, with the second half-axis taken from
 * the pointer. Before that axis is picked the ellipse has no height of its own,
 * so the preview of it is half as tall as it is long, the same guess the ellipse
 * tool makes.
 */
function draftFrame(centre: Point2, major: Point2, minor: Point2 | null): EllipticalArcFrame {
  const frame = minor ? ellipseFrame(centre, major, minor) : null;
  if (frame) return frame;
  const rx = Math.hypot(major[0] - centre[0], major[1] - centre[1]);
  return {
    cx: centre[0],
    cy: centre[1],
    rx,
    ry: rx * 0.5,
    rotation: Math.atan2(major[1] - centre[1], major[0] - centre[0]),
    startAngle: 0,
  };
}

/**
 * Where the markers of a draft sit. A click of a curve tool names a centre, an
 * axis or an angle, so a marker left where the pointer was would float off the
 * shape being drawn. Every marker but the one the pointer itself stands for is
 * therefore projected onto the curve the clicks describe.
 */
export function draftMarkers(
  tool: SketchTool,
  points: readonly Point2[],
  hover: Point2 | null,
): DraftMarkers {
  const centre = points[0];
  if (!centre) return NONE;

  if (tool === 'arc') {
    const start = points[1];
    // The radius step lands under the pointer: the circle of the guide is drawn
    // through it, so the pointer is already on the curve.
    if (!start) return { markers: [centre], cursorAtPointer: true };
    const end = hover ? arcDraftEndAngle(centre, start, hover, null) : null;
    return { markers: arcDraftPoints(centre, start, end), cursorAtPointer: false };
  }

  if (tool === 'ellipse' || tool === 'elliptical-arc') {
    const major = points[1];
    if (!major)
      return hover
        ? { markers: [centre], cursorAtPointer: true }
        : { markers: [centre], cursorAtPointer: false };
    // Once the minor axis is picked the pointer names an angle instead, so it
    // only stands for the second half-axis while that axis is still open.
    const frame = draftFrame(centre, major, points[2] ?? hover);
    const markers: Point2[] = [
      centre,
      ellipticalArcPoint(frame, 0),
      ellipticalArcPoint(frame, Math.PI / 2),
    ];
    if (tool === 'ellipse') return { markers, cursorAtPointer: false };
    // The pointer names the second half-axis until that axis is picked; only
    // then does it stand for an angle on the ellipse.
    const startAngle =
      points.length >= 3
        ? points[3]
          ? ellipticalArcEndAngle(frame, points[3], null)
          : hover
            ? ellipticalArcEndAngle(frame, hover, null)
            : null
        : null;
    if (startAngle !== null) markers.push(ellipticalArcPoint(frame, startAngle));
    if (points[3] && hover) {
      markers.push(ellipticalArcPoint(frame, ellipticalArcEndAngle(frame, hover, startAngle)));
    }
    return { markers, cursorAtPointer: false };
  }

  return { markers: [...points], cursorAtPointer: true };
}
