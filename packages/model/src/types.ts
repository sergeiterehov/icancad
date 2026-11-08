export const HISTORY_START = 'start';

export type Vec3 = [number, number, number];

export interface Transform {
  translation: Vec3;
  rotation: Vec3;
  scale: number;
}

export type FeatureType =
  | 'primitive'
  | 'import-mesh'
  | 'convert-to-solid'
  | 'sketch'
  | 'extrude'
  | 'shell'
  | 'hole'
  | 'rib'
  | 'fillet'
  | 'chamfer'
  | 'boolean'
  | 'transform';

export interface FeatureBase {
  id: string;
  name: string;
  suppressed: boolean;
}

export interface PrimitiveFeature extends FeatureBase {
  type: 'primitive';
  kind: 'box';
  params: { dx: number; dy: number; dz: number };
  transform: Transform;
}

export interface ImportMeshFeature extends FeatureBase {
  type: 'import-mesh';
  assetId: string;
  transform: Transform;
  scale: number;
}

export interface ConvertToSolidFeature extends FeatureBase {
  type: 'convert-to-solid';
  sourceBodyId: string;
  mode: 'auto' | 'heal' | 'voxel';
  voxelSize?: number;
  targetTriangles?: number;
  tolerance?: number;
}

export type SketchEntity =
  | { id: string; type: 'point'; construction: boolean; x: number; y: number }
  | {
      id: string;
      type: 'line';
      construction: boolean;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      id: string;
      type: 'arc';
      construction: boolean;
      cx: number;
      cy: number;
      r: number;
      startAngle: number;
      endAngle: number;
    }
  | { id: string; type: 'circle'; construction: boolean; cx: number; cy: number; r: number }
  | {
      id: string;
      type: 'ellipse';
      construction: boolean;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation: number;
    }
  | { id: string; type: 'bezier'; construction: boolean; points: Array<[number, number]> };

export type ConstraintType =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal'
  | 'distance'
  | 'horizontal-distance'
  | 'vertical-distance'
  | 'angle'
  | 'radius'
  | 'diameter'
  | 'concentric'
  | 'symmetric'
  | 'midpoint'
  | 'point-on-line'
  | 'point-on-circle'
  | 'point-on-ellipse'
  | 'fix';

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  entityIds: string[];
  value?: number;
}

export interface SketchFrame {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  normal: Vec3;
}

export type SketchPlaneRef =
  | { type: 'datum'; plane: 'XY' | 'XZ' | 'YZ'; offset: number }
  | { type: 'face'; bodyId: string; topoId: string; frame?: SketchFrame };

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: SketchPlaneRef;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketchId: string;
  regions: string[];
  end: 'blind' | 'symmetric' | 'two-sided' | 'through-all';
  distance: number;
  distance2?: number;
  op: 'new' | 'add' | 'subtract' | 'intersect';
  scope: 'all' | 'selected';
  bodyIds: string[];
  joinRegions: boolean;
}

export interface ShellFeature extends FeatureBase {
  type: 'shell';
  bodyId: string;
  removeFaces: EntityRef[];
  thickness: number;
  direction: 'inward' | 'outward';
}

export interface EntityRef {
  bodyId: string;
  topoId: string;
  fingerprint?: {
    surfaceType: string;
    measure: number;
    centroid: Vec3;
    normal: Vec3;
  };
}

export interface HoleSpec {
  kind: 'simple' | 'counterbore' | 'countersink';
  diameter: number;
  depth?: number;
  throughAll: boolean;
  clearance?: string;
  headDiameter?: number;
  headDepth?: number;
  angle?: number;
}

export interface HoleFeature extends FeatureBase {
  type: 'hole';
  bodyId: string;
  faceRef: EntityRef;
  positions: Array<{ x: number; y: number }>;
  spec: HoleSpec;
}

export interface RibFeature extends FeatureBase {
  type: 'rib';
  bodyId: string;
  sketchId: string;
  thickness: number;
  direction: Vec3;
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  bodyId: string;
  edges: EntityRef[];
  radius: number;
}

export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  bodyId: string;
  edges: EntityRef[];
  distance: number;
}

export interface BooleanFeature extends FeatureBase {
  type: 'boolean';
  op: 'union' | 'subtract' | 'intersect';
  bodyIds: string[];
}

export interface TransformFeature extends FeatureBase {
  type: 'transform';
  bodyId: string;
  transform: Transform;
}

export type Feature =
  | PrimitiveFeature
  | ImportMeshFeature
  | ConvertToSolidFeature
  | SketchFeature
  | ExtrudeFeature
  | ShellFeature
  | HoleFeature
  | RibFeature
  | FilletFeature
  | ChamferFeature
  | BooleanFeature
  | TransformFeature;

export interface BodyMeta {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  createdBy: string;
}

export interface SectionPlane {
  id: string;
  name: string;
  origin: Vec3;
  normal: Vec3;
  offset: number;
  visible: boolean;
}

export interface CameraState {
  target: Vec3;
  distance: number;
  azimuth: number;
  polar: number;
}

export interface ViewState {
  camera: CameraState | null;
  sectionPlanes: SectionPlane[];
  hiddenBodyIds: string[];
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  units: 'mm';
  features: Feature[];
  bodies: BodyMeta[];
  view: ViewState;
  historyEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FeatureErrorCode =
  | 'KERNEL_NOT_READY'
  | 'KERNEL_LOAD_FAILED'
  | 'SHAPE_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'NOT_IMPLEMENTED'
  | 'OP_FAILED';
