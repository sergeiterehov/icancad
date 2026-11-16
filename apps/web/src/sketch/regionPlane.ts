import type { SketchEntity, SketchFeature, SketchFrame, Vec3 } from '@icancad/model';
import {
  sketchTopology,
  type Point2,
  type SketchTopologyFace,
  type SketchTopologyLoopCurve,
} from '@icancad/sketch';
import { sketchFrameOf } from './sectionPlane';

/** The box a region covers, in sketch coordinates. */
interface Extent {
  min: Point2;
  max: Point2;
}

function include(extent: Extent, x: number, y: number): void {
  extent.min[0] = Math.min(extent.min[0], x);
  extent.min[1] = Math.min(extent.min[1], y);
  extent.max[0] = Math.max(extent.max[0], x);
  extent.max[1] = Math.max(extent.max[1], y);
}

/**
 * Corners of a curve the run of it passes through.
 *
 * A region is known by a flattened outline, and a flattened arc never reaches
 * its own corner: the chord cuts the curve short. The corners are asked of the
 * curve itself, so the box is the box of the region and not of its polygon.
 * `toParameter` maps a point of the run back onto the curve's own angle, which
 * is what says whether a corner lies inside the run at all.
 */
function includeCorners(
  extent: Extent,
  run: readonly Point2[],
  toParameter: (point: Point2) => number,
  atParameter: (parameter: number) => Point2,
  corners: readonly number[],
): void {
  if (run.length === 0) return;
  // A step of the run is far shorter than a half turn, so a jump of more than
  // that is the angle wrapping round, not the curve running backwards.
  const parameters = run.map(toParameter);
  let previous = parameters[0]!;
  const unwrapped = parameters.map((parameter, index) => {
    if (index === 0) return parameter;
    let value = parameter;
    while (value - previous > Math.PI) value -= Math.PI * 2;
    while (previous - value > Math.PI) value += Math.PI * 2;
    previous = value;
    return value;
  });
  const from = Math.min(...unwrapped);
  const to = Math.max(...unwrapped);
  const slack = 1e-9;
  for (const corner of corners) {
    for (let turn = -2; turn <= 2; turn += 1) {
      const parameter = corner + turn * Math.PI * 2;
      if (parameter < from - slack || parameter > to + slack) continue;
      const [x, y] = atParameter(corner);
      include(extent, x, y);
    }
  }
}

/** The corners of a circle or an arc that lie on the run of it. */
function includeRoundCorners(
  extent: Extent,
  run: readonly Point2[],
  round: { cx: number; cy: number; r: number },
): void {
  const { cx, cy, r } = round;
  includeCorners(
    extent,
    run,
    ([x, y]) => Math.atan2(y - cy, x - cx),
    (angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)],
    [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2],
  );
}

/**
 * The corners of an ellipse that lie on the run of it. The parameter of a point
 * is the angle before the ellipse was turned, and a corner is where one
 * coordinate stops growing — two corners per axis, half a turn apart.
 */
function includeEllipseCorners(
  extent: Extent,
  run: readonly Point2[],
  ellipse: { cx: number; cy: number; rx: number; ry: number; rotation: number },
): void {
  const { cx, cy, rx, ry } = ellipse;
  // A sketch stores the turn of an ellipse in degrees.
  const rotation = (ellipse.rotation * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const at = (parameter: number): Point2 => [
    cx + rx * Math.cos(parameter) * cos - ry * Math.sin(parameter) * sin,
    cy + rx * Math.cos(parameter) * sin + ry * Math.sin(parameter) * cos,
  ];
  const toParameter = ([x, y]: Point2): number => {
    const dx = x - cx;
    const dy = y - cy;
    return Math.atan2((dy * cos - dx * sin) / ry, (dx * cos + dy * sin) / rx);
  };
  const xCorner = Math.atan2(-ry * sin, rx * cos);
  const yCorner = Math.atan2(ry * cos, rx * sin);
  includeCorners(
    extent,
    run,
    toParameter,
    at,
    [xCorner, yCorner, xCorner + Math.PI, yCorner + Math.PI],
  );
}

/** The points of one loop curve, and the corners the curve hides between them. */
function includeCurve(
  extent: Extent,
  curve: SketchTopologyLoopCurve,
  entities: ReadonlyMap<string, SketchEntity>,
): void {
  for (const [x, y] of curve.points) include(extent, x, y);
  const entity = entities.get(curve.entityId);
  if (!entity) return;
  if (entity.type === 'circle' || entity.type === 'arc') {
    includeRoundCorners(extent, curve.points, entity);
  } else if (entity.type === 'ellipse') {
    includeEllipseCorners(extent, curve.points, entity);
  }
  // A bezier has no corner to solve for, and its run is sampled finely enough
  // that the box of its points is the box of the curve.
}

/**
 * The box a region covers, in sketch coordinates. Holes sit inside the outer
 * loop, so every loop is walked and the box is the box of the whole region.
 */
function regionExtent(sketch: SketchFeature, region: SketchTopologyFace): Extent | null {
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]));
  const extent: Extent = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
  for (const loop of region.loops) {
    for (const curve of loop) includeCurve(extent, curve, entities);
  }
  return Number.isFinite(extent.min[0]) ? extent : null;
}

/**
 * The plane a region of a sketch lies in: the middle of the region and the
 * normal of the sketch, both in world space. The middle is the middle of the
 * extent, not of the material: a region shaped like an L covers half of its own
 * box, and a turn around the middle of its material would look off-centre.
 * Null when the region is gone — an entity it was made of has been deleted
 * since.
 */
export function sketchRegionPlane(
  sketch: SketchFeature,
  regionId: string,
  frame?: SketchFrame,
): { origin: Vec3; normal: Vec3 } | null {
  const plane = frame ?? sketchFrameOf(sketch);
  const region = sketchTopology(sketch.entities).faces.find((face) => face.id === regionId);
  if (!region) return null;
  const extent = regionExtent(sketch, region);
  const centre: Point2 = extent
    ? [(extent.min[0] + extent.max[0]) / 2, (extent.min[1] + extent.max[1]) / 2]
    : [0, 0];
  const origin: Vec3 = [
    plane.origin[0] + plane.xAxis[0] * centre[0] + plane.yAxis[0] * centre[1],
    plane.origin[1] + plane.xAxis[1] * centre[0] + plane.yAxis[1] * centre[1],
    plane.origin[2] + plane.xAxis[2] * centre[0] + plane.yAxis[2] * centre[1],
  ];
  return { origin, normal: plane.normal };
}
