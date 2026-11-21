import type {
  BodyEdge,
  BooleanAllParams,
  BooleanParams,
  BoxParams,
  EdgeTreatmentParams,
  EdgeTreatmentResult,
  ExportStepParams,
  ExportStepResult,
  FaceCentreParams,
  FaceCentreResult,
  HealthResult,
  KernelErrorCode,
  KernelStatusEvent,
  MakeBoxResult,
  MakeFacePrismParams,
  MakeFaceRevolveParams,
  MakePrimitiveParams,
  MakePrismParams,
  MakeRevolveParams,
  OffsetShapeParams,
  ProfileCurve,
  ProfileLoop,
  RevolveAxisLine,
  ShapeStats,
  ShellParams,
  ShellResult,
  SplitSolid,
  TransformShapeParams,
  SplitSolidsParams,
  SplitSolidsResult,
  TessellationQuality,
  TessellationResult,
} from './protocol';
import { DEFAULT_TESSELLATION_QUALITY } from './protocol';
import type {
  OcctBindings,
  OcctBooleanMaker,
  OcctEdgeMaker,
  OcctFaceMapper,
  OcctPolygonOnTriangulation,
  OcctShape,
  OcctTransformation,
  OcctTriangulation,
} from './occt-types';

export const OCCT_VERSION = '7.4.0p1';

export type LoadProgress = (loadedBytes: number, totalBytes: number) => void;
export type OcctLoader = (onProgress: LoadProgress) => Promise<OcctBindings>;

export class KernelOpError extends Error {
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.name = 'KernelOpError';
    this.code = code;
  }
}

/** Coarse spatial bucket for matching the same topological edge seen from two faces. */
const EDGE_BUCKET_SCALE = 100;

/** How thin a face has to be at its own normal to count as flat, in mm. */
const FACE_FLAT_TOLERANCE = 1e-3;

/**
 * A unit vector lying in the plane with the given normal, taken from the world
 * axes so that the same face is always measured along the same two directions.
 */
function perpendicularTo(normal: readonly [number, number, number]): [number, number, number] {
  const axes: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const aligned = (axis: [number, number, number]) =>
    Math.abs(axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2]);
  let base = axes[0]!;
  for (const axis of axes) if (aligned(axis) < aligned(base)) base = axis;
  const cross: [number, number, number] = [
    base[1] * normal[2] - base[2] * normal[1],
    base[2] * normal[0] - base[0] * normal[2],
    base[0] * normal[1] - base[1] * normal[0],
  ];
  const length = Math.hypot(...cross);
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}

function edgeBucketKey(points: readonly number[]): string {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < points.length; index += 3) {
    const x = points[index]!;
    const y = points[index + 1]!;
    const z = points[index + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  return center.map((value) => Math.round(value * EDGE_BUCKET_SCALE)).join(',');
}

function polygonPoints(
  polygon: OcctPolygonOnTriangulation,
  triangulation: OcctTriangulation,
  transformation: OcctTransformation,
): number[] {
  const count = polygon.NbNodes();
  const nodes = polygon.Nodes();
  const points: number[] = [];
  for (let index = 1; index <= count; index += 1) {
    const node = nodes.Value(index);
    const point = triangulation.Nodes().Value(node).Transformed(transformation);
    points.push(point.X(), point.Y(), point.Z());
  }
  return points;
}

function polygonClosed(points: readonly number[]): boolean {
  if (points.length < 6) return false;
  const last = points.length - 3;
  return (
    Math.abs(points[0]! - points[last]!) < 1e-6 &&
    Math.abs(points[1]! - points[last + 1]!) < 1e-6 &&
    Math.abs(points[2]! - points[last + 2]!) < 1e-6
  );
}

/** Distance from a point to a polyline stored as a flat xyz array. */
function pointToPolyline(points: readonly number[], x: number, y: number, z: number): number {
  let best = Infinity;
  for (let index = 0; index + 5 < points.length; index += 3) {
    const ax = points[index]!;
    const ay = points[index + 1]!;
    const az = points[index + 2]!;
    const dx = points[index + 3]! - ax;
    const dy = points[index + 4]! - ay;
    const dz = points[index + 5]! - az;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / lengthSquared));
    const distance = Math.hypot(x - (ax + dx * t), y - (ay + dy * t), z - (az + dz * t));
    if (distance < best) best = distance;
  }
  return best;
}

/** How far one polyline lies from another, in the worst place. */
function polylineDistance(from: readonly number[], to: readonly number[]): number {
  let worst = 0;
  const step = Math.max(1, Math.ceil(from.length / 3 / 48)) * 3;
  for (let index = 0; index + 2 < from.length; index += step) {
    const distance = pointToPolyline(to, from[index]!, from[index + 1]!, from[index + 2]!);
    if (distance > worst) worst = distance;
  }
  return worst;
}

/**
 * Two tessellations of the same curve stay within their chord deflection of
 * each other, so a rebuilt edge is still recognisable past this margin.
 */
const TREATMENT_EDGE_TOLERANCE = DEFAULT_TESSELLATION_QUALITY.linearDeflection * 2.5;

/**
 * The corner an edge sits in, read from the triangles of the two faces next to
 * it. Free space between two faces meets at a convex edge; the material fills
 * the corner when each face leaves the edge on the far side of the other's
 * plane.
 */
function edgeCorner(
  edge: BodyEdge,
  triangleRanges: ReadonlyArray<[number, number] | undefined>,
  buffers: TessellationBuffers,
): { wedge: number; convex: boolean } | null {
  const middle = Math.floor(edge.points.length / 6) * 3;
  const at = [edge.points[middle]!, edge.points[middle + 1]!, edge.points[middle + 2]!];
  const nearest = (faceId: number | undefined) => {
    if (faceId === undefined) return null;
    const range = triangleRanges[faceId];
    if (!range) return null;
    let best: { centroid: number[]; normal: number[]; distance: number } | null = null;
    for (let triangle = range[0]; triangle < range[0] + range[1]; triangle += 1) {
      const centroid = [0, 0, 0];
      const normal = [0, 0, 0];
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = buffers.indices[triangle * 3 + corner]!;
        for (let axis = 0; axis < 3; axis += 1) {
          centroid[axis]! += buffers.positions[vertex * 3 + axis]! / 3;
          normal[axis]! += buffers.normals[vertex * 3 + axis]! / 3;
        }
      }
      const distance = Math.hypot(
        centroid[0]! - at[0]!,
        centroid[1]! - at[1]!,
        centroid[2]! - at[2]!,
      );
      if (best && distance >= best.distance) continue;
      best = { centroid, normal, distance };
    }
    return best;
  };
  const first = nearest(edge.faceIds[0]);
  const second = nearest(edge.faceIds[1]);
  if (!first || !second) return null;
  const cosine = Math.max(
    -1,
    Math.min(
      1,
      first.normal[0]! * second.normal[0]! +
        first.normal[1]! * second.normal[1]! +
        first.normal[2]! * second.normal[2]!,
    ),
  );
  const convex =
    (second.centroid[0]! - at[0]!) * first.normal[0]! +
      (second.centroid[1]! - at[1]!) * first.normal[1]! +
      (second.centroid[2]! - at[2]!) * first.normal[2]! +
      (first.centroid[0]! - at[0]!) * second.normal[0]! +
      (first.centroid[1]! - at[1]!) * second.normal[1]! +
      (first.centroid[2]! - at[2]!) * second.normal[2]! <
    0;
  return { wedge: Math.PI - Math.acos(cosine), convex };
}

interface TessellationBuffers {
  positions: number[];
  normals: number[];
  indices: number[];
  faceIds: number[];
}

/** B-rep edges of a shape, kept so an edge treatment can address them again. */
interface ShapeEdges {
  edges: BodyEdge[];
  shapes: Map<string, OcctShape>;
}

/** How far a face prism reaches behind its face, to overlap the body it joins. */
const FACE_PRISM_EMBED = 0.01;

/** Below this a treatment is not worth building. */
const MIN_TREATMENT_SIZE = 0.01;

/** Bisection steps used to find the largest size that still builds. */
const TREATMENT_SEARCH_STEPS = 6;

/** Below this a shell wall is not worth building. */
const MIN_SHELL_THICKNESS = 0.01;

/** Bisection steps used to find the largest thickness that still builds. */
const SHELL_SEARCH_STEPS = 6;

/** Tolerance handed to the offset maker. */
const SHELL_TOLERANCE = 1e-3;

export class KernelEngine {
  private oc: OcctBindings | null = null;
  private loading: Promise<OcctBindings> | null = null;
  private loadMs = 0;
  private readonly shapes = new Map<string, OcctShape>();
  /**
   * Edges each tessellated shape reported, with their B-rep counterparts. A
   * treatment reuses them instead of walking the shape again.
   */
  private readonly shapeEdges = new Map<string, ShapeEdges>();
  /** Counter for the throwaway ids used while a treatment is built in passes. */
  private treatmentPass = 0;
  /** Counter for the unique file names STEP exports use in the wasm filesystem. */
  private exportPass = 0;
  /**
   * Edge selections that only build in passes: the largest size they took and
   * the smallest size they rejected.
   */
  private readonly treatmentSplits = new Map<
    string,
    { good: number; bad: number; index: number }
  >();
  /**
   * Shell selections that only build up to a certain thickness: the largest
   * thickness that worked and the smallest one that was rejected.
   */
  private readonly shellSplits = new Map<string, { good: number; bad: number }>();

  constructor(
    private readonly loader: OcctLoader,
    private readonly onStatus?: (event: KernelStatusEvent) => void,
  ) {}

