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

/** A `gp_Dir`: a unit vector with the three coordinates read one by one. */
export interface OcctDirection3 {
  X(): number;
  Y(): number;
  Z(): number;
}

/** A `gp_Ax3`: a point and three perpendicular directions, the frame of a plane. */
export interface OcctAxis3 {
  Location(): OcctPoint;
  Direction(): OcctDirection3;
  XDirection(): OcctDirection3;
  YDirection(): OcctDirection3;
}

/** A `gp_Pln`: the plane a flat face lies in. */
export interface OcctPlane {
  Position(): OcctAxis3;
}

/** A `Bnd_Box`: the axis-aligned box around a shape. */
export interface OcctBoundingBox {
  GetXmin(): number;
  GetXmax(): number;
  GetYmin(): number;
  GetYmax(): number;
  GetZmin(): number;
  GetZmax(): number;
  IsVoid(): boolean;
}

/** A `gp_Trsf`: a placement the shape makers accept. */
export interface OcctTransformation3 {
  SetRotation_1(axis: unknown, angle: number): void;
  SetTranslation_1(vector: unknown): void;
  /**
   * Movement that brings `from` onto `to`. The change of coordinate system is
   * the one that measures a shape in `from` as if it sat in `to`.
   */
  SetTransformation_1(from: OcctAxis3, to: OcctAxis3): void;
  /** Row-major 3x4 affine: a11 a12 a13 a14 a21 a22 a23 a24 a31 a32 a33 a34. */
  SetValues(
    a11: number,
    a12: number,
    a13: number,
    a14: number,
    a21: number,
    a22: number,
    a23: number,
    a24: number,
    a31: number,
    a32: number,
    a33: number,
    a34: number,
  ): void;
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
  /** Null when meshing gave the face no triangulation. */
  get(): OcctTriangulation | null;
}

