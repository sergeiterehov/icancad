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
  IsNull(): boolean;
  Orientation_1(): unknown;
  Reversed(): OcctShape;
}

export interface OcctPoint3 {
  X(): number;
  Y(): number;
  Z(): number;
}

export interface OcctWireMaker {
  Add_1(edge: OcctShape): void;
  Wire(): OcctShape;
  IsDone(): boolean;
}

export interface OcctFaceMaker {
  Add(wire: OcctShape): void;
  Face(): OcctShape;
  IsDone(): boolean;
}

export interface OcctPrismMaker {
  Shape(): OcctShape;
  IsDone(): boolean;
}

export interface OcctBooleanMaker {
  Build(): void;
  Shape(): OcctShape;
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
    TopAbs_SOLID: number;
    TopAbs_SHAPE: number;
  };
  TopAbs_Orientation: {
    TopAbs_FORWARD: unknown;
    TopAbs_REVERSED: unknown;
    TopAbs_INTERNAL: unknown;
    TopAbs_EXTERNAL: unknown;
  };
  GeomAbs_SurfaceType: {
    GeomAbs_Plane: unknown;
  };
  BRepAdaptor_Surface_2: new (
    face: OcctShape,
    restriction: boolean,
  ) => { GetType(): unknown };
  TopoDS: {
    Face_1(shape: OcctShape): OcctShape;
    Edge_1(shape: OcctShape): OcctShape;
  };
  BRep_Tool: {
    Triangulation(face: OcctShape, location: OcctLocation): OcctTriangulationHandle | null;
  };
  TopLoc_Location_1: new () => OcctLocation;
  gp_Pnt_3: new (x: number, y: number, z: number) => OcctPoint3;
  gp_Dir_4: new (x: number, y: number, z: number) => unknown;
  gp_Vec_4: new (x: number, y: number, z: number) => unknown;
  gp_Ax2_2: new (origin: OcctPoint3, direction: unknown, xDirection: unknown) => unknown;
  gp_Circ_2: new (axis: unknown, radius: number) => unknown;
  BRepBuilderAPI_MakeEdge_3: new (from: OcctPoint3, to: OcctPoint3) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeEdge_8: new (circle: unknown) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeEdge_9: new (
    circle: unknown,
    startAngle: number,
    endAngle: number,
  ) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeWire_2: new (edge: OcctShape) => OcctWireMaker;
  BRepBuilderAPI_MakeFace_15: new (wire: OcctShape, onlyPlane: boolean) => OcctFaceMaker;
  BRepPrimAPI_MakePrism_1: new (
    shape: OcctShape,
    vector: unknown,
    copy: boolean,
    canonize: boolean,
  ) => OcctPrismMaker;
  BRepAlgoAPI_Fuse_3: new (a: OcctShape, b: OcctShape) => OcctBooleanMaker;
  BRepAlgoAPI_Cut_3: new (a: OcctShape, b: OcctShape) => OcctBooleanMaker;
  BRepAlgoAPI_Common_3: new (a: OcctShape, b: OcctShape) => OcctBooleanMaker;
  ShapeUpgrade_UnifySameDomain_2: new (
    shape: OcctShape,
    unifyEdges: boolean,
    unifyFaces: boolean,
    concatBSplines: boolean,
  ) => { Build(): void; Shape(): OcctShape };
}
