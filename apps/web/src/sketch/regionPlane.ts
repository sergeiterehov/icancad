import type { SketchFeature, SketchFrame, Vec3 } from '@icancad/model';
import { sketchTopology, type Point2 } from '@icancad/sketch';
import { sketchFrameOf } from './sectionPlane';

/**
 * Centre of a polygon: the area-weighted average of its triangles, so a region
 * with a hole or an L-shape is centred where its material is, not where its
 * bounding box is.
 */
function polygonCentroid(points: readonly Point2[]): Point2 | null {
  if (points.length < 3) return null;
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    area += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    // A degenerate outline still has a middle: the average of its points.
    return [
      points.reduce((total, point) => total + point[0], 0) / points.length,
      points.reduce((total, point) => total + point[1], 0) / points.length,
    ];
  }
  return [x / (3 * area), y / (3 * area)];
}

/**
 * The plane a region of a sketch lies in: the centre of the region and the
 * normal of the sketch, both in world space. Null when the region is gone — an
 * entity it was made of has been deleted since.
 */
export function sketchRegionPlane(
  sketch: SketchFeature,
  regionId: string,
  frame?: SketchFrame,
): { origin: Vec3; normal: Vec3 } | null {
  const plane = frame ?? sketchFrameOf(sketch);
  const region = sketchTopology(sketch.entities).faces.find((face) => face.id === regionId);
  if (!region) return null;
  const centre = polygonCentroid(region.outline) ?? [0, 0];
  const origin: Vec3 = [
    plane.origin[0] + plane.xAxis[0] * centre[0] + plane.yAxis[0] * centre[1],
    plane.origin[1] + plane.xAxis[1] * centre[0] + plane.yAxis[1] * centre[1],
    plane.origin[2] + plane.xAxis[2] * centre[0] + plane.yAxis[2] * centre[1],
  ];
  return { origin, normal: plane.normal };
}
