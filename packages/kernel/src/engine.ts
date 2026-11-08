import type {
  BoxParams,
  HealthResult,
  KernelErrorCode,
  KernelStatusEvent,
  MakeBoxResult,
  ShapeStats,
  TessellationQuality,
  TessellationResult,
} from './protocol';
import { DEFAULT_TESSELLATION_QUALITY } from './protocol';
import type { OcctBindings, OcctShape } from './occt-types';

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

interface TessellationBuffers {
  positions: number[];
  normals: number[];
  indices: number[];
  faceIds: number[];
}

export class KernelEngine {
  private oc: OcctBindings | null = null;
  private loading: Promise<OcctBindings> | null = null;
  private loadMs = 0;
  private readonly shapes = new Map<string, OcctShape>();

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
    const shape = new oc.BRepPrimAPI_MakeBox_1(dx, dy, dz).Shape();
    this.shapes.set(shapeId, shape);
    return { shapeId, stats: this.countTopology(shape) };
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
      }

      faceIndex += 1;
      explorer.Next();
    }

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
    };
  }

  dispose(shapeId: string): boolean {
    return this.shapes.delete(shapeId);
  }

  clear(): void {
    this.shapes.clear();
  }

  private countTopology(shape: OcctShape): ShapeStats {
    const oc = this.requireOc();
    return {
      faces: this.countSubShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE),
      edges: this.countSubShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE),
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

