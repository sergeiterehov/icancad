import type {
  BodyEdge,
  BooleanParams,
  BoxParams,
  EdgeTreatmentParams,
  EdgeTreatmentResult,
  HealthResult,
  KernelErrorCode,
  KernelStatusEvent,
  MakeBoxResult,
  MakeFacePrismParams,
  MakePrismParams,
  ProfileCurve,
  ProfileLoop,
  ShapeStats,
  SplitSolid,
  SplitSolidsParams,
  SplitSolidsResult,
  TessellationQuality,
  TessellationResult,
} from './protocol';
import { DEFAULT_TESSELLATION_QUALITY } from './protocol';
import type {
  OcctBindings,
  OcctEdgeMaker,
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
  /**
   * Edge selections that only build in passes: the largest size they took and
   * the smallest size they rejected.
   */
  private readonly treatmentSplits = new Map<
    string,
    { good: number; bad: number; index: number }
  >();

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

    const vectors = this.prismVectors(params);
    let shape: OcctShape | null = null;
    for (const region of regions) {
      // Holes are removed with booleans: wire orientation inside a face is easy to
      // get wrong, while cutting the hole prisms is exact and orientation-free.
      let solid: OcctShape | null = this.extrudeLoop(region.outer, vectors, params);
      for (const hole of region.holes) {
        const holeSolid = this.extrudeLoop(hole, vectors, params);
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
    if (new oc.BRepAdaptor_Surface_2(face, true).GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      throw new KernelOpError('FACE_NOT_PLANAR', `Face ${faceId} is not planar`);
    }
    const [nx, ny, nz] = normal.map((value) => value / normalLength) as [
      number,
      number,
      number,
    ];

    // A tool that only stands on the face it was made from touches the body it
    // joins without intersecting it, and the union leaves slivers behind. A
    // sliver of overlap behind the face turns the contact into a real one, so
    // the tool reaches back into material that is already there. A body of its
    // own must not grow, so only a tool does this.
    const first = distances[0]!;
    const steps = embed && first > 0 ? [-FACE_PRISM_EMBED, ...distances] : distances;
    let shape: OcctShape | null = null;
    for (const distance of steps) {
      const vector = new oc.gp_Vec_4(nx * distance, ny * distance, nz * distance);
      const prism = new oc.BRepPrimAPI_MakePrism_1(face, vector, false, true);
      if (!prism.IsDone()) {
        throw new KernelOpError('OP_FAILED', 'Extrude failed for a body face');
      }
      shape = shape ? this.boolean(shape, prism.Shape(), 'fuse') : prism.Shape();
    }
    if (!shape) throw new KernelOpError('OP_FAILED', 'Extrude produced no geometry');

    shape = this.unify(shape);
    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
  }

  booleanShape(params: BooleanParams): MakeBoxResult {
    const { shapeId, baseShapeId, toolShapeId, op } = params;
    if (!shapeId) throw new KernelOpError('INVALID_PARAMS', 'shapeId is required');
    const base = this.getShape(baseShapeId);
    const tool = this.getShape(toolShapeId);
    const fused = this.boolean(base, tool, op);
    const shape = op === 'fuse' ? this.unify(fused) : fused;
    this.shapes.set(shapeId, shape);
    const result: MakeBoxResult = { shapeId, stats: this.countTopology(shape) };
    // A fuse merges coplanar faces, which replaces their identity, so only the
    // boolean itself can be asked where a face came from.
    if (params.trackFaces) result.facesFromBase = this.facesFromBase(shape, base);
    return result;
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

  tessellate(shapeId: string, quality: TessellationQuality = DEFAULT_TESSELLATION_QUALITY): TessellationResult {
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
      const handle = oc.BRep_Tool.Triangulation(face, location);

      if (handle) {
        const triangulation = handle.get();
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
          const raw = oc.BRep_Tool.PolygonOnTriangulation_1(edgeShape, handle, location) as unknown;
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
      shapes: new Map(
        keptEdges.map((edge) => [edge.id, edgeShapes.get(edge.id)!] as const),
      ),
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

    const direct = mixed
      ? null
      : this.buildTreatment(params.kind, source, edges, params.size);
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
      if (!splitFirst) return this.treatedFaces(maker, shape, source);
      const passed = this.treatedFaces(splitFirst.maker, splitFirst.shape, source);
      return this.treatedFaces(maker, shape, splitFirst.shape).map((from) =>
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
   * Where every result face came from. A face the treatment only trimmed keeps
   * the operation that made it; only the surfaces the treatment creates are new.
   */
  private treatedFaces(maker: OcctEdgeMaker, shape: OcctShape, source: OcctShape): number[] {
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
    const indexOf = (face: OcctShape) => resultFaces.findIndex((candidate) => candidate.IsSame(face));

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

  dispose(shapeId: string): boolean {
    this.shapeEdges.delete(shapeId);
    return this.shapes.delete(shapeId);
  }

  clear(): void {
    this.shapes.clear();
    this.shapeEdges.clear();
  }

  private prismVectors(params: MakePrismParams): unknown[] {
    const oc = this.requireOc();
    const [nx, ny, nz] = profilePlane(params).normal;
    return params.distances.map(
      (distance) => new oc.gp_Vec_4(nx * distance, ny * distance, nz * distance),
    );
  }

  private extrudeLoop(
    loop: ProfileLoop,
    vectors: unknown[],
    params: MakePrismParams,
  ): OcctShape {
    const oc = this.requireOc();
    const plane = profilePlane(params);
    const wire = this.buildWire(loop, plane);
    const maker = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
    if (!maker.IsDone()) {
      throw new KernelOpError('INVALID_PARAMS', 'Sketch region contour is not closed');
    }
    const face = maker.Face();
    let solid: OcctShape | null = null;
    for (const vector of vectors) {
      const prism = new oc.BRepPrimAPI_MakePrism_1(face, vector, false, true);
      if (!prism.IsDone()) {
        throw new KernelOpError('OP_FAILED', 'Extrude failed for a sketch region');
      }
      solid = solid ? this.boolean(solid, prism.Shape(), 'fuse') : prism.Shape();
    }
    if (!solid) throw new KernelOpError('OP_FAILED', 'Extrude produced no geometry');
    return solid;
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
        if (!result.IsNull()) return result;
      } catch {
        // Try the next mode, then keep the shape as it is.
      }
    }
    return shape;
  }

  private boolean(base: OcctShape, tool: OcctShape, op: BooleanParams['op']): OcctShape {
    const oc = this.requireOc();
    const make = () =>
      op === 'fuse'
        ? new oc.BRepAlgoAPI_Fuse_3(base, tool)
        : op === 'cut'
          ? new oc.BRepAlgoAPI_Cut_3(base, tool)
          : new oc.BRepAlgoAPI_Common_3(base, tool);
    const maker = make();
    maker.Build();
    const shape = maker.Shape();
    if (shape.IsNull()) {
      throw new KernelOpError('OP_FAILED', `Boolean ${op} produced an empty shape`);
    }
    return shape;
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
function profilePlane(params: MakePrismParams): ProfilePlane {
  const xAxis = unitVector(params.xAxis);
  const yAxis = unitVector(params.yAxis);
  const normal = unitVector([
    xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1],
    xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2],
    xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0],
  ]);
  return { origin: [...params.origin] as [number, number, number], xAxis, yAxis, normal };
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
