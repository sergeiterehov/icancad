import { createId, type SketchConstraint, type SketchEntity } from '@icancad/model';
import {
  clampPolygonSides,
  polygonRadiusFromApothem,
  polygonSidesBetween,
  polygonVertices,
  type Point2,
} from '@icancad/sketch';
import { snapConstraint } from './autoConstraints';
import type { SketchSnapInput } from './snap';

/**
 * Правильный многоугольник: a shape the sketch draws out of plain segments and
 * one construction circle.
 *
 * The circle is what makes the figure hold together: its corners lie on it, its
 * edges are all equal, and its corners meet. Together that is a regular polygon,
 * and that is exactly what the constraints say — no more, or the solver would
 * have two ways to say the same thing and report the figure as over-constrained.
 * That is also why a polygon whose edges touch a circle is still held by a
 * circle through its corners: tangency says the same thing twice for half of the
 * shapes, and the solver answers with a redundancy note.
 */

export interface PolygonInput {
  centre: Point2;
  /** The point that named the radius, which is also the first corner's way. */
  corner: Point2;
  /** The pointer that names how many corners the figure has. */
  cursor: Point2;
  /** The radius pointed at is the one the edges touch, not the corners. */
  internal?: boolean;
  /** What the two clicks snapped to, so the figure can be tied to them. */
  inputs?: readonly SketchSnapInput[];
  /**
   * The number of corners, when it is known without a pointer: the figure is
   * drawn as a guess while the radius itself is still being set.
   */
  sides?: number;
}

/**
 * The figure a polygon is drawn as before its own count is named — the way an
 * ellipse is drawn half as tall as it is long until its second axis is picked.
 */
export const POLYGON_DRAFT_SIDES = 5;

export interface PolygonGeometry {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  /** The construction circle the figure is drawn against. */
  circle: SketchEntity;
  lines: SketchEntity[];
  sides: number;
}

/** The hint a draft shows, one per step and one per kind of pointer. */
export type PolygonHintKey =
  | 'sketch.polygonCenter'
  | 'sketch.polygonRadius'
  | 'sketch.polygonRadiusTouch'
  | 'sketch.polygonSides'
  | 'sketch.polygonSidesTouch';

/**
 * What the next click of a polygon draft is for. A pointer with no keyboard —
 * a finger or a pen — is told to drag and to lift, never to hold Shift, because
 * there is no key to hold.
 */
export function polygonHint(points: number, keyless: boolean): PolygonHintKey {
  if (points === 0) return 'sketch.polygonCenter';
  if (points === 1) return keyless ? 'sketch.polygonRadiusTouch' : 'sketch.polygonRadius';
  return keyless ? 'sketch.polygonSidesTouch' : 'sketch.polygonSides';
}

/** How many corners the figure has: the one given, or the one the pointer asks for. */
export function polygonSides(
  input: Pick<PolygonInput, 'centre' | 'corner' | 'cursor' | 'sides'>,
): number {
  return input.sides === undefined
    ? polygonSidesBetween(input.centre, input.corner, input.cursor)
    : clampPolygonSides(input.sides);
}

/** The figure the three clicks describe, or null when the radius is nothing. */
export function polygonGeometry(input: PolygonInput): PolygonGeometry | null {
  const sides = polygonSides(input);
  const [cx, cy] = input.centre;
  const radius = Math.hypot(input.corner[0] - cx, input.corner[1] - cy);
  if (!(radius > 1e-6)) return null;
  const rotation = Math.atan2(input.corner[1] - cy, input.corner[0] - cx);
  // An internal radius is the one the middle of every edge stands at, so the
  // corners — and the circle they hold the figure on — are further out. The
  // circle is always the one the corners lie on: one circle is enough to say
  // "all corners the same distance away", and a figure whose edges touch a
  // circle instead says the same thing with one relation more than it needs.
  const circleRadius = input.internal
    ? polygonRadiusFromApothem(radius, sides)
    : radius;
  const vertices = polygonVertices({ centre: input.centre, radius: circleRadius, sides, rotation });

  const circle: SketchEntity = {
    id: createId('entity'),
    type: 'circle',
    construction: true,
    cx,
    cy,
    r: circleRadius,
  };
  const lines: SketchEntity[] = vertices.map((from, index) => {
    const to = vertices[(index + 1) % sides] ?? from;
    return {
      id: createId('entity'),
      type: 'line',
      construction: false,
      x1: from[0],
      y1: from[1],
      x2: to[0],
      y2: to[1],
    };
  });

  const constraints: SketchConstraint[] = [];
  const add = (type: SketchConstraint['type'], refs: SketchConstraint['refs']) => {
    constraints.push({ id: createId('con'), type, refs } as SketchConstraint);
  };

  // The figure is closed: a corner is one point, not two that happen to touch.
  for (let index = 0; index < sides; index += 1) {
    add('coincident', [
      { entityId: lines[index]!.id, pointIndex: 1 },
      { entityId: lines[(index + 1) % sides]!.id, pointIndex: 0 },
    ]);
  }
  // Equal edges, and every corner on the one circle. A cyclic polygon with equal
  // edges is a regular one, so these two are the whole of "stays itself".
  for (let index = 1; index < sides; index += 1) {
    add('equal', [{ entityId: lines[0]!.id }, { entityId: lines[index]!.id }]);
  }
  for (const line of lines) {
    add('point-on-circle', [{ entityId: line.id, pointIndex: 0 }, { entityId: circle.id }]);
  }

  // The clicks may have landed on something: the centre and the first corner
  // keep it, so the figure stays where it was put.
  const [centreInput, cornerInput] = input.inputs ?? [];
  if (centreInput) {
    const joint = snapConstraint(circle, 0, centreInput);
    if (joint) constraints.push(joint);
  }
  if (cornerInput) {
    const joint = snapConstraint(lines[0]!, 0, cornerInput);
    if (joint) constraints.push(joint);
  }

  return { entities: [...lines, circle], constraints, circle, lines, sides };
}