/** `Poly_PolygonOnTriangulation`: node indices into the face triangulation. */
export interface OcctPolygonOnTriangulation {
  NbNodes(): number;
  Nodes(): OcctArray<number>;
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

/** A sweep (prism or revolve) that can say where its input topology went. */
export interface OcctSweepMaker extends OcctPrismMaker {
  FirstShape(): OcctShape;
  LastShape(): OcctShape;
  Generated(shape: OcctShape): OcctShapeList;
  Modified(shape: OcctShape): OcctShapeList;
  IsDeleted(shape: OcctShape): boolean;
}

/** `BRepTools_History`: how a maker moved, merged and removed its input. */
export interface OcctHistory {
  Modified(shape: OcctShape): OcctShapeList;
  Generated(shape: OcctShape): OcctShapeList;
  IsRemoved(shape: OcctShape): boolean;
}

/** A handle to `BRepTools_History`; some makers return the object directly. */
export interface OcctHistoryHandle {
  get(): OcctHistory;
}

export interface OcctBooleanMaker {
  Build(): void;
  Shape(): OcctShape;
  /**
   * The faces a face became. A cut trims the faces around the tool, so `IsSame`
   * cannot find them in the result; this is the only way to keep their identity.
   */
  Modified(shape: OcctShape): OcctShapeList;
  /** Fills the history the boolean can report afterwards. */
  SetToFillHistory(enabled: boolean): void;
  History(): OcctHistoryHandle;
  HasHistory(): boolean;
}

/** The part of a maker that maps the faces it touched, boolean or treatment. */
export interface OcctFaceMapper {
  Modified(shape: OcctShape): OcctShapeList;
  Generated?(shape: OcctShape): OcctShapeList;
}

export interface OcctShapeMaker {
  Shape(): OcctShape;
}

/** `BRepBuilderAPI_MakePolygon`: a closed wire from straight edges. */
export interface OcctPolygonMaker {
  Add_1(point: OcctPoint3): void;
  Close(): void;
  Wire(): OcctShape;
}

export interface OcctVertexMaker {
  Vertex(): OcctShape;
}

/** `BRepOffsetAPI_ThruSections`: lofts a base wire to a single apex vertex. */
export interface OcctThruSectionsMaker {
  AddWire(wire: OcctShape): void;
  AddVertex(vertex: OcctShape): void;
  Build(): void;
  IsDone(): boolean;
  Shape(): OcctShape;
}

/** `TopTools_ListOfShape`: the faces a base face became. */
export interface OcctShapeList {
  Size(): number;
  First_1(): OcctShape;
  Last_1(): OcctShape;
  /** The binding has no iterator, so the list is drained from the front. */
  RemoveFirst(): void;
}

/** `TopTools_ListOfShape`, used for the faces a shell leaves open. */
export interface OcctShapeListMaker {
  Append_1(shape: OcctShape): void;
  Size(): number;
}

/** `BRepOffsetAPI_MakeThickSolid`: offsets a whole solid into a wall. */
export interface OcctThickSolidMaker extends OcctFaceMapper {
  MakeThickSolidByJoin(
    shape: OcctShape,
    closingFaces: OcctShapeListMaker,
    offset: number,
    tolerance: number,
    mode: unknown,
    intersection: boolean,
    selfInter: boolean,
    join: unknown,
    removeIntEdges: boolean,
  ): void;
  Build(): void;
  IsDone(): boolean;
  Shape(): OcctShape;
}

/** Shared surface of `BRepFilletAPI_MakeFillet` and `MakeChamfer`. */
export interface OcctEdgeMaker {
  /** `Add(размер, ребро)` for both makers. */
  Add_2(size: number, edge: OcctShape): void;
  Build(): void;
  IsDone(): boolean;
  Shape(): OcctShape;
  /**
   * The faces a face became. A trimmed face is rebuilt, so `IsSame` cannot find
   * it in the result; this is the only way to keep its identity.
   */
  Modified(shape: OcctShape): OcctShapeList;
  /** The faces a treatment surface an edge turned into. */
  Generated(shape: OcctShape): OcctShapeList;
  IsDeleted(shape: OcctShape): boolean;
}

/** `TDF_Label`: the persistent address of an object in a document. */
export interface OcctLabel {
  IsNull(): boolean;
}

/** `TDocStd_Document`: the XCAF document a STEP writer reads names and colours from. */
export interface OcctDocument {
  Main(): OcctLabel;
}

/** A handle wrapper: the object itself is reached through `get()`. */
export interface OcctHandle<T> {
  get(): T;
}

/** `XCAFDoc_ShapeTool`: places shapes into the document. */
export interface OcctShapeTool {
  /** Returns the label that owns the added shape. */
  AddShape(shape: OcctShape, makeAssembly: boolean, isNew: boolean): OcctLabel;
}

/** `Quantity_Color`: red, green and blue in 0..1. */
export interface OcctColor {
  Red(): number;
  Green(): number;
  Blue(): number;
}

/** `XCAFDoc_ColorTool`: assigns a colour to a document label. */
export interface OcctColorTool {
  /** The enum argument picks the colour slot; generic is what a body uses. */
  SetColor_2(label: OcctLabel, color: OcctColor, type: unknown): boolean;
  GetColor_1(label: OcctLabel, color: OcctColor): boolean;
  /** Looks in a colour slot: surface and curve colours are what STEP files carry. */
  GetColor_4(label: OcctLabel, type: unknown, color: OcctColor): boolean;
}

/** `STEPCAFControl_Reader`: turns a STEP file into an XCAF document. */
export interface OcctStepReader {
  SetColorMode(enabled: boolean): void;
  SetNameMode(enabled: boolean): void;
  /** Returns an `IFSelect_ReturnStatus`; `value === 1` is a successful read. */
  ReadFile(path: string): { value: number } | undefined;
  Transfer_1(document: unknown): boolean;
}

/** `TDF_ChildIterator`: walks the labels below a document label. */
export interface OcctChildIterator {
  More(): boolean;
  Next(): void;
  Value(): OcctLabel;
}

/** `STEPCAFControl_Writer`: writes shapes with their names and colours. */
export interface OcctStepWriter {
  SetColorMode(enabled: boolean): void;
  SetNameMode(enabled: boolean): void;
  /** Transfers the document and writes one AP214 file. */
  Perform_1(document: unknown, filename: unknown): boolean;
}

/** The Emscripten filesystem the written STEP file is read back from. */
export interface OcctFileSystem {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
}

export interface OcctBindings {
  BRepPrimAPI_MakeBox_1: new (dx: number, dy: number, dz: number) => OcctShapeMaker;
  BRepPrimAPI_MakeBox_2: new (
    origin: OcctPoint3,
    dx: number,
    dy: number,
    dz: number,
  ) => OcctShapeMaker;
  BRepPrimAPI_MakeSphere_5: new (center: OcctPoint3, radius: number) => OcctShapeMaker;
  BRepPrimAPI_MakeCylinder_3: new (axis: unknown, radius: number, height: number) => OcctShapeMaker;
  BRepPrimAPI_MakeCone_3: new (
    axis: unknown,
    bottomRadius: number,
    topRadius: number,
    height: number,
  ) => OcctShapeMaker;
  BRepPrimAPI_MakeTorus_5: new (
    axis: unknown,
    majorRadius: number,
    tubeRadius: number,
  ) => OcctShapeMaker;
  BRepBuilderAPI_MakePolygon_1: new () => OcctPolygonMaker;
  BRepBuilderAPI_MakeVertex: new (point: OcctPoint3) => OcctVertexMaker;
  BRepOffsetAPI_ThruSections: new (
    isSolid: boolean,
    ruled: boolean,
    pres3d: number,
  ) => OcctThruSectionsMaker;
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
    TopAbs_SHELL: number;
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
  ) => {
    GetType(): unknown;
    Plane(): OcctPlane;
  };
  /** The frame the standard XY plane sits in, so a face can be measured flat. */
  gp_Ax3_1: new () => OcctAxis3;
  gp_Ax3_3: new (point: OcctPoint3, direction: unknown, xDirection: unknown) => OcctAxis3;
  Bnd_Box_1: new () => OcctBoundingBox;
  BRepBndLib: {
    /** Box of the shape's own curves and surfaces; loose, but cheap. */
    Add(shape: OcctShape, box: OcctBoundingBox, useTriangulation: boolean): void;
    /** Box of the exact curves and surfaces, not of a tessellation. */
    AddOptimal(
      shape: OcctShape,
      box: OcctBoundingBox,
      useTriangulation: boolean,
      useShapeTolerance: boolean,
    ): void;
  };
  TopoDS: {
    Face_1(shape: OcctShape): OcctShape;
    Edge_1(shape: OcctShape): OcctShape;
    Shell_1(shape: OcctShape): OcctShape;
    Solid_1(shape: OcctShape): OcctShape;
  };
  TopoDS_Compound: new () => OcctShape;
  /** `BRep_Builder`: gathers shapes into one compound, which a boolean takes. */
  BRep_Builder: new () => {
    MakeCompound(shape: OcctShape): void;
    Add(shape: OcctShape, child: OcctShape): void;
  };
  GProp_GProps_1: new () => { Mass(): number; CentreOfMass(): OcctPoint3 };
  BRepGProp: {
    VolumeProperties_1(
      shape: OcctShape,
      props: { Mass(): number },
      onlyClosed: boolean,
      skipShared: boolean,
      useTriangulation: boolean,
    ): void;
    SurfaceProperties_1(
      shape: OcctShape,
      props: { Mass(): number; CentreOfMass(): OcctPoint3 },
      skipShared: boolean,
      useTriangulation: boolean,
    ): void;
  };
  BRep_Tool: {
    Triangulation(face: OcctShape, location: OcctLocation): OcctTriangulationHandle | null;
    /** Nodes of `edge` inside the triangulation of the face that owns it. */
    PolygonOnTriangulation_1(
      edge: OcctShape,
      triangulation: OcctTriangulationHandle,
      location: OcctLocation,
    ): OcctPolygonOnTriangulation | null;
  };
  TopLoc_Location_1: new () => OcctLocation;
  gp_Pnt_3: new (x: number, y: number, z: number) => OcctPoint3;
  gp_Dir_4: new (x: number, y: number, z: number) => unknown;
  gp_Vec_4: new (x: number, y: number, z: number) => unknown;
  gp_Ax2_2: new (origin: OcctPoint3, direction: unknown, xDirection: unknown) => unknown;
  gp_Circ_2: new (axis: unknown, radius: number) => unknown;
  gp_Elips_2: new (axis: unknown, majorRadius: number, minorRadius: number) => unknown;
  BRepBuilderAPI_MakeEdge_3: new (from: OcctPoint3, to: OcctPoint3) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeEdge_8: new (circle: unknown) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeEdge_9: new (
    circle: unknown,
    startAngle: number,
    endAngle: number,
  ) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeEdge_12: new (ellipse: unknown) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeEdge_13: new (
    ellipse: unknown,
    startAngle: number,
    endAngle: number,
  ) => { Edge(): OcctShape };
  BRepBuilderAPI_MakeWire_2: new (edge: OcctShape) => OcctWireMaker;
  BRepTools_WireExplorer_2: new (wire: OcctShape) => {
    More(): boolean;
    Next(): void;
    Current(): OcctShape;
  };
  BRepBuilderAPI_MakeFace_15: new (wire: OcctShape, onlyPlane: boolean) => OcctFaceMaker;
  BRepPrimAPI_MakePrism_1: new (
    shape: OcctShape,
    vector: unknown,
    copy: boolean,
    canonize: boolean,
  ) => OcctSweepMaker;
  BRepPrimAPI_MakeRevol_1: new (
    shape: OcctShape,
    axis: unknown,
    angle: number,
    copy: boolean,
  ) => OcctSweepMaker;
  gp_Ax1_2: new (origin: OcctPoint3, direction: unknown) => unknown;
  gp_Trsf_1: new () => OcctTransformation3;
  BRepBuilderAPI_Transform_2: new (
    shape: OcctShape,
    transform: unknown,
    copy: boolean,
  ) => OcctPrismMaker;
  BRepAlgoAPI_Fuse_3: new (a: OcctShape, b: OcctShape) => OcctBooleanMaker;
  BRepAlgoAPI_Cut_3: new (a: OcctShape, b: OcctShape) => OcctBooleanMaker;
  BRepAlgoAPI_Common_3: new (a: OcctShape, b: OcctShape) => OcctBooleanMaker;
  ShapeUpgrade_UnifySameDomain_2: new (
    shape: OcctShape,
    unifyEdges: boolean,
    unifyFaces: boolean,
    concatBSplines: boolean,
  ) => { Build(): void; Shape(): OcctShape; History_1(): OcctHistoryHandle };
  ChFi3d_FilletShape: {
    ChFi3d_Rational: unknown;
    ChFi3d_QuasiAngular: unknown;
    ChFi3d_Polynomial: unknown;
  };
  /** Both makers take the shape, and a fillet also takes its surface kind. */
  BRepFilletAPI_MakeFillet: new (shape: OcctShape, surface: unknown) => OcctEdgeMaker;
  BRepFilletAPI_MakeChamfer: new (shape: OcctShape) => OcctEdgeMaker;
  BRepCheck_Analyzer: new (
    shape: OcctShape,
    geometryControls: boolean,
  ) => {
    IsValid_2(): boolean;
  };
  BRepOffsetAPI_MakeThickSolid_1: new () => OcctThickSolidMaker;
  TopTools_ListOfShape_1: new () => OcctShapeListMaker;
  BRepBuilderAPI_MakeSolid_3: new (shell: OcctShape) => {
    IsDone(): boolean;
    Solid(): OcctShape;
  };
  BRepOffset_Mode: {
    BRepOffset_Skin: unknown;
    BRepOffset_Pipe: unknown;
    BRepOffset_RectoVerso: unknown;
  };
  GeomAbs_JoinType: {
    GeomAbs_Arc: unknown;
    GeomAbs_Tangent: unknown;
    GeomAbs_Intersection: unknown;
  };
  TCollection_AsciiString_2: new (text: string) => unknown;
  /**
   * `isMultiByte` is false for names: the binding then keeps the UTF-8 bytes of
   * a non-ASCII name intact, which is what the STEP writer encodes.
   */
  TCollection_ExtendedString_2: new (text: string, isMultiByte: boolean) => unknown;
  TDocStd_Document: new (storageFormat: unknown) => OcctDocument;
  Handle_TDocStd_Document_2: new (document: OcctDocument) => unknown;
  XCAFDoc_DocumentTool: {
    ShapeTool(label: OcctLabel): OcctHandle<OcctShapeTool>;
    ColorTool(label: OcctLabel): OcctHandle<OcctColorTool>;
  };
  XCAFDoc_ColorType: {
    XCAFDoc_ColorGen: unknown;
    XCAFDoc_ColorSurf: unknown;
    XCAFDoc_ColorCurv: unknown;
  };
  XCAFDoc_ShapeTool: {
    IsSimpleShape(label: OcctLabel): boolean;
    /** Fills the shape of a label; false when the label owns no shape. */
    GetShape_1(label: OcctLabel, shape: OcctShape): boolean;
  };
  TDF_ChildIterator_2: new (label: OcctLabel, allLevels: boolean) => OcctChildIterator;
  TopoDS_Shape: new () => OcctShape;
  STEPCAFControl_Reader_1: new () => OcctStepReader;
  TDataStd_Name: {
    Set_1(label: OcctLabel, name: unknown): void;
  };
  Quantity_Color_3: new (red: number, green: number, blue: number, colorType: number) => OcctColor;
  STEPCAFControl_Writer_1: new () => OcctStepWriter;
  FS: OcctFileSystem;
}