  async init(): Promise<HealthResult> {
    if (this.oc) {
      return { occtVersion: OCCT_VERSION, loadMs: this.loadMs };
    }
    if (!this.loading) {
      const started = performance.now();
      this.onStatus?.({ type: 'status', phase: 'loading-occt' });
      this.loading = this.loader((loaded, total) => {
        this.onStatus?.({
          type: 'status',
          phase: 'loading-occt',
          ratio: total > 0 ? Math.min(1, loaded / total) : undefined,
        });
      })
        .then((oc) => {
          this.oc = oc;
          this.loadMs = performance.now() - started;
          this.onStatus?.({
            type: 'status',
            phase: 'ready',
            occtVersion: OCCT_VERSION,
            loadMs: this.loadMs,
          });
          return oc;
        })
        .catch((error: unknown) => {
          this.loading = null;
          this.onStatus?.({
            type: 'status',
            phase: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        });
    }
    await this.loading;
    return { occtVersion: OCCT_VERSION, loadMs: this.loadMs };
  }

  get shapeCount(): number {
    return this.shapes.size;
  }

  makeBox(params: BoxParams): MakeBoxResult {
    const oc = this.requireOc();
    const { shapeId, dx, dy, dz } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    for (const [name, value] of Object.entries({ dx, dy, dz })) {
      if (!Number.isFinite(value) || value <= 1e-6) {
        throw new KernelOpError('INVALID_PARAMS', `Box ${name} must be a positive number`);
      }
    }
    const at = params.at;
    const shape = at
      ? new oc.BRepPrimAPI_MakeBox_2(new oc.gp_Pnt_3(at[0], at[1], at[2]), dx, dy, dz).Shape()
      : new oc.BRepPrimAPI_MakeBox_1(dx, dy, dz).Shape();
    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
  }

  /** Builds any of the primitive operations; a box keeps its corner anchor. */
  makePrimitive(params: MakePrimitiveParams): MakeBoxResult {
    const oc = this.requireOc();
    const { shapeId } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    const at = params.at ?? [0, 0, 0];
    const axis = new oc.gp_Ax2_2(
      new oc.gp_Pnt_3(at[0], at[1], at[2]),
      new oc.gp_Dir_4(0, 0, 1),
      new oc.gp_Dir_4(1, 0, 0),
    );

    let shape: OcctShape;
    switch (params.kind) {
      case 'box':
        return this.makeBox({ shapeId, dx: params.dx, dy: params.dy, dz: params.dz, at });
      case 'sphere':
        this.primitiveLength('radius', params.radius);
        shape = new oc.BRepPrimAPI_MakeSphere_5(
          new oc.gp_Pnt_3(at[0], at[1], at[2]),
          params.radius,
        ).Shape();
        break;
      case 'cylinder':
        this.primitiveLength('radius', params.radius);
        this.primitiveLength('height', params.height);
        shape = new oc.BRepPrimAPI_MakeCylinder_3(axis, params.radius, params.height).Shape();
        break;
      case 'cone': {
        this.primitiveLength('bottomRadius', params.bottomRadius);
        this.primitiveLength('topRadius', params.topRadius, true);
        this.primitiveLength('height', params.height);
        if (params.bottomRadius <= 1e-6 && params.topRadius <= 1e-6) {
          throw new KernelOpError('INVALID_PARAMS', 'A cone needs a non-zero radius');
        }
        shape = new oc.BRepPrimAPI_MakeCone_3(
          axis,
          params.bottomRadius,
          params.topRadius,
          params.height,
        ).Shape();
        break;
      }
      case 'torus':
        this.primitiveLength('majorRadius', params.majorRadius);
        this.primitiveLength('tubeRadius', params.tubeRadius);
        if (params.tubeRadius >= params.majorRadius) {
          throw new KernelOpError(
            'INVALID_PARAMS',
            'The tube radius must be smaller than the major radius',
          );
        }
        shape = new oc.BRepPrimAPI_MakeTorus_5(axis, params.majorRadius, params.tubeRadius).Shape();
        break;
      case 'pyramid': {
        this.primitiveLength('radius', params.radius);
        this.primitiveLength('height', params.height);
        if (!Number.isInteger(params.sides) || params.sides < 3 || params.sides > 120) {
          throw new KernelOpError('INVALID_PARAMS', 'A pyramid needs 3 to 120 sides');
        }
        const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
        // The first vertex sits half a step from +X, so the +X axis points at
        // the centre of an edge; the next vertex is the one nearest that axis.
        for (let side = 0; side < params.sides; side += 1) {
          const angle = Math.PI / params.sides + (Math.PI * 2 * side) / params.sides;
          polygon.Add_1(
            new oc.gp_Pnt_3(
              at[0] + params.radius * Math.cos(angle),
              at[1] + params.radius * Math.sin(angle),
              at[2],
            ),
          );
        }
        polygon.Close();
        const apex = new oc.BRepBuilderAPI_MakeVertex(
          new oc.gp_Pnt_3(at[0], at[1], at[2] + params.height),
        ).Vertex();
        const loft = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6);
        loft.AddWire(polygon.Wire());
        loft.AddVertex(apex);
        loft.Build();
        if (!loft.IsDone()) {
          throw new KernelOpError('OP_FAILED', 'Pyramid loft failed');
        }
        shape = this.positiveVolume(loft.Shape()) ?? loft.Shape();
        break;
      }
      case 'capsule': {
        this.primitiveLength('radius', params.radius);
        this.primitiveLength('height', params.height);
        const bottom = new oc.BRepPrimAPI_MakeSphere_5(
          new oc.gp_Pnt_3(at[0], at[1], at[2]),
          params.radius,
        ).Shape();
        const top = new oc.BRepPrimAPI_MakeSphere_5(
          new oc.gp_Pnt_3(at[0], at[1], at[2] + params.height),
          params.radius,
        ).Shape();
        const cylinder = new oc.BRepPrimAPI_MakeCylinder_3(
          axis,
          params.radius,
          params.height,
        ).Shape();
        shape = this.boolean(this.boolean(cylinder, bottom, 'fuse'), top, 'fuse');
        shape = this.unify(shape);
        break;
      }
    }

    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
  }

  private primitiveLength(label: string, value: number, allowZero = false): void {
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 1e-6)) {
      throw new KernelOpError(
        'INVALID_PARAMS',
        `Primitive ${label} must be ${allowZero ? 'non-negative' : 'positive'}`,
      );
    }
  }

  makePrism(params: MakePrismParams): MakeBoxResult {
    this.requireOc();
    const { shapeId, regions } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (regions.length === 0) {
      throw new KernelOpError('INVALID_PARAMS', 'A prism needs at least one region');
    }
    if (
      params.distances.length === 0 ||
      params.distances.some((value) => !Number.isFinite(value) || Math.abs(value) <= 1e-6)
    ) {
      throw new KernelOpError('INVALID_PARAMS', 'Extrude distance must be a positive number');
    }

    let shape: OcctShape | null = null;
    for (const region of regions) {
      // Holes are removed with booleans: wire orientation inside a face is easy to
      // get wrong, while cutting the hole prisms is exact and orientation-free.
      let solid: OcctShape | null = this.extrudeLoop(region.outer, params);
      for (const hole of region.holes) {
        const holeSolid = this.extrudeLoop(hole, params);
        solid = this.boolean(solid, holeSolid, 'cut');
      }
      shape = shape ? this.boolean(shape, solid, 'fuse') : solid;
    }
    if (!shape) throw new KernelOpError('OP_FAILED', 'Extrude produced no geometry');

    // Regions that touch are fused into one solid, but OCCT keeps their shared
    // boundaries as extra coplanar faces. Merge them so the top of a union is
    // one face, as a user expects when picking it again.
    shape = this.unify(shape);
    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
  }

  // Extrudes one face of an existing solid. This is what the Objects panel
  // uses for a face picked on a body: the face itself is swept along its normal,
  // so arcs and holes keep their exact geometry.
  makeFacePrism(params: MakeFacePrismParams): MakeBoxResult {
    const oc = this.requireOc();
    const { shapeId, sourceShapeId, faceId, normal, distances, embed } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (!Number.isInteger(faceId) || faceId < 0) {
      throw new KernelOpError('INVALID_PARAMS', 'Face id must be a non-negative integer');
    }
    const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
    if (!Number.isFinite(normalLength) || normalLength <= 1e-9) {
      throw new KernelOpError('INVALID_PARAMS', 'Face normal must be a unit vector');
    }
    if (
      distances.length === 0 ||
      distances.some((value) => !Number.isFinite(value) || Math.abs(value) <= 1e-6)
    ) {
      throw new KernelOpError('INVALID_PARAMS', 'Extrude distance must be a positive number');
    }

    const face = this.findFace(this.getShape(sourceShapeId), faceId);
    if (!face) {
      throw new KernelOpError('INVALID_PARAMS', `Face ${faceId} does not exist on the body`);
    }
    // Only a flat face can be swept into a closed prism; a cylindrical or
    // spherical side would sweep into a self-intersecting shell.
    if (
      new oc.BRepAdaptor_Surface_2(face, true).GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane
    ) {
      throw new KernelOpError('FACE_NOT_PLANAR', `Face ${faceId} is not planar`);
    }
    const [nx, ny, nz] = normal.map((value) => value / normalLength) as [number, number, number];

    // A tool that only stands on the face it was made from touches the body it
    // joins without intersecting it, and the union leaves slivers behind. A
    // sliver of overlap behind the face turns the contact into a real one, so
    // the tool reaches back into material that is already there. A body of its
    // own must not grow, so only a tool does this.
    //
    // The overlap is a part of the first prism, never a second prism stacked on
    // it: on a slanted face two stacked prisms have faces in the very planes of
    // the body, and merging them leaves a seam that stops the later union from
    // joining the tool to the body.
    const first = distances[0]!;
    const embedded = embed && first > 0;
    let shape: OcctShape | null = null;
    for (const [index, distance] of distances.entries()) {
      // The overlap is part of the first prism, not a second prism stacked on
      // it: on a slanted face two stacked prisms have faces in the very planes
      // of the body, and merging them leaves a seam that stops the later union
      // from joining the tool to the body.
      const overlap = index === 0 && embedded ? FACE_PRISM_EMBED : 0;
      const length = distance + overlap;
      const vector = new oc.gp_Vec_4(nx * length, ny * length, nz * length);
      const prism = new oc.BRepPrimAPI_MakePrism_1(face, vector, false, true);
      if (!prism.IsDone()) {
        throw new KernelOpError('OP_FAILED', 'Extrude failed for a body face');
      }
      let part = prism.Shape();
      if (overlap > 0) {
        // The part grew along the normal, so it moves back into the material
        // by the overlap it was given.
        const back = new oc.gp_Trsf_1();
        back.SetTranslation_1(new oc.gp_Vec_4(-nx * overlap, -ny * overlap, -nz * overlap));
        part = new oc.BRepBuilderAPI_Transform_2(part, back, true).Shape();
      }
      shape = shape ? this.boolean(shape, part, 'fuse') : part;
    }
    if (!shape) throw new KernelOpError('OP_FAILED', 'Extrude produced no geometry');

    shape = this.unify(shape);
    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
  }

  /**
   * Turns sketch regions around an axis. The profile face is placed at the
   * start angle and then swept to the end angle, so the angles the user sets
   * are exactly the angles the solid occupies.
   */
  makeRevolve(params: MakeRevolveParams): MakeBoxResult {
    this.requireOc();
    const { shapeId, regions } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (regions.length === 0) {
      throw new KernelOpError('INVALID_PARAMS', 'A revolve needs at least one region');
    }
    const sweep = revolveSweep(params.startAngle, params.endAngle);
    let shape: OcctShape | null = null;
    for (const region of regions) {
      // Holes go the same way as a prism: cut the hole solid out of the outer
      // one, which needs no orientation of the contour.
      let solid = this.revolveLoop(region.outer, params, sweep);
      for (const hole of region.holes) {
        solid = this.boolean(solid, this.revolveLoop(hole, params, sweep), 'cut');
      }
      shape = shape ? this.boolean(shape, solid, 'fuse') : solid;
    }
    if (!shape) throw new KernelOpError('OP_FAILED', 'Revolve produced no geometry');

    shape = this.unify(shape);
    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
  }

  /** Turns one face of an existing solid around an axis. */
  makeFaceRevolve(params: MakeFaceRevolveParams): MakeBoxResult {
    const { shapeId, sourceShapeId, faceId, axis } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (!Number.isInteger(faceId) || faceId < 0) {
      throw new KernelOpError('INVALID_PARAMS', 'Face id must be a non-negative integer');
    }
    const face = this.findFace(this.getShape(sourceShapeId), faceId);
    if (!face) {
      throw new KernelOpError('INVALID_PARAMS', `Face ${faceId} does not exist on the body`);
    }
    const sweep = revolveSweep(params.startAngle, params.endAngle);
    const shape = this.unify(this.revolveFace(face, axis, sweep));
    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
  }

  booleanShape(params: BooleanParams): MakeBoxResult {
    const { shapeId, baseShapeId, toolShapeId, op } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    const base = this.getShape(baseShapeId);
    const tool = this.getShape(toolShapeId);
    const maker = this.booleanMaker(base, tool, op);
    const fused = maker.Shape();
    const shape = op === 'fuse' ? this.unify(fused) : fused;
    this.shapes.set(shapeId, shape);
    const result: MakeBoxResult = { shapeId, stats: this.countTopology(shape) };
    // A cut trims the faces around the tool and `IsSame` loses them, so the
    // boolean itself is asked where each face came from.
    if (params.trackFaces) result.facesFromBase = this.mappedFaces(maker, shape, base);
    return result;
  }

  /**
   * One request for many placements of the same tool. Copies that keep apart
   * are gathered into one compound, which OCCT intersects with the base in a
   * single pass: an array of twenty bosses costs one boolean instead of twenty.
   *
   * Copies that overlap are another matter. A boolean reads each of its two
   * arguments as a set of shapes that do not overlap one another, and a copy
   * hidden inside another is simply not applied — a row of cubes spaced closer
   * than their own size would lose every second cube. So overlapping copies are
   * applied in turn, which is what the caller would do anyway; only the round
   * trips are saved.
   */
  booleanAll(params: BooleanAllParams): MakeBoxResult {
    const { shapeId, op } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (params.tools.length === 0) {
      throw new KernelOpError('INVALID_PARAMS', 'A boolean needs at least one tool');
    }
    const base = this.getShape(params.baseShapeId);
    const placed = params.tools.map((tool) => this.copyAt(tool.sourceShapeId, tool.matrix));

    let shape: OcctShape;
    let owners: number[] | undefined;
    if (this.apartFromEachOther(placed)) {
      const tool = placed.length === 1 ? placed[0]! : this.compound(placed);
      const maker = this.booleanMaker(base, tool, op);
      const fused = maker.Shape();
      shape = op === 'fuse' ? this.unify(fused) : fused;
      if (params.trackFaces) owners = this.mappedFaces(maker, shape, base);
    } else {
      shape = base;
      for (const tool of placed) {
        const maker = this.booleanMaker(shape, tool, op);
        const next = maker.Shape();
        if (params.trackFaces) {
          // Each step maps its own result onto what it was given, so the run is
          // walked back to the faces of the base the caller knows.
          const step = this.mappedFaces(maker, next, shape);
          owners = step.map((from) => (from >= 0 ? (owners ? (owners[from] ?? -1) : from) : -1));
        }
        shape = next;
      }
      if (op === 'fuse') {
        const faces = owners?.length;
        shape = this.unify(shape);
        // A merge reorders faces; a mapping that no longer lines up would name
        // the wrong operation for a face, so it is left out instead.
        if (faces !== undefined && this.countTopology(shape).faces !== faces) owners = undefined;
      }
    }

    this.shapes.set(shapeId, shape);
    const result: MakeBoxResult = { shapeId, stats: this.countTopology(shape) };
    if (owners) result.facesFromBase = owners;
    return result;
  }

  /** Whether the boxes of the shapes keep clear of one another. */
  private apartFromEachOther(shapes: readonly OcctShape[]): boolean {
    const oc = this.requireOc();
    // The plain box, not the optimal one: it is a hundred times cheaper on a
    // curved surface and it only ever comes out larger, which sends a doubtful
    // run down the careful path instead of the wrong way.
    const boxes = shapes.map((shape) => {
      const box = new oc.Bnd_Box_1();
      oc.BRepBndLib.Add(shape, box, false);
      return {
        min: [box.GetXmin(), box.GetYmin(), box.GetZmin()],
        max: [box.GetXmax(), box.GetYmax(), box.GetZmax()],
      };
    });
    // Boxes that touch are not clear of each other: their faces still interfere.
    const slack = 1e-6;
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const a = boxes[first]!;
        const b = boxes[second]!;
        const clear = [0, 1, 2].some(
          (axis) => a.max[axis]! + slack < b.min[axis]! || b.max[axis]! + slack < a.min[axis]!,
        );
        if (!clear) return false;
      }
    }
    return true;
  }


  /**
   * Extracts the solids of a shape as independent shapes. A cut that separates
   * a body leaves one compound behind; taking the solids apart is what lets the
   * document keep each part as its own body.
   */
  splitSolids(params: SplitSolidsParams): SplitSolidsResult {
    const oc = this.requireOc();
    if (!params.shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (!params.prefix) throw new KernelOpError('INVALID_PARAMS', 'prefix is required');
    const source = this.getShape(params.shapeId);

    const sourceFaces: OcctShape[] = [];
    const faceExplorer = new oc.TopExp_Explorer_2(
      source,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (faceExplorer.More()) {
      sourceFaces.push(faceExplorer.Current());
      faceExplorer.Next();
    }

    const solids: SplitSolid[] = [];
    const explorer = new oc.TopExp_Explorer_2(
      source,
      oc.TopAbs_ShapeEnum.TopAbs_SOLID,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let index = 0;
    while (explorer.More()) {
      const solid = oc.TopoDS.Solid_1(explorer.Current());
      const shapeId = `${params.prefix}:solid-${index}`;
      this.shapes.set(shapeId, solid);

      const facesFromShape: number[] = [];
      const solidFaces = new oc.TopExp_Explorer_2(
        solid,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (solidFaces.More()) {
        const face = solidFaces.Current();
        let match = -1;
        for (let candidate = 0; candidate < sourceFaces.length; candidate += 1) {
          if (sourceFaces[candidate]!.IsSame(face)) {
            match = candidate;
            break;
          }
        }
        facesFromShape.push(match);
        solidFaces.Next();
      }

      let volume = 0;
      let center: [number, number, number] = [0, 0, 0];
      try {
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_1(solid, props, false, false, false);
        volume = props.Mass();
        if (volume > 0) {
          const massCenter = props.CentreOfMass();
          center = [massCenter.X(), massCenter.Y(), massCenter.Z()];
        }
      } catch {
        // An open shell has no volume; it still splits, it just sorts last.
      }

      solids.push({
        shapeId,
        facesFromShape,
        stats: this.countTopology(solid),
        volume,
        center,
      });
      index += 1;
      explorer.Next();
    }
    return { solids };
  }

  tessellate(
    shapeId: string,
    quality: TessellationQuality = DEFAULT_TESSELLATION_QUALITY,
  ): TessellationResult {
    const oc = this.requireOc();
    const shape = this.getShape(shapeId);

    new oc.BRepMesh_IncrementalMesh_2(
      shape,
      quality.linearDeflection,
      false,
      quality.angularDeflection,
      false,
    );

    const buffers: TessellationBuffers = { positions: [], normals: [], indices: [], faceIds: [] };
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let triangleCount = 0;
    let faceIndex = 0;
    // A B-rep edge is seen from both faces that share it. The first face that
    // reports it builds the polyline; the second only adds its face index.
    const edgeBuckets = new Map<string, Array<{ shape: OcctShape; edge: BodyEdge }>>();
    const allEdges: BodyEdge[] = [];
    const edgeShapes = new Map<string, OcctShape>();
    // Where each face put its vertices, so an edge can ask its faces for the
    // normals next to it once the whole shape is meshed.
    const faceRanges: Array<[number, number]> = [];
    // Where each face put its triangles, so an edge can look at the triangles
    // next to it instead of at its own end vertices.
    const triangleRanges: Array<[number, number]> = [];
    let edgeCount = 0;

    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (explorer.More()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      const location = new oc.TopLoc_Location_1();
      // The handle may hold nothing: meshing leaves a face it could not mesh
      // — a sliver left by a boolean, say — without a triangulation, and the
      // shape is still worth drawing with the faces that did come out.
      const triangulationHandle = oc.BRep_Tool.Triangulation(face, location);
      const triangulation = triangulationHandle ? triangulationHandle.get() : null;

      if (triangulationHandle && triangulation) {
        const nbNodes = triangulation.NbNodes();
        const nbTriangles = triangulation.NbTriangles();
        const nodes = triangulation.Nodes();
        const triangles = triangulation.Triangles();
        const transformation = location.Transformation();
        const base = buffers.positions.length / 3;
        faceRanges[faceIndex] = [base, nbNodes];
        triangleRanges[faceIndex] = [triangleCount, nbTriangles];

        for (let i = 1; i <= nbNodes; i += 1) {
          const point = nodes.Value(i).Transformed(transformation);
          const x = point.X();
          const y = point.Y();
          const z = point.Z();
          buffers.positions.push(x, y, z);
          updateBounds(min, max, x, y, z);
        }

        const faceNormals = new Float64Array(nbNodes * 3);
        for (let i = 1; i <= nbTriangles; i += 1) {
          const triangle = triangles.Value(i);
          const i1 = triangle.Value(1) - 1;
          const i2 = triangle.Value(2) - 1;
          const i3 = triangle.Value(3) - 1;
          const a = base + i1;
          const b = base + i2;
          const c = base + i3;

          const ax = buffers.positions[a * 3]!;
          const ay = buffers.positions[a * 3 + 1]!;
          const az = buffers.positions[a * 3 + 2]!;
          const bx = buffers.positions[b * 3]!;
          const by = buffers.positions[b * 3 + 1]!;
          const bz = buffers.positions[b * 3 + 2]!;
          const cx = buffers.positions[c * 3]!;
          const cy = buffers.positions[c * 3 + 1]!;
          const cz = buffers.positions[c * 3 + 2]!;

          const ux = bx - ax;
          const uy = by - ay;
          const uz = bz - az;
          const vx = cx - ax;
          const vy = cy - ay;
          const vz = cz - az;
          const flip = reversed ? -1 : 1;
          const nx = (uy * vz - uz * vy) * flip;
          const ny = (uz * vx - ux * vz) * flip;
          const nz = (ux * vy - uy * vx) * flip;

          for (const local of [i1, i2, i3]) {
            const offset = local * 3;
            faceNormals[offset] = (faceNormals[offset] ?? 0) + nx;
            faceNormals[offset + 1] = (faceNormals[offset + 1] ?? 0) + ny;
            faceNormals[offset + 2] = (faceNormals[offset + 2] ?? 0) + nz;
          }

          if (reversed) buffers.indices.push(a, c, b);
          else buffers.indices.push(a, b, c);
          buffers.faceIds.push(faceIndex);
          triangleCount += 1;
        }

        for (let i = 0; i < nbNodes; i += 1) {
          const offset = i * 3;
          const nx = faceNormals[offset] ?? 0;
          const ny = faceNormals[offset + 1] ?? 0;
          const nz = faceNormals[offset + 2] ?? 0;
          const length = Math.hypot(nx, ny, nz) || 1;
          buffers.normals.push(nx / length, ny / length, nz / length);
        }

        const edgeExplorer = new oc.TopExp_Explorer_2(
          face,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );
        while (edgeExplorer.More()) {
          const edgeShape = oc.TopoDS.Edge_1(edgeExplorer.Current());
          edgeExplorer.Next();
          const raw = oc.BRep_Tool.PolygonOnTriangulation_1(
            edgeShape,
            triangulationHandle,
            location,
          ) as unknown;
          const polygon =
            raw && typeof (raw as { get?: unknown }).get === 'function'
              ? (raw as { get(): OcctPolygonOnTriangulation }).get()
              : (raw as OcctPolygonOnTriangulation | null);
          if (!polygon) continue;
          const points = polygonPoints(polygon, triangulation, transformation);
          if (points.length < 6) continue;
          const bucketKey = edgeBucketKey(points);
          const bucket = edgeBuckets.get(bucketKey) ?? [];
          let record = bucket.find((candidate) => candidate.shape.IsSame(edgeShape));
          if (!record) {
            record = {
              shape: edgeShape,
              edge: {
                id: String(edgeCount),
                faceIds: [],
                points,
                closed: polygonClosed(points),
              },
            };
            edgeCount += 1;
            bucket.push(record);
            edgeBuckets.set(bucketKey, bucket);
            allEdges.push(record.edge);
            edgeShapes.set(record.edge.id, edgeShape);
          }
          if (!record.edge.faceIds.includes(faceIndex)) record.edge.faceIds.push(faceIndex);
        }
      }

      faceIndex += 1;
      explorer.Next();
    }

    // Edges are the only handle a treatment has on the shape, so they outlive
    // the tessellation for as long as the shape does.
    const keptEdges = allEdges.filter((edge) => edge.faceIds.length === 2);
    for (const edge of keptEdges) {
      const corner = edgeCorner(edge, triangleRanges, buffers);
      if (corner) {
        edge.wedge = corner.wedge;
        edge.convex = corner.convex;
      }
    }
    this.shapeEdges.set(shapeId, {
      edges: keptEdges,
      shapes: new Map(keptEdges.map((edge) => [edge.id, edgeShapes.get(edge.id)!] as const)),
    });

    return {
      positions: new Float32Array(buffers.positions),
      normals: new Float32Array(buffers.normals),
      indices: new Uint32Array(buffers.indices),
      faceIds: new Uint32Array(buffers.faceIds),
      triangleCount,
      vertexCount: buffers.positions.length / 3,
      bbox: {
        min: Number.isFinite(min[0]) ? min : [0, 0, 0],
        max: Number.isFinite(max[0]) ? max : [0, 0, 0],
      },
      // A seam inside one face has only one adjacent face and is not an edge
      // the user can pick or fillet.
      edges: keptEdges,
    };
  }

  shapeStats(shapeId: string): ShapeStats {
    return this.countTopology(this.getShape(shapeId));
  }

  /**
   * Chamfers or rounds the given edges of a body. A size that does not fit the
   * geometry is reduced instead of failing: the built body is returned together
   * with the size it was actually made with, so the operation never becomes an
   * error just because the user pulled too far.
   */
  treatEdges(params: EdgeTreatmentParams): EdgeTreatmentResult {
    if (!params.shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (!Number.isFinite(params.size) || params.size <= 0) {
      throw new KernelOpError('INVALID_PARAMS', 'size must be positive');
    }
    const source = this.getShape(params.sourceShapeId);
    const { edges, chosen } = this.treatmentEdges(params);
    if (edges.length === 0) throw new KernelOpError('NO_EDGES', 'No edges to treat');
    // A set that both fills a corner and breaks one is the one the kernel's
    // corner blending gets wrong: it accepts the build and returns a body with
    // a chamfer folded across it. Those sets are built in passes instead, and
    // the concave edges go first — they are the ones a later pass would have to
    // cut into, and starting with them keeps the size the user asked for.
    const mixed =
      chosen.length > 1 &&
      chosen.some((edge) => edge.convex === false) &&
      chosen.some((edge) => edge.convex === true);
    if (mixed) {
      const order = chosen
        .map((edge, index) => ({ edge, shape: edges[index]! }))
        .sort((a, b) => Number(a.edge.convex ?? true) - Number(b.edge.convex ?? true));
      for (const [index, item] of order.entries()) {
        chosen[index] = item.edge;
        edges[index] = item.shape;
      }
    }

    // A selection the kernel refuses as a set is refused at every size, so
    // bisecting it again on every preview rebuild only repeats a known answer.
    // Such a selection is remembered, and it skips the bisection next time.
    const splitKey = `${params.sourceShapeId}|${params.kind}|${chosen
      .map((edge) => edge.id)
      .sort()
      .join(',')}`;
    const knownSplit = this.treatmentSplits.has(splitKey);

    let shape: OcctShape | null = null;
    let maker: OcctEdgeMaker | null = null;
    let splitFirst: { shape: OcctShape; maker: OcctEdgeMaker } | null = null;
    let applied = params.size;

    const direct = mixed ? null : this.buildTreatment(params.kind, source, edges, params.size);
    if (direct) {
      shape = direct.shape;
      maker = direct.maker;
    } else if (!knownSplit && !mixed) {
      // Bisect between nothing and the rejected size. Six steps are enough to
      // land within a couple of percent of the limit.
      let low = 0;
      let high = params.size;
      for (let step = 0; step < TREATMENT_SEARCH_STEPS; step += 1) {
        const mid = (low + high) / 2;
        if (mid < MIN_TREATMENT_SIZE) break;
        const attempt = this.buildTreatment(params.kind, source, edges, mid);
        if (attempt) {
          low = mid;
          applied = mid;
          shape = attempt.shape;
          maker = attempt.maker;
        } else {
          high = mid;
        }
      }
    }

    if (!shape) {
      const split = this.buildTreatmentInPasses(
        params.kind,
        source,
        edges,
        chosen,
        params.size,
        splitKey,
      );
      if (split) {
        if (this.treatmentSplits.size > 64) this.treatmentSplits.clear();
        this.treatmentSplits.set(splitKey, {
          good: split.applied,
          bad: Math.max(split.failedAt, split.applied),
          index: split.index,
        });
        shape = split.shape;
        maker = split.maker;
        splitFirst = split.first;
        applied = split.applied;
      }
    }

    if (!shape) {
      throw new KernelOpError(
        'EDGE_TREATMENT_FAILED',
        `These edges cannot be ${params.kind === 'fillet' ? 'rounded' : 'chamfered'}`,
      );
    }

    this.shapes.set(params.shapeId, shape);
    // A body built in passes went through two shapes, so where each face came
    // from is read through both maps: the second names a face of the shape the
    // first pass left behind, and the first names the face it came from.
    const facesFromBase = (() => {
      if (!maker) return this.facesFromBase(shape, source);
      if (!splitFirst) return this.mappedFaces(maker, shape, source);
      const passed = this.mappedFaces(splitFirst.maker, splitFirst.shape, source);
      return this.mappedFaces(maker, shape, splitFirst.shape).map((from) =>
        from >= 0 ? (passed[from] ?? -1) : -1,
      );
    })();
    return {
      shapeId: params.shapeId,
      stats: this.countTopology(shape),
      applied,
      limit: applied,
      facesFromBase,
      edgeCount: edges.length,
    };
  }

  /**
   * Hollows a body in place (`inward`, a cavity) or grows a new body around it
   * (`outward`, with an optional gap). A thickness the geometry cannot take is
   * reduced instead of failing, and the size actually built is reported.
   */
  shell(params: ShellParams): ShellResult {
    if (!params.shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (!Number.isFinite(params.thickness) || params.thickness <= 0) {
      throw new KernelOpError('INVALID_PARAMS', 'thickness must be positive');
    }
    if (!Number.isFinite(params.offset) || params.offset < 0) {
      throw new KernelOpError('INVALID_PARAMS', 'offset must be a non-negative number');
    }
    const source = this.getShape(params.sourceShapeId);
    const closing = params.removeFaceIds.map((faceId) => {
      if (!Number.isInteger(faceId) || faceId < 0) {
        throw new KernelOpError('INVALID_PARAMS', 'Face ids must be non-negative integers');
      }
      const face = this.findFace(source, faceId);
      if (!face) {
        throw new KernelOpError('INVALID_PARAMS', `Face ${faceId} does not exist on the body`);
      }
      return face;
    });
    const offset = params.direction === 'outward' ? params.offset : 0;
    const requested = Math.max(MIN_SHELL_THICKNESS, params.thickness);
    const key = `${params.sourceShapeId}|${params.direction}|${offset}|${[...params.removeFaceIds]
      .sort((a, b) => a - b)
      .join(',')}`;
    const built = this.findShellBuild(source, closing, params.direction, offset, requested, key);
    if (!built) {
      throw new KernelOpError(
        'SHELL_FAILED',
        params.direction === 'inward'
          ? 'This body cannot be hollowed with these settings'
          : 'This body cannot be wrapped with these settings',
      );
    }
    this.shapes.set(params.shapeId, built.shape);
    return {
      shapeId: params.shapeId,
      stats: this.countTopology(built.shape),
      applied: built.applied,
      // An inward shell keeps the outside faces of the body in place; a face it
      // only moved stays owned by the operation that made it.
      facesFromBase: this.facesFromBase(built.shape, source),
    };
  }

  /**
   * The surface of a body moved along its own normals. A positive distance
   * grows the body — a gap measured to it is the same everywhere, whatever the
   * curvature — and a negative one shrinks it.
   *
   * This is the only operation that offsets a surface rather than moving the
   * body: a translation gives a clearance that disappears where the surface runs
   * along the translation, an offset gives the same distance in every direction.
   */
  offsetShape(params: OffsetShapeParams): MakeBoxResult {
    if (!params.shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    if (!params.sourceShapeId) {
      throw new KernelOpError('INVALID_PARAMS', 'sourceShapeId is required');
    }
    if (!Number.isFinite(params.distance) || params.distance === 0) {
      throw new KernelOpError('INVALID_PARAMS', 'distance must be a non-zero number');
    }
    const oc = this.requireOc();
    const source = this.getShape(params.sourceShapeId);
    const distance = params.distance;
    for (const join of [
      oc.GeomAbs_JoinType.GeomAbs_Intersection,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
    ]) {
      const offset = this.thickSolid(source, [], distance, join);
      const solid = offset ? this.ensureSolid(this.positiveVolume(offset)) : null;
      if (!solid) continue;
      const sourceVolume = this.shapeVolume(source);
      const volume = this.shapeVolume(solid);
      if (!Number.isFinite(volume)) continue;
      // An offset that leaves the body as it was, or swallows it whole, is not
      // the surface the operation asked to end on.
      if (distance > 0 ? !(volume > sourceVolume) : !(volume > 0 && volume < sourceVolume)) {
        continue;
      }
      try {
        if (!new oc.BRepCheck_Analyzer(solid, true).IsValid_2()) continue;
      } catch {
        continue;
      }
      this.shapes.set(params.shapeId, solid);
      return { shapeId: params.shapeId, stats: this.countTopology(solid) };
    }
    throw new KernelOpError('OFFSET_FAILED', 'This body cannot be offset by that distance');
  }

  /**
   * Copies a shape at an affine placement. A copy keeps the source untouched,
   * so an array can repeat one body without rebuilding it from its history.
   */
  transformShape(params: TransformShapeParams): MakeBoxResult {
    if (!params.shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    const shape = this.copyAt(params.sourceShapeId, params.matrix);
    this.shapes.set(params.shapeId, shape);
    return { shapeId: params.shapeId, stats: this.countTopology(shape) };
  }

  /**
   * Middle of one face, measured in the plane of that face.
   *
   * The middle of a face is the middle of what the face covers, not the middle
   * of its material: a plate with a notch has half of its area on one side of
   * the notch, and a centre of mass there would turn a pattern around nothing
   * in particular.
   *
   * The measurement asks the kernel instead of the tessellation the viewport
   * holds, because a tessellated arc falls short of its own extreme by the
   * sagitta of its chords, and 0.05 mm is far too coarse for a centre. The box
   * is taken over the boundary curves, which stay lines and circles even when
   * the surface they were cut from has been re-stored as a B-spline by an
   * offset: the extent of a closed region is the extent of its boundary.
   */
  faceCentre(params: FaceCentreParams): FaceCentreResult {
    const oc = this.requireOc();
    if (!Number.isInteger(params.faceId) || params.faceId < 0) {
      throw new KernelOpError('INVALID_PARAMS', 'Face id must be a non-negative integer');
    }
    const normalLength = Math.hypot(...params.normal);
    if (!Number.isFinite(normalLength) || normalLength <= 1e-9) {
      throw new KernelOpError('INVALID_PARAMS', 'Face normal must be a unit vector');
    }
    const normal = params.normal.map((value) => value / normalLength) as [number, number, number];
    const face = this.findFace(this.getShape(params.shapeId), params.faceId);
    if (!face) {
      throw new KernelOpError('INVALID_PARAMS', `Face ${params.faceId} does not exist on the body`);
    }

    // A point in the plane: the area centre of a flat face lies in it, however
    // the surface is stored. Where it sits along the plane does not matter, and
    // the answer is measured from the boundary anyway.
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
    const centre = props.CentreOfMass();

    // Two axes in the plane, taken from the world so that one face is measured
    // the same way as the next: the frame of a stored plane is not stable.
    const axis = perpendicularTo(normal);
    const yAxis: [number, number, number] = [
      normal[1] * axis[2] - normal[2] * axis[1],
      normal[2] * axis[0] - normal[0] * axis[2],
      normal[0] * axis[1] - normal[1] * axis[0],
    ];
    const frame = new oc.gp_Ax3_3(
      new oc.gp_Pnt_3(centre.X(), centre.Y(), centre.Z()),
      new oc.gp_Dir_4(normal[0], normal[1], normal[2]),
      new oc.gp_Dir_4(axis[0], axis[1], axis[2]),
    );
    const trsf = new oc.gp_Trsf_1();
    // The change of coordinate system reads the shape in the frame, so the
    // arguments are the other way round from what a movement would take.
    trsf.SetTransformation_1(new oc.gp_Ax3_1(), frame);

    const box = new oc.Bnd_Box_1();
    let measured = 0;
    const edges = new oc.TopExp_Explorer_2(
      face,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (edges.More()) {
      const flat = new oc.BRepBuilderAPI_Transform_2(
        oc.TopoDS.Edge_1(edges.Current()),
        trsf,
        true,
      );
      if (flat.IsDone()) {
        oc.BRepBndLib.AddOptimal(flat.Shape(), box, false, false);
        measured += 1;
      }
      edges.Next();
    }
    if (measured === 0 || box.IsVoid()) {
      throw new KernelOpError('OP_FAILED', `Face ${params.faceId} has no boundary to measure`);
    }
    // A face is flat when its own box is thinner than a micron. Asking the
    // surface for its type would refuse the flat faces of an offset body, which
    // carry B-spline surfaces that lie exactly in a plane.
    if (box.GetZmax() - box.GetZmin() > FACE_FLAT_TOLERANCE) {
      throw new KernelOpError('FACE_NOT_PLANAR', `Face ${params.faceId} is not flat`);
    }

    const u = (box.GetXmin() + box.GetXmax()) / 2;
    const v = (box.GetYmin() + box.GetYmax()) / 2;
    return {
      origin: [
        centre.X() + u * axis[0] + v * yAxis[0],
        centre.Y() + u * axis[1] + v * yAxis[1],
        centre.Z() + u * axis[2] + v * yAxis[2],
      ],
    };
  }

  /** A copy of a shape at a row-major 3x4 affine. */
  private copyAt(sourceShapeId: string, matrix: readonly number[]): OcctShape {
    const oc = this.requireOc();
    if (matrix.length !== 12 || matrix.some((value) => !Number.isFinite(value))) {
      throw new KernelOpError('INVALID_PARAMS', 'A transform needs 12 finite matrix values');
    }
    const source = this.getShape(sourceShapeId);
    const [a11, a12, a13, a14, a21, a22, a23, a24, a31, a32, a33, a34] = matrix as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const trsf = new oc.gp_Trsf_1();
    trsf.SetValues(a11, a12, a13, a14, a21, a22, a23, a24, a31, a32, a33, a34);
    const maker = new oc.BRepBuilderAPI_Transform_2(source, trsf, true);
    if (!maker.IsDone()) {
      throw new KernelOpError('OP_FAILED', 'The shape could not be transformed');
    }
    return maker.Shape();
  }

  /** The given shapes as one compound, which a boolean takes as its tool. */
  private compound(shapes: readonly OcctShape[]): OcctShape {
    const oc = this.requireOc();
    const builder = new oc.BRep_Builder();
    const result = new oc.TopoDS_Compound();
    builder.MakeCompound(result);
    for (const shape of shapes) builder.Add(result, shape);
    return result;
  }

  /** Requested thickness first, then the largest one the geometry still takes. */
  private findShellBuild(
    source: OcctShape,
    closing: OcctShape[],
    direction: ShellParams['direction'],
    offset: number,
    requested: number,
    key: string,
  ): { shape: OcctShape; applied: number } | null {
    const direct = this.attemptShell(source, closing, direction, offset, requested);
    if (direct) return { shape: direct, applied: requested };

    // A selection that failed at a known size does not have to be searched
    // again while the user drags the thickness up and down.
    const known = this.shellSplits.get(key);
    if (known && known.good < requested) {
      const cached = this.attemptShell(source, closing, direction, offset, known.good);
      if (cached) return { shape: cached, applied: known.good };
      this.shellSplits.delete(key);
    }

    let low = 0;
    let high = requested;
    let shape: OcctShape | null = null;
    let applied = 0;
    for (let step = 0; step < SHELL_SEARCH_STEPS; step += 1) {
      const mid = (low + high) / 2;
      if (mid < MIN_SHELL_THICKNESS) break;
      const attempt = this.attemptShell(source, closing, direction, offset, mid);
      if (attempt) {
        low = mid;
        applied = mid;
        shape = attempt;
      } else {
        high = mid;
      }
    }
    if (!shape) return null;
    if (this.shellSplits.size > 64) this.shellSplits.clear();
    this.shellSplits.set(key, { good: applied, bad: Math.max(high, applied) });
    return { shape, applied };
  }

  private attemptShell(
    source: OcctShape,
    closing: OcctShape[],
    direction: ShellParams['direction'],
    offset: number,
    thickness: number,
  ): OcctShape | null {
    const oc = this.requireOc();
    const distance = direction === 'inward' ? -thickness : offset + thickness;
    let offsetShape: OcctShape | null = null;
    for (const join of [
      oc.GeomAbs_JoinType.GeomAbs_Intersection,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
    ]) {
      offsetShape = this.thickSolid(source, closing, distance, join);
      if (offsetShape) break;
    }
    offsetShape = offsetShape ? this.ensureSolid(this.positiveVolume(offsetShape)) : null;
    if (!offsetShape) return null;

    let result: OcctShape;
    try {
      if (direction === 'inward') {
        result = closing.length > 0 ? offsetShape : this.boolean(source, offsetShape, 'cut');
      } else if (offset > 0) {
        const inner = this.shellInnerSolid(source, offset);
        if (!inner) return null;
        result = this.boolean(offsetShape, inner, 'cut');
      } else {
        result = closing.length > 0 ? offsetShape : this.boolean(offsetShape, source, 'cut');
      }
    } catch {
      return null;
    }

    const sourceVolume = this.shapeVolume(source);
    const volume = this.shapeVolume(result);
    if (!Number.isFinite(volume)) return null;
    // An oversized offset can silently leave the body untouched; a wall has to
    // change what is there, and an outward wall has to be material of its own.
    const epsilon = Math.max(1e-9, Math.abs(sourceVolume) * 1e-9);
    if (direction === 'inward' ? !(volume < sourceVolume - epsilon) : !(volume > epsilon)) {
      return null;
    }
    try {
      if (!new oc.BRepCheck_Analyzer(result, true).IsValid_2()) return null;
    } catch {
      return null;
    }
    return result;
  }

  /** Offset solid used as the inner surface of an outward shell with a gap. */
  private shellInnerSolid(source: OcctShape, offset: number): OcctShape | null {
    const oc = this.requireOc();
    for (const join of [
      oc.GeomAbs_JoinType.GeomAbs_Intersection,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
    ]) {
      const shape = this.thickSolid(source, [], offset, join);
      const solid = shape ? this.ensureSolid(this.positiveVolume(shape)) : null;
      if (solid) return solid;
    }
    return null;
  }

  private thickSolid(
    source: OcctShape,
    closing: OcctShape[],
    distance: number,
    join: unknown,
  ): OcctShape | null {
    const oc = this.requireOc();
    try {
      const maker = new oc.BRepOffsetAPI_MakeThickSolid_1();
      const faces = new oc.TopTools_ListOfShape_1();
      for (const face of closing) faces.Append_1(face);
      maker.MakeThickSolidByJoin(
        source,
        faces,
        distance,
        SHELL_TOLERANCE,
        oc.BRepOffset_Mode.BRepOffset_Skin,
        false,
        false,
        join,
        false,
      );
      maker.Build();
      if (!maker.IsDone()) return null;
      const shape = maker.Shape();
      return shape.IsNull() ? null : shape;
    } catch {
      // A rejected offset throws through the binding; the next size is tried.
      return null;
    }
  }

  /** Flips a backwards offset solid so its material has a positive volume. */
  private positiveVolume(shape: OcctShape): OcctShape | null {
    if (shape.IsNull() || this.countTopology(shape).faces === 0) return null;
    const volume = this.shapeVolume(shape);
    if (!Number.isFinite(volume)) return null;
    return volume < 0 ? shape.Reversed() : shape;
  }

  /** A shell the offset maker leaves as a lone closed shell becomes a solid. */
  private ensureSolid(shape: OcctShape | null): OcctShape | null {
    if (!shape) return null;
    const oc = this.requireOc();
    const stats = this.countTopology(shape);
    if (stats.solids > 0) return shape;
    if (stats.faces === 0) return null;
    const shells = this.subShapesOf(shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL);
    if (shells.length !== 1) return null;
    try {
      const maker = new oc.BRepBuilderAPI_MakeSolid_3(oc.TopoDS.Shell_1(shells[0]!));
      return maker.IsDone() ? maker.Solid() : null;
    } catch {
      return null;
    }
  }

  private subShapesOf(shape: OcctShape, kind: number): OcctShape[] {
    const oc = this.requireOc();
    const found: OcctShape[] = [];
    const explorer = new oc.TopExp_Explorer_2(shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (explorer.More()) {
      found.push(explorer.Current());
      explorer.Next();
    }
    return found;
  }

  private shapeVolume(shape: OcctShape): number {
    const oc = this.requireOc();
    try {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
      return props.Mass();
    } catch {
      return NaN;
    }
  }

  /**
   * Where every result face came from. A face the treatment only trimmed keeps
   * the operation that made it; only the surfaces the treatment creates are new.
   */
  private mappedFaces(maker: OcctFaceMapper, shape: OcctShape, source: OcctShape): number[] {
    const oc = this.requireOc();
    const resultFaces: OcctShape[] = [];
    const resultExplorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (resultExplorer.More()) {
      resultFaces.push(resultExplorer.Current());
      resultExplorer.Next();
    }
    const indexOf = (face: OcctShape) =>
      resultFaces.findIndex((candidate) => candidate.IsSame(face));

    const mapping = resultFaces.map(() => -1);
    const sourceExplorer = new oc.TopExp_Explorer_2(
      source,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let sourceIndex = 0;
    while (sourceExplorer.More()) {
      const face = sourceExplorer.Current();
      sourceExplorer.Next();
      let mapped = false;
      try {
        const modified = maker.Modified(face);
        let size = modified.Size();
        if (size > 0) {
          // Two fillets can trim one face from both sides, which leaves more
          // pieces than the ends of the list show. The binding has no iterator,
          // so the list is drained: it is a copy, and the maker is done with it.
          while (size > 0) {
            const index = indexOf(modified.First_1());
            modified.RemoveFirst();
            if (index >= 0) mapping[index] = sourceIndex;
            size -= 1;
          }
          mapped = true;
        }
      } catch {
        // A maker that cannot report the mapping falls back to identity below.
      }
      if (!mapped) {
        const index = indexOf(face);
        if (index >= 0) mapping[index] = sourceIndex;
      }
      sourceIndex += 1;
    }
    return mapping;
  }

  /** Explicit edges plus the boundary edges of the given faces. */
  private treatmentEdges(params: EdgeTreatmentParams): {
    edges: OcctShape[];
    chosen: BodyEdge[];
  } {
    const cache = this.shapeEdges.get(params.sourceShapeId);
    if (!cache) throw new KernelOpError('SHAPE_NOT_FOUND', 'Tessellate the body first');
    const picked = new Set(params.edgeIds);
    const faces = new Set(params.faceIds);
    const chosen = new Set<string>();
    for (const edge of cache.edges) {
      if (picked.has(edge.id)) chosen.add(edge.id);
    }
    if (faces.size > 0) {
      for (const edge of cache.edges) {
        const inside = edge.faceIds.filter((face) => faces.has(face)).length;
        // An edge between two selected faces is inside the selection, not on
        // its boundary, so picking a face treats the rim it shares with others.
        if (inside > 0 && inside < edge.faceIds.length) chosen.add(edge.id);
      }
    }
    const shapes: OcctShape[] = [];
    const records: BodyEdge[] = [];
    for (const edge of cache.edges) {
      if (!chosen.has(edge.id)) continue;
      const shape = cache.shapes.get(edge.id);
      if (!shape) continue;
      shapes.push(shape);
      records.push(edge);
    }
    return { edges: shapes, chosen: records };
  }

  /**
   * A set of edges can be rejected as a whole even though its parts build on
   * their own — a convex round and a concave round that meet at a vertex are
   * the usual case. Build one edge first, then the rest where they ended up
   * after that pass, and keep the largest size both passes accept.
   */
  private buildTreatmentInPasses(
    kind: EdgeTreatmentParams['kind'],
    source: OcctShape,
    edges: readonly OcctShape[],
    chosen: readonly BodyEdge[],
    size: number,
    splitKey: string,
  ): {
    shape: OcctShape;
    maker: OcctEdgeMaker;
    applied: number;
    failedAt: number;
    index: number;
    first: { shape: OcctShape; maker: OcctEdgeMaker } | null;
  } | null {
    if (chosen.length < 2 || edges.length !== chosen.length) return null;
    const attempt = (index: number, at: number) => {
      const built = this.buildTreatment(kind, source, [edges[index]!], at);
      if (!built) return null;
      const pending = chosen.filter((_, other) => other !== index);
      const rest = this.edgesNear(built.shape, pending);
      // An edge that cannot be found again was trimmed away by the first pass,
      // and skipping it would treat less than the operation says it does.
      if (rest.length < pending.length) return null;
      const second = this.buildTreatment(kind, built.shape, rest, at);
      return second ? { ...second, first: built } : null;
    };
    // The edge that leads the first pass decides whether the split works at
    // all, so start from the one that worked last time.
    const order = chosen.map((_, index) => index);
    const previous = this.treatmentSplits.get(splitKey)?.index ?? -1;
    if (previous >= 0 && previous < order.length) {
      order.splice(order.indexOf(previous), 1);
      order.unshift(previous);
    }
    const attemptAny = (at: number) => {
      for (const index of order) {
        const built = attempt(index, at);
        if (built) return { ...built, index };
      }
      return null;
    };

    // A drag past the limit asks for the same impossible size over and over,
    // so a selection already known to be too large is rebuilt at its limit.
    const known = this.treatmentSplits.get(splitKey);
    if (known && size >= known.bad) {
      const full = attemptAny(known.good);
      if (full) return { ...full, applied: known.good, failedAt: known.bad, first: full.first };
    }

    const direct = attemptAny(size);
    if (direct) {
      return { ...direct, applied: size, failedAt: known?.bad ?? Infinity, first: direct.first };
    }

    let best: {
      shape: OcctShape;
      maker: OcctEdgeMaker;
      applied: number;
      failedAt: number;
      index: number;
      first: { shape: OcctShape; maker: OcctEdgeMaker } | null;
    } | null = null;
    let low = known?.good ?? 0;
    let high = Math.min(size, known?.bad ?? size);
    for (let step = 0; step < TREATMENT_SEARCH_STEPS; step += 1) {
      const mid = (low + high) / 2;
      if (mid < MIN_TREATMENT_SIZE) break;
      const built = attemptAny(mid);
      if (built) {
        low = mid;
        best = { ...built, applied: mid, failedAt: high };
      } else {
        high = mid;
      }
    }
    return best;
  }

  /** The edges of a rebuilt shape that still follow the given polyline. */
  private edgesNear(shape: OcctShape, spans: readonly BodyEdge[]): OcctShape[] {
    const temporaryId = `__treatment-pass-${(this.treatmentPass += 1)}`;
    this.shapes.set(temporaryId, shape);
    try {
      this.tessellate(temporaryId);
      const cache = this.shapeEdges.get(temporaryId);
      if (!cache) return [];
      const found: OcctShape[] = [];
      for (const span of spans) {
        let best: { id: string; distance: number } | null = null;
        for (const edge of cache.edges) {
          const distance = polylineDistance(edge.points, span.points);
          if (distance > TREATMENT_EDGE_TOLERANCE) continue;
          if (!best || distance < best.distance) best = { id: edge.id, distance };
        }
        const match = best ? cache.shapes.get(best.id) : undefined;
        if (match) found.push(match);
      }
      return found;
    } finally {
      this.shapeEdges.delete(temporaryId);
      this.shapes.delete(temporaryId);
    }
  }

  private buildTreatment(
    kind: EdgeTreatmentParams['kind'],
    source: OcctShape,
    edges: readonly OcctShape[],
    size: number,
  ): { shape: OcctShape; maker: OcctEdgeMaker } | null {
    const oc = this.requireOc();
    try {
      const maker =
        kind === 'fillet'
          ? new oc.BRepFilletAPI_MakeFillet(source, oc.ChFi3d_FilletShape.ChFi3d_Rational)
          : new oc.BRepFilletAPI_MakeChamfer(source);
      for (const edge of edges) maker.Add_2(size, edge);
      maker.Build();
      if (!maker.IsDone()) return null;
      const shape = maker.Shape();
      if (!shape || shape.IsNull()) return null;
      // A build can report success and still leave a self-intersecting body, so
      // the result decides whether the size was usable.
      const analyzer = new oc.BRepCheck_Analyzer(shape, true);
      if (!analyzer.IsValid_2()) return null;
      return { shape, maker };
    } catch {
      // The published OCCT build throws C++ failures as broken JS objects. A
      // rejected size is a normal outcome here, not an exception.
      return null;
    }
  }

  /**
   * Writes body shapes to one AP214 STEP file. Each body becomes a top-level
   * shape of an XCAF document with its name and colour, which is what makes
   * the file useful in another CAD system instead of a pile of anonymous
   * solids.
   */
  exportStep(params: ExportStepParams): ExportStepResult {
    if (params.bodies.length === 0) {
      throw new KernelOpError('INVALID_PARAMS', 'No bodies to export');
    }
    const oc = this.requireOc();
    const document = new oc.TDocStd_Document(
      new oc.TCollection_ExtendedString_2('MDTV-XCAF', true),
    );
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(document.Main()).get();
    const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(document.Main()).get();
    for (const body of params.bodies) {
      const label = shapeTool.AddShape(this.getShape(body.shapeId), false, true);
      // Names keep their UTF-8 bytes with the multibyte flag off; that is what
      // the STEP writer encodes, so a Cyrillic name survives the round trip.
      oc.TDataStd_Name.Set_1(
        label,
        new oc.TCollection_ExtendedString_2(body.name, false),
      );
      const [red, green, blue] = stepColor(body.color);
      colorTool.SetColor_2(
        label,
        new oc.Quantity_Color_3(red, green, blue, 1),
        oc.XCAFDoc_ColorType.XCAFDoc_ColorGen,
      );
    }

    // The writer goes through the Emscripten filesystem: a unique name per call
    // keeps exports from meeting each other, and the file is removed once its
    // bytes are in JavaScript.
    const fileName = `icancad-export-${(this.exportPass += 1)}.step`;
    const writer = new oc.STEPCAFControl_Writer_1();
    writer.SetColorMode(true);
    writer.SetNameMode(true);
    try {
      const written = writer.Perform_1(
        new oc.Handle_TDocStd_Document_2(document),
        new oc.TCollection_AsciiString_2(fileName),
      );
      if (!written) {
        throw new KernelOpError('OP_FAILED', 'STEP writer failed');
      }
      return { data: oc.FS.readFile(fileName).slice() };
    } finally {
      try {
        oc.FS.unlink(fileName);
      } catch {
        // The writer may have failed before it opened the file.
      }
    }
  }

  dispose(shapeId: string): boolean {
    this.shapeEdges.delete(shapeId);
    return this.shapes.delete(shapeId);
  }

  clear(): void {
    this.shapes.clear();
    this.shapeEdges.clear();
  }

  private extrudeLoop(loop: ProfileLoop, params: MakePrismParams): OcctShape {
    const oc = this.requireOc();
    const plane = profilePlane(params);
    const [nx, ny, nz] = plane.normal;
    const wire = this.buildWire(loop, plane);
    const maker = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
    if (!maker.IsDone()) {
      throw new KernelOpError('INVALID_PARAMS', 'Sketch region contour is not closed');
    }
    const face = maker.Face();
    let solid: OcctShape | null = null;
    for (const [index, distance] of params.distances.entries()) {
      // A union reaches a hair behind its plane so it shares material with the
      // body it joins: a tool that only touches a face stays a solid of its
      // own, and the boolean silently adds nothing. The overlap belongs to the
      // same sweep — two prisms stacked on one plane leave a seam that stops
      // the union from joining anything.
      const overlap = index === 0 && distance > 0 ? Math.max(0, params.embed ?? 0) : 0;
      const length = distance + overlap;
      const vector = new oc.gp_Vec_4(nx * length, ny * length, nz * length);
      const prism = new oc.BRepPrimAPI_MakePrism_1(face, vector, false, true);
      if (!prism.IsDone()) {
        throw new KernelOpError('OP_FAILED', 'Extrude failed for a sketch region');
      }
      let part = prism.Shape();
      if (overlap > 0) {
        // The sweep grew along the normal, so it moves back into the material
        // by the overlap it was given.
        const back = new oc.gp_Trsf_1();
        back.SetTranslation_1(new oc.gp_Vec_4(-nx * overlap, -ny * overlap, -nz * overlap));
        part = new oc.BRepBuilderAPI_Transform_2(part, back, true).Shape();
      }
      solid = solid ? this.boolean(solid, part, 'fuse') : part;
    }
    if (!solid) throw new KernelOpError('OP_FAILED', 'Extrude produced no geometry');
    return solid;
  }

  private revolveLoop(
    loop: ProfileLoop,
    params: MakeRevolveParams,
    sweep: RevolveSweep,
  ): OcctShape {
    const oc = this.requireOc();
    const plane = profilePlane(params);
    const wire = this.buildWire(loop, plane);
    const maker = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
    if (!maker.IsDone()) {
      throw new KernelOpError('INVALID_PARAMS', 'Sketch region contour is not closed');
    }
    return this.revolveFace(maker.Face(), params.axis, sweep);
  }

  /** Places the face at the start of the sweep, then turns it to the end. */
  private revolveFace(face: OcctShape, axis: RevolveAxisLine, sweep: RevolveSweep): OcctShape {
    const oc = this.requireOc();
    const ax1 = revolveAxisLine(oc, axis);
    let placed = face;
    if (Math.abs(sweep.start) > 1e-12) {
      const rotation = new oc.gp_Trsf_1();
      rotation.SetRotation_1(ax1, sweep.start);
      const transform = new oc.BRepBuilderAPI_Transform_2(face, rotation, true);
      if (!transform.IsDone()) {
        throw new KernelOpError('OP_FAILED', 'Revolve could not place the profile');
      }
      placed = transform.Shape();
    }
    const maker = new oc.BRepPrimAPI_MakeRevol_1(placed, ax1, sweep.angle, true);
    if (!maker.IsDone()) {
      throw new KernelOpError('OP_FAILED', 'Revolve failed for the profile');
    }
    return maker.Shape();
  }

  private buildWire(loop: ProfileLoop, plane: ProfilePlane): OcctShape {
    const oc = this.requireOc();
    if (loop.curves.length === 0) {
      throw new KernelOpError('INVALID_PARAMS', 'Sketch region contour is empty');
    }
    this.assertClosedLoop(loop);
    const edges = loop.curves.map((curve) => this.buildEdge(curve, plane));
    const maker = new oc.BRepBuilderAPI_MakeWire_2(edges[0]!);
    for (const edge of edges.slice(1)) {
      maker.Add_1(edge);
    }
    if (!maker.IsDone()) {
      throw new KernelOpError('INVALID_PARAMS', 'Sketch region contour has open ends');
    }
    return maker.Wire();
  }

  private assertClosedLoop(loop: ProfileLoop): void {
    const first = loop.curves[0]!;
    if (loop.curves.length === 1 && first.type === 'circle') return;
    if (loop.curves.some((curve) => curve.type === 'circle')) {
      throw new KernelOpError('INVALID_PARAMS', 'A full circle must be the whole contour');
    }
    const tolerance = 1e-6;
    let previousEnd = curveEnd(first);
    for (const curve of loop.curves.slice(1)) {
      const start = curveStart(curve);
      if (Math.hypot(start[0] - previousEnd[0], start[1] - previousEnd[1]) > tolerance) {
        throw new KernelOpError('INVALID_PARAMS', 'Sketch region contour has open ends');
      }
      previousEnd = curveEnd(curve);
    }
    const firstStart = curveStart(first);
    if (Math.hypot(firstStart[0] - previousEnd[0], firstStart[1] - previousEnd[1]) > tolerance) {
      throw new KernelOpError('INVALID_PARAMS', 'Sketch region contour is not closed');
    }
  }

  private buildEdge(curve: ProfileCurve, plane: ProfilePlane): OcctShape {
    const oc = this.requireOc();
    if (curve.type === 'line') {
      const from = planePoint(oc, plane, curve.x1, curve.y1);
      const to = planePoint(oc, plane, curve.x2, curve.y2);
      return new oc.BRepBuilderAPI_MakeEdge_3(from, to).Edge();
    }
    // Orienting the circle with the plane axes keeps sketch angles unchanged.
    const centre = planePoint(oc, plane, curve.cx, curve.cy);
    const axis = new oc.gp_Ax2_2(
      centre,
      new oc.gp_Dir_4(plane.normal[0], plane.normal[1], plane.normal[2]),
      new oc.gp_Dir_4(plane.xAxis[0], plane.xAxis[1], plane.xAxis[2]),
    );
    const circle = new oc.gp_Circ_2(axis, curve.r);
    const edge =
      curve.type === 'circle'
        ? new oc.BRepBuilderAPI_MakeEdge_8(circle).Edge()
        : new oc.BRepBuilderAPI_MakeEdge_9(circle, curve.startAngle, curve.endAngle).Edge();
    if (!curve.reversed) return edge;
    // Reversed() returns a generic shape, but the wire builder needs an edge.
    return oc.TopoDS.Edge_1(edge.Reversed());
  }

  // Coplanar faces produced by a fuse are one geometric face to the user, so
  // they must be one topological face for picking and for downstream features.
  private unify(shape: OcctShape): OcctShape {
    const oc = this.requireOc();
    // A shape with a face that only grazes another can make the merge give up,
    // and an unmerged body is still the right body — just with an extra seam.
    const modes: Array<[boolean, boolean, boolean]> = [
      [true, true, false],
      [true, true, true],
      [true, false, false],
      [false, true, false],
    ];
    for (const [unifyEdges, unifyFaces, concat] of modes) {
      try {
        const unify = new oc.ShapeUpgrade_UnifySameDomain_2(shape, unifyEdges, unifyFaces, concat);
        unify.Build();
        const result = unify.Shape();
        if (result.IsNull()) continue;
        if (unifyFaces && !this.mergedFacesValid(shape, result)) continue;
        return result;
      } catch {
        // Try the next mode, then keep the shape as it is.
      }
    }
    return shape;
  }

  /**
   * Whether every face the merge created is a valid face.
   *
   * Merging faces that lie on one surface is not always sound. Two regions of
   * the same torus that meet only along the cut of a boolean — the inner and the
   * outer side of the tube — become one face that no longer closes the solid,
   * and the body then has holes in it. The merge is a cosmetic step, so a merge
   * that produces a face the checker refuses is thrown away and the next, more
   * careful mode is tried.
   */
  private mergedFacesValid(before: OcctShape, after: OcctShape): boolean {
    const oc = this.requireOc();
    const kept: OcctShape[] = [];
    const beforeExplorer = new oc.TopExp_Explorer_2(
      before,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (beforeExplorer.More()) {
      kept.push(beforeExplorer.Current());
      beforeExplorer.Next();
    }
    const afterExplorer = new oc.TopExp_Explorer_2(
      after,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (afterExplorer.More()) {
      const face = afterExplorer.Current();
      afterExplorer.Next();
      // A face the merge did not touch is the very same face it was before.
      if (kept.some((candidate) => candidate.IsSame(face))) continue;
      if (!new oc.BRepCheck_Analyzer(face, true).IsValid_2()) return false;
    }
    return true;
  }

  private boolean(base: OcctShape, tool: OcctShape, op: BooleanParams['op']): OcctShape {
    return this.booleanMaker(base, tool, op).Shape();
  }

  private booleanMaker(base: OcctShape, tool: OcctShape, op: BooleanParams['op']): OcctBooleanMaker {
    const oc = this.requireOc();
    const maker =
      op === 'fuse'
        ? new oc.BRepAlgoAPI_Fuse_3(base, tool)
        : op === 'cut'
          ? new oc.BRepAlgoAPI_Cut_3(base, tool)
          : new oc.BRepAlgoAPI_Common_3(base, tool);
    maker.Build();
    if (maker.Shape().IsNull()) {
      throw new KernelOpError('OP_FAILED', `Boolean ${op} produced an empty shape`);
    }
    return maker;
  }

  /**
   * For every face of `result`, in shape order, the index of the face of `base`
   * it is: a boolean keeps the faces it does not touch, so identity survives.
   * Modified and new faces report -1.
   */
  private facesFromBase(result: OcctShape, base: OcctShape): number[] {
    const oc = this.requireOc();
    const baseFaces: OcctShape[] = [];
    const baseExplorer = new oc.TopExp_Explorer_2(
      base,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (baseExplorer.More()) {
      baseFaces.push(baseExplorer.Current());
      baseExplorer.Next();
    }

    const map: number[] = [];
    const explorer = new oc.TopExp_Explorer_2(
      result,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (explorer.More()) {
      const face = explorer.Current();
      let index = -1;
      for (let candidate = 0; candidate < baseFaces.length; candidate += 1) {
        if (baseFaces[candidate]!.IsSame(face)) {
          index = candidate;
          break;
        }
      }
      map.push(index);
      explorer.Next();
    }
    return map;
  }

  private countTopology(shape: OcctShape): ShapeStats {
    const oc = this.requireOc();
    return {
      faces: this.countSubShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE),
      edges: this.countSubShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE),
      solids: this.countSubShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID),
    };
  }

  private countSubShapes(shape: OcctShape, kind: number): number {
    const oc = this.requireOc();
    const explorer = new oc.TopExp_Explorer_2(shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const unique: OcctShape[] = [];
    while (explorer.More()) {
      const current = explorer.Current();
      if (!unique.some((candidate) => candidate.IsSame(current))) {
        unique.push(current);
      }
      explorer.Next();
    }
    return unique.length;
  }

  // Tessellation numbers faces in explorer order, so the same walk finds the
  // face the viewport reported in `TessellationResult.faceIds`.
  private findFace(shape: OcctShape, faceId: number): OcctShape | null {
    const oc = this.requireOc();
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let index = 0;
    while (explorer.More()) {
      if (index === faceId) return oc.TopoDS.Face_1(explorer.Current());
      index += 1;
      explorer.Next();
    }
    return null;
  }

  private getShape(shapeId: string): OcctShape {
    const shape = this.shapes.get(shapeId);
    if (!shape) {
      throw new KernelOpError('SHAPE_NOT_FOUND', `Unknown shape: ${shapeId}`);
    }
    return shape;
  }

  private requireOc(): OcctBindings {
    if (!this.oc) {
      throw new KernelOpError('OP_FAILED', 'OCCT kernel is not initialized');
    }
    return this.oc;
  }
}

function updateBounds(
  min: [number, number, number],
  max: [number, number, number],
  x: number,
  y: number,
  z: number,
): void {
  if (x < min[0]) min[0] = x;
  if (y < min[1]) min[1] = y;
  if (z < min[2]) min[2] = z;
  if (x > max[0]) max[0] = x;
  if (y > max[1]) max[1] = y;
  if (z > max[2]) max[2] = z;
}

/** `#rrggbb` from the model as the 0..1 channels a `Quantity_Color` takes. */
function stepColor(value: string): [number, number, number] {
  const hex = value.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [0.7, 0.7, 0.7];
  const number = Number.parseInt(full, 16);
  return [
    ((number >> 16) & 0xff) / 255,
    ((number >> 8) & 0xff) / 255,
    (number & 0xff) / 255,
  ];
}

interface ProfilePlane {
  origin: [number, number, number];
  xAxis: [number, number, number];
  yAxis: [number, number, number];
  normal: [number, number, number];
}

function unitVector(vector: readonly number[]): [number, number, number] {
  const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0) || 1;
  return [(vector[0] ?? 0) / length, (vector[1] ?? 0) / length, (vector[2] ?? 0) / length];
}

// The sketch plane as an orthonormal frame; profile curves live in its 2D space.
function profilePlane(params: {
  origin: readonly number[];
  xAxis: readonly number[];
  yAxis: readonly number[];
}): ProfilePlane {
  const xAxis = unitVector(params.xAxis);
  const yAxis = unitVector(params.yAxis);
  const normal = unitVector([
    xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1],
    xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2],
    xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0],
  ]);
  return { origin: [...params.origin] as [number, number, number], xAxis, yAxis, normal };
}

interface RevolveSweep {
  /** Where the profile starts, in radians around the axis. */
  start: number;
  /** Positive angle the profile turns through, at most a full turn. */
  angle: number;
}

const FULL_TURN = Math.PI * 2;

function revolveAxisLine(oc: OcctBindings, axis: RevolveAxisLine): unknown {
  const direction = unitVector(axis.direction);
  if (Math.hypot(axis.direction[0]!, axis.direction[1]!, axis.direction[2]!) < 1e-9) {
    throw new KernelOpError('INVALID_PARAMS', 'Revolve axis needs a direction');
  }
  return new oc.gp_Ax1_2(
    new oc.gp_Pnt_3(axis.origin[0], axis.origin[1], axis.origin[2]),
    new oc.gp_Dir_4(direction[0], direction[1], direction[2]),
  );
}

/**
 * Angles may come in either order and may pass a full turn; the sweep always
 * runs the short way from the lower angle, so no negative angle reaches OCCT.
 */
function revolveSweep(startAngle: number, endAngle: number): RevolveSweep {
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
    throw new KernelOpError('INVALID_PARAMS', 'Revolve angles must be numbers');
  }
  const start = Math.min(startAngle, endAngle);
  const angle = Math.min(Math.abs(endAngle - startAngle), FULL_TURN);
  if (angle <= 1e-9) {
    throw new KernelOpError('INVALID_PARAMS', 'Revolve needs a non-zero angle');
  }
  return { start, angle };
}

function planePoint(oc: OcctBindings, plane: ProfilePlane, x: number, y: number) {
  const [ox, oy, oz] = plane.origin;
  const [xx, xy, xz] = plane.xAxis;
  const [yx, yy, yz] = plane.yAxis;
  return new oc.gp_Pnt_3(ox + xx * x + yx * y, oy + xy * x + yy * y, oz + xz * x + yz * y);
}

function curveStart(curve: ProfileCurve): [number, number] {
  if (curve.type === 'line') return [curve.x1, curve.y1];
  if (curve.type === 'circle') return [curve.cx + curve.r, curve.cy];
  const angle = curve.reversed ? curve.endAngle : curve.startAngle;
  return [curve.cx + Math.cos(angle) * curve.r, curve.cy + Math.sin(angle) * curve.r];
}

function curveEnd(curve: ProfileCurve): [number, number] {
  if (curve.type === 'line') return [curve.x2, curve.y2];
  if (curve.type === 'circle') return [curve.cx + curve.r, curve.cy];
  const angle = curve.reversed ? curve.startAngle : curve.endAngle;
  return [curve.cx + Math.cos(angle) * curve.r, curve.cy + Math.sin(angle) * curve.r];
}
