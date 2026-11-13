import type { TessellationResult } from '@icancad/kernel';
import type {
  RevolveAxis,
  RevolveSpec,
  SketchEntity,
  SketchFeature,
  SketchFrame,
  Vec3,
} from '@icancad/model';
import { sketchFrameOf } from './sectionPlane';

/** A line in world space, ready to be handed to the kernel. */
export interface ResolvedRevolveAxis {
  origin: Vec3;
  direction: Vec3;
  /** False when a body edge is gone and the pose stored at pick time is used. */
  attached: boolean;
}

export interface RevolveAxisContext {
  meshes: Record<string, TessellationResult>;
  /** Sketch features of the project, for an axis drawn in a sketch. */
  sketches: readonly SketchFeature[];
  /** Frames frozen by the rebuild, keyed by sketch id. */
  frames?: Record<string, SketchFrame>;
}

/** Straightness tolerance: a bent polyline is no axis. */
const STRAIGHT_TOLERANCE = 1e-4;

const AXIS_DIRECTIONS: Record<'x' | 'y' | 'z', Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function unit(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function distanceToLine(point: Vec3, origin: Vec3, direction: Vec3): number {
  const offset = subtract(point, origin);
  const along = offset[0] * direction[0] + offset[1] * direction[1] + offset[2] * direction[2];
  return Math.hypot(
    offset[0] - direction[0] * along,
    offset[1] - direction[1] * along,
    offset[2] - direction[2] * along,
  );
}

/** The line a polyline lies on, or null when it bends or closes on itself. */
export function straightPolylineAxis(points: readonly number[]): ResolvedRevolveAxis | null {
  if (points.length < 6) return null;
  const start: Vec3 = [points[0]!, points[1]!, points[2]!];
  const last = points.length - 3;
  const end: Vec3 = [points[last]!, points[last + 1]!, points[last + 2]!];
  const direction = unit(subtract(end, start));
  if (!direction) return null;
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const tolerance = Math.max(STRAIGHT_TOLERANCE, length * STRAIGHT_TOLERANCE);
  for (let index = 3; index < points.length; index += 3) {
    const point: Vec3 = [points[index]!, points[index + 1]!, points[index + 2]!];
    if (distanceToLine(point, start, direction) > tolerance) return null;
  }
  return { origin: start, direction, attached: true };
}

function bodyEdgeAxis(
  axis: Extract<RevolveAxis, { kind: 'body-edge' }>,
  meshes: Record<string, TessellationResult>,
): ResolvedRevolveAxis | null {
  const mesh = meshes[axis.bodyId];
  const edge = mesh?.edges?.find((candidate) => candidate.id === axis.edgeId);
  if (edge) {
    const resolved = straightPolylineAxis(edge.points);
    // An edge that has become curved cannot carry a revolve anymore; the pose
    // it had when it was picked is the better fallback.
    if (resolved) return resolved;
  }
  const direction = unit(subtract(axis.end, axis.start));
  if (!direction) return null;
  return { origin: axis.start, direction, attached: false };
}

function sketchEdgeAxis(
  axis: Extract<RevolveAxis, { kind: 'sketch-edge' }>,
  context: RevolveAxisContext,
): ResolvedRevolveAxis | null {
  const sketch = context.sketches.find((candidate) => candidate.id === axis.sketchId);
  if (!sketch) return null;
  const entity = sketch.entities.find(
    (candidate): candidate is Extract<SketchEntity, { type: 'line' }> =>
      candidate.id === axis.entityId && candidate.type === 'line',
  );
  if (!entity) return null;
  const frame = context.frames?.[sketch.id] ?? sketchFrameOf(sketch);
  const from = worldPoint(frame, entity.x1, entity.y1);
  const to = worldPoint(frame, entity.x2, entity.y2);
  const direction = unit(subtract(to, from));
  if (!direction) return null;
  return { origin: from, direction, attached: true };
}

function worldPoint(frame: SketchFrame, x: number, y: number): Vec3 {
  return [
    frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y,
    frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y,
    frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y,
  ];
}

/** The line a revolve turns around, or null while the axis cannot be found. */
export function resolveRevolveAxis(
  axis: RevolveAxis | undefined,
  context: RevolveAxisContext,
): ResolvedRevolveAxis | null {
  if (!axis) return null;
  if (axis.kind === 'world') {
    return { origin: [0, 0, 0], direction: AXIS_DIRECTIONS[axis.axis], attached: true };
  }
  if (axis.kind === 'body-edge') return bodyEdgeAxis(axis, context.meshes);
  return sketchEdgeAxis(axis, context);
}

/** The axis a picked body edge stands for, or null when the edge is curved. */
export function bodyEdgeAxisRef(
  mesh: TessellationResult,
  bodyId: string,
  edgeId: string,
): Extract<RevolveAxis, { kind: 'body-edge' }> | null {
  const edge = mesh.edges?.find((candidate) => candidate.id === edgeId);
  if (!edge || !straightPolylineAxis(edge.points)) return null;
  const last = edge.points.length - 3;
  return {
    kind: 'body-edge',
    bodyId,
    edgeId,
    start: [edge.points[0]!, edge.points[1]!, edge.points[2]!],
    end: [edge.points[last]!, edge.points[last + 1]!, edge.points[last + 2]!],
  };
}

/** The angles the operation sweeps, in degrees; inverting mirrors both. */
export function revolveAngles(revolve: RevolveSpec): { start: number; end: number } {
  const sign = revolve.inverted ? -1 : 1;
  return { start: revolve.start * sign, end: revolve.end * sign };
}
