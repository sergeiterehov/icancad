import type { TessellationResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';

/** A curve where a curved face turns away from the sketch plane. */
export interface SilhouetteCurve {
  points: Vec3[];
  closed: boolean;
}

function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(length > 0)) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * The contour a face shows when it is looked at along the sketch plane normal:
 * the curves where the surface turns away from the viewer. Boundary edges are
 * not part of it — they are projected as the body's edges, and a flat face has
 * no silhouette at all because its normals all point the same way.
 *
 * Two details make the result a handful of smooth curves instead of confetti:
 * vertices are welded by position, because a closed surface stores its seam
 * twice and the seam would otherwise read as a border, and the view direction
 * is tilted by a hair when a vertex sits exactly on the silhouette, because a
 * curve that runs through vertices has no clear path through the triangles.
 */
export function faceSilhouettes(
  mesh: TessellationResult,
  faceId: number,
  direction: Vec3,
): SilhouetteCurve[] {
  const base = normalize(direction);
  if (!base) return [];

  const position = (index: number): Vec3 => [
    mesh.positions[index * 3] ?? 0,
    mesh.positions[index * 3 + 1] ?? 0,
    mesh.positions[index * 3 + 2] ?? 0,
  ];
  const normal = (index: number): Vec3 => [
    mesh.normals[index * 3] ?? 0,
    mesh.normals[index * 3 + 1] ?? 0,
    mesh.normals[index * 3 + 2] ?? 0,
  ];

  const welded = new Map<string, number>();
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  const weld = (index: number): number => {
    const at = position(index);
    const key = `${round(at[0])},${round(at[1])},${round(at[2])}`;
    const known = welded.get(key);
    if (known !== undefined) return known;
    welded.set(key, points.length);
    points.push(at);
    normals.push(normal(index));
    return points.length - 1;
  };

  const triangles: number[][] = [];
  const edges = new Map<string, { first: number; second: number }>();
  for (let triangle = 0; triangle < mesh.faceIds.length; triangle += 1) {
    if (mesh.faceIds[triangle] !== faceId) continue;
    const base3 = triangle * 3;
    const corners = [
      weld(mesh.indices[base3] ?? 0),
      weld(mesh.indices[base3 + 1] ?? 0),
      weld(mesh.indices[base3 + 2] ?? 0),
    ];
    triangles.push(corners);
    for (let corner = 0; corner < 3; corner += 1) {
      const first = corners[corner]!;
      const second = corners[(corner + 1) % 3]!;
      if (first === second) continue;
      edges.set(edgeKey(first, second), { first, second });
    }
  }
  if (triangles.length === 0) return [];

  // Keep the silhouette off the vertices: a view tilted by a fraction of a
  // degree picks one clear path through the mesh, and moves the curve by less
  // than a micron.
  const side = cross(base, Math.abs(base[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  const tiltAxis = normalize(side) ?? [1, 0, 0];
  const facingWith = (view: Vec3, index: number): number => {
    const value = normals[index]!;
    return value[0] * view[0] + value[1] * view[1] + value[2] * view[2];
  };
  const touchesVertex = (view: Vec3): boolean => {
    for (let index = 0; index < points.length; index += 1) {
      if (Math.abs(facingWith(view, index)) < 1e-6) return true;
    }
    return false;
  };
  let view = base;
  for (const angle of [1e-5, 1e-4, 1e-3]) {
    if (!touchesVertex(view)) break;
    const tilted: Vec3 = [
      view[0] + tiltAxis[0] * angle,
      view[1] + tiltAxis[1] * angle,
      view[2] + tiltAxis[2] * angle,
    ];
    view = normalize(tilted) ?? view;
  }

  const facing = (index: number): number => facingWith(view, index);
  const flat = 1e-3;
  let spansTheView = false;
  for (let index = 0; index < points.length; index += 1) {
    if (Math.abs(facingWith(base, index)) >= flat) {
      spansTheView = true;
      break;
    }
  }
  // A face seen exactly edge-on is all noise: it shows no surface at all. The
  // test uses the requested direction, because the tilt above would otherwise
  // invent a silhouette along the whole surface.
  if (!spansTheView) return [];

  const crossings = new Map<string, Vec3>();
  for (const [key, edge] of edges) {
    // A border edge carries the point where the silhouette runs into the edge
    // of the face, which keeps the curve attached to the boundary.
    const first = facing(edge.first);
    const second = facing(edge.second);
    if (first * second >= 0) continue;
    const t = first / (first - second);
    const from = points[edge.first]!;
    const to = points[edge.second]!;
    crossings.set(key, [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ]);
  }
  if (crossings.size === 0) return [];

  // The two crossings of one triangle are neighbours along the silhouette.
  const links = new Map<string, string[]>();
  const connect = (first: string, second: string) => {
    const firstLinks = links.get(first) ?? [];
    if (!firstLinks.includes(second)) firstLinks.push(second);
    links.set(first, firstLinks);
    const secondLinks = links.get(second) ?? [];
    if (!secondLinks.includes(first)) secondLinks.push(first);
    links.set(second, secondLinks);
  };
  for (const corners of triangles) {
    const keys: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const key = edgeKey(corners[corner]!, corners[(corner + 1) % 3]!);
      if (crossings.has(key)) keys.push(key);
    }
    for (let index = 0; index < keys.length; index += 1) {
      for (let other = index + 1; other < keys.length; other += 1) {
        connect(keys[index]!, keys[other]!);
      }
    }
  }

  const visited = new Set<string>();
  const walk = (start: string): SilhouetteCurve | null => {
    const keys = [start];
    visited.add(start);
    let current = start;
    for (;;) {
      const next = (links.get(current) ?? []).find((key) => !visited.has(key));
      if (!next) break;
      visited.add(next);
      keys.push(next);
      current = next;
    }
    const closed = keys.length > 2 && (links.get(current) ?? []).includes(start);
    const curve = keys.map((key) => crossings.get(key)!);
    return curve.length >= 2 ? { points: curve, closed } : null;
  };

  const curves: SilhouetteCurve[] = [];
  // Open curves start at their ends, so a path is walked in one piece.
  for (const [key, neighbours] of links) {
    if (neighbours.length !== 1 || visited.has(key)) continue;
    const curve = walk(key);
    if (curve) curves.push(curve);
  }
  for (const key of crossings.keys()) {
    if (visited.has(key)) continue;
    const curve = walk(key);
    if (curve) curves.push(curve);
  }
  return curves;
}
