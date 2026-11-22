import type { TessellationResult } from '@icancad/kernel';
import type { ExtrudeToBodyMode, Vec3 } from '@icancad/model';
import type { ProfileRegion } from '@icancad/sketch';

/**
 * A body a `to-body` extrude can stop at, with the span it covers along the
 * sweep measured over every probe point of the profile. The extrusion ends on
 * the body's front face (the one that faces the profile) or on its back face,
 * so both crossings of every probe matter.
 */
export interface ProfileHit {
  bodyId: string;
  /** Closest front crossing over all probes. */
  near: number;
  /** Deepest front crossing over all probes. */
  nearMax: number;
  /** Shallowest back crossing over all probes. */
  far: number;
  /** Deepest back crossing over all probes. */
  farMax: number;
}

/**
 * What a `to-body` extent needs from the model: the reach of its prism and how
 * far the reference body's surface is moved before the boolean.
 *
 * The tool is the prism minus the body with its surface offset, so it ends at
 * the same distance from the body everywhere — on a wall, a sphere or a boss —
 * instead of at a distance that vanishes where the surface runs along the sweep.
 */
export interface ToBodyPlan {
  /** Reach of the prism, measured along the sweep from the profile plane. */
  far: number;
  /** How far the surface moves along its normal: the gap the tool leaves. */
  offset: number;
  /** A layer also needs its other boundary: the surface moved out by its size. */
  outerOffset?: number;
  /** "Last" keeps the whole column: the front part plus the material. */
  whole: boolean;
}

export type ToBodyKind = 'first' | 'last';

/** Extra reach past the far face, so a boolean always contains the whole body. */
const REACH_MARGIN = 1;
/** A crossing this close to the profile plane is the plane itself. */
const CROSSING_EPSILON = 1e-4;
const MAX_PROBES = 48;

interface Frame {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
}

/**
 * Probe points of a profile in world coordinates: the contour, which is where a
 * face is usually met, and a few points inside it, because a body can also be
 * met under the middle of a profile (the far wall of a hole, for instance).
 */
export function profileSamples(regions: readonly ProfileRegion[], frame: Frame): Vec3[] {
  const points: Vec3[] = [];
  const add = (x: number, y: number) => {
    points.push([
      frame.origin[0] + frame.xAxis[0] * x + frame.yAxis[0] * y,
      frame.origin[1] + frame.xAxis[1] * x + frame.yAxis[1] * y,
      frame.origin[2] + frame.xAxis[2] * x + frame.yAxis[2] * y,
    ]);
  };
  for (const region of regions) {
    const outer = loopPoints(region.outer);
    for (const [x, y] of [...outer, ...region.holes.flatMap(loopPoints)]) add(x, y);
    if (outer.length < 3) continue;
    // A three by three grid over the region's box, keeping the points the
    // contour encloses: a body under the middle of the profile is found too.
    const xs = outer.map((point) => point[0]);
    const ys = outer.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (let row = 1; row <= 3; row += 1) {
      for (let column = 1; column <= 3; column += 1) {
        const x = minX + ((maxX - minX) * column) / 4;
        const y = minY + ((maxY - minY) * row) / 4;
        if (insideOutline(x, y, outer)) add(x, y);
      }
    }
  }
  if (points.length <= MAX_PROBES) return points;
  const step = points.length / MAX_PROBES;
  return Array.from({ length: MAX_PROBES }, (_, index) => points[Math.floor(index * step)]!);
}

/** Points along one loop of a profile, in the profile plane. */
function loopPoints(loop: ProfileRegion['outer']): [number, number][] {
  const points: [number, number][] = [];
  for (const curve of loop.curves) {
    if (curve.type === 'line') {
      points.push([curve.x1, curve.y1], [curve.x2, curve.y2]);
      continue;
    }
    if (curve.type === 'circle') {
      for (let index = 0; index < 4; index += 1) {
        const angle = (index * Math.PI) / 2;
        points.push([curve.cx + curve.r * Math.cos(angle), curve.cy + curve.r * Math.sin(angle)]);
      }
      continue;
    }
    if (curve.type === 'ellipse') {
      const span = (curve.endAngle ?? Math.PI * 2) - (curve.startAngle ?? 0);
      for (let index = 0; index <= 2; index += 1) {
        const angle = (curve.startAngle ?? 0) + (span * index) / 2;
        const x = curve.rx * Math.cos(angle);
        const y = curve.ry * Math.sin(angle);
        const cos = Math.cos(curve.rotation);
        const sin = Math.sin(curve.rotation);
        points.push([curve.cx + x * cos - y * sin, curve.cy + x * sin + y * cos]);
      }
      continue;
    }
    const span = curve.endAngle - curve.startAngle;
    for (let index = 0; index <= 2; index += 1) {
      const angle = curve.startAngle + (span * index) / 2;
      points.push([curve.cx + curve.r * Math.cos(angle), curve.cy + curve.r * Math.sin(angle)]);
    }
  }
  return points;
}

function insideOutline(x: number, y: number, outline: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const [ax, ay] = outline[index]!;
    const [bx, by] = outline[previous]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay || 1e-12) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Every crossing of the profile's probes with the bodies, folded into the four
 * extremes a `to-body` extent needs. Bodies the sweep misses are left out,
 * which is what tells the extent that it has nothing to stop at.
 */
