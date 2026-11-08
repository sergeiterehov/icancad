export interface OcctArray<T> {
  Length(): number;
  Value(index: number): T;
}

export interface OcctPoint {
  X(): number;
  Y(): number;
  Z(): number;
  Transformed(transformation: OcctTransformation): OcctPoint;
}

export interface OcctTransformation {
  Value(row: number, column: number): number;
}

export interface OcctTriangle {
  Value(index: number): number;
}

export interface OcctTriangulation {
  NbNodes(): number;
  NbTriangles(): number;
  Nodes(): OcctArray<OcctPoint>;
  Triangles(): OcctArray<OcctTriangle>;
}

export interface OcctTriangulationHandle {
  get(): OcctTriangulation;
}

export interface OcctLocation {
  Transformation(): OcctTransformation;
}

export interface OcctExplorer {
  More(): boolean;
  Next(): void;
  Current(): OcctShape;
}

export interface OcctShape {
  readonly __occtShape?: unique symbol;
  IsSame(other: OcctShape): boolean;
  Orientation_1(): unknown;
}

export interface OcctShapeMaker {
  Shape(): OcctShape;
}

export interface OcctBindings {
  BRepPrimAPI_MakeBox_1: new (dx: number, dy: number, dz: number) => OcctShapeMaker;
  BRepMesh_IncrementalMesh_2: new (
    shape: OcctShape,
    linearDeflection: number,
    isRelative: boolean,
    angularDeflection: number,
    isInParallel: boolean,
  ) => unknown;
  TopExp_Explorer_2: new (shape: OcctShape, toFind: number, toAvoid: number) => OcctExplorer;
  TopAbs_ShapeEnum: {
    TopAbs_FACE: number;
    TopAbs_EDGE: number;
    TopAbs_SHAPE: number;
  };
  TopAbs_Orientation: {
    TopAbs_FORWARD: unknown;
    TopAbs_REVERSED: unknown;
    TopAbs_INTERNAL: unknown;
    TopAbs_EXTERNAL: unknown;
  };
  TopoDS: {
    Face_1(shape: OcctShape): OcctShape;
  };
  BRep_Tool: {
    Triangulation(face: OcctShape, location: OcctLocation): OcctTriangulationHandle | null;
  };
  TopLoc_Location_1: new () => OcctLocation;
}