export function traceProfile(
  meshes: Record<string, TessellationResult>,
  samples: readonly Vec3[],
  direction: Vec3,
): ProfileHit[] {
  const hits = new Map<string, ProfileHit>();
  for (const [bodyId, mesh] of Object.entries(meshes)) {
    const bounds = mesh.bbox;
    let near = Infinity;
    let nearMax = -Infinity;
    let far = Infinity;
    let farMax = -Infinity;
    for (const sample of samples) {
      if (!rayHitsBox(sample, direction, bounds.min, bounds.max)) continue;
      const crossings = meshCrossings(mesh, sample, direction)
        .filter((distance) => distance >= -CROSSING_EPSILON)
        .sort((a, b) => a - b);
      const entry = crossings[0];
      const exit = crossings[crossings.length - 1];
      if (entry === undefined || exit === undefined) continue;
      near = Math.min(near, entry);
      nearMax = Math.max(nearMax, entry);
      far = Math.min(far, exit);
      farMax = Math.max(farMax, exit);
    }
    if (nearMax === -Infinity || farMax <= CROSSING_EPSILON) continue;
    hits.set(bodyId, {
      bodyId,
      near: Math.max(near, 0),
      nearMax: Math.max(nearMax, 0),
      far: Math.max(far, 0),
      farMax,
    });
  }
  return [...hits.values()].sort((a, b) => a.near - b.near);
}

/**
 * The body a `to-body` extent stops at: the one the user picked, otherwise the
 * nearest one for a front extent and the farthest one for a back extent. A
 * picked body the sweep misses has no answer, so the operation reports an error
 * instead of building something else.
 */
export function pickReferenceBody(
  hits: readonly ProfileHit[],
  kind: ToBodyKind,
  bodyId?: string,
): string | null {
  if (bodyId) return hits.some((hit) => hit.bodyId === bodyId) ? bodyId : null;
  if (hits.length === 0) return null;
  if (kind === 'first')
    return hits.reduce((best, hit) => (hit.near < best.near ? hit : best)).bodyId;
  return hits.reduce((best, hit) => (hit.farMax > best.farMax ? hit : best)).bodyId;
}

/**
 * Reach of the prism and the offset of the reference body for one extent.
 *
 * A positive offset leaves that much between the tool and the body, on a wall as
 * on a sphere. A negative one builds a layer of that thickness standing on the
 * front face: the tool is what reaches the face minus what reaches the same face
 * moved out by that thickness. `embed` pulls the surface a hair into the body, so
 * a union joins it with material rather than touching it.
 */
/**
 * The signed offset a `to-body` extent stores from what the inspector asks for:
 * a gap stops that far in front of the face that ends the sweep, a shell keeps a
 * layer of that thickness standing on it, and the facing face is what decides
 * which way that is along the sweep.
 */
export function signedToBodyOffset(
  size: number,
  kind: ToBodyKind,
  mode: ExtrudeToBodyMode | undefined,
): number {
  if (mode === undefined) return size;
  if (mode === 'solid') return 0;
  const towardsProfile = kind === 'first' ? 1 : -1;
  return (mode === 'gap' ? 1 : -1) * towardsProfile * Math.abs(size);
}

export function toBodyPlan(
  hits: readonly ProfileHit[],
  bodyId: string,
  kind: ToBodyKind,
  offset: number,
  embed = 0,
): ToBodyPlan | null {
  const hit = hits.find((candidate) => candidate.bodyId === bodyId);
  if (!hit) return null;
  const layer = kind === 'first' && offset < 0;
  const distance = layer ? -embed : offset - embed;
  const thickness = layer ? -offset : 0;
  // Where the surface ends up, as a distance from the profile plane: an offset
  // onto or past the plane leaves nothing to build.
  if (hit.nearMax - distance <= CROSSING_EPSILON) return null;
  // The prism has to pass the body it ends on, moved out by as much as the
  // offset grows it, so the sliver behind the body is always cut off.
  const far = hit.farMax + Math.max(0, distance, thickness) + REACH_MARGIN;
  return {
    far,
    offset: distance,
    ...(layer ? { outerOffset: thickness } : {}),
    whole: kind === 'last',
  };
}

/** Triangle crossings of one ray, in any order. */
function meshCrossings(
  mesh: TessellationResult,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): number[] {
  const { positions, indices } = mesh;
  const crossings: number[] = [];
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle]! * 3;
    const b = indices[triangle + 1]! * 3;
    const c = indices[triangle + 2]! * 3;
    const distance = rayTriangle(
      origin,
      direction,
      [positions[a]!, positions[a + 1]!, positions[a + 2]!],
      [positions[b]!, positions[b + 1]!, positions[b + 2]!],
      [positions[c]!, positions[c + 1]!, positions[c + 2]!],
    );
    if (distance !== null) crossings.push(distance);
  }
  return crossings;
}

function rayTriangle(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): number | null {
  const edge1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edge2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p: Vec3 = [
    direction[1] * edge2[2] - direction[2] * edge2[1],
    direction[2] * edge2[0] - direction[0] * edge2[2],
    direction[0] * edge2[1] - direction[1] * edge2[0],
  ];
  const determinant = edge1[0] * p[0] + edge1[1] * p[1] + edge1[2] * p[2];
  if (Math.abs(determinant) < 1e-12) return null;
  const inverse = 1 / determinant;
  const t: Vec3 = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q: Vec3 = [
    t[1] * edge1[2] - t[2] * edge1[1],
    t[2] * edge1[0] - t[0] * edge1[2],
    t[0] * edge1[1] - t[1] * edge1[0],
  ];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  return (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
}

function rayHitsBox(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  min: Vec3,
  max: Vec3,
): boolean {
  let enter = -Infinity;
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = direction[axis]!;
    const o = origin[axis]!;
    // A probe starts in the air beside the body as often as inside its box.
    const low = Math.min(min[axis]!, max[axis]!);
    const high = Math.max(min[axis]!, max[axis]!);
    if (Math.abs(d) < 1e-12) {
      if (o < low || o > high) return false;
      continue;
    }
    const first = (low - o) / d;
    const second = (high - o) / d;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return false;
  }
  return true;
}
