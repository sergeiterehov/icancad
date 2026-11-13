import type { SketchEntity, SketchFrame } from '@icancad/model';
import type { Point2 } from '@icancad/sketch';
import type { SketchSnap } from '../sketch/snap';

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

export interface SceneSketchFace {
  id: string;
  outline: Point2[];
  holes: Point2[][];
}

export interface SceneSketch {
  id: string;
  frame: SketchFrame;
  /** Line colour of the object; the sketch being edited keeps the theme colours. */
  color?: string;
  /** Construction geometry is a helper, so it is only drawn when asked for. */
  showConstruction?: boolean;
  entities: SketchEntity[];
  faces: SceneSketchFace[];
  /** Faces are offered for picking, so they are shown faintly. */
  facesPicking?: boolean;
  selectionKeys: string[];
  dimmedEntityIds: string[];
  frozenEntityIds: string[];
  /** Entities projected from 3D geometry; they are drawn in violet. */
  projectedEntityIds: string[];
  /** Projected entities whose source is gone; they use the snapshot in orange. */
  lostEntityIds: string[];
  highlightIds: string[];
  /** Geometry under the pointer while selecting. */
  hoverIds: string[];
  active: boolean;
}

export interface ViewportCamera {
  target: [number, number, number];
  distance: number;
  azimuth: number;
  polar: number;
}

/** What a click in the viewport landed on. */
export type ScenePick =
  | { kind: 'body'; id: string }
  | { kind: 'mesh'; id: string }
  | { kind: 'face'; sketchId: string; faceId: string }
  | {
      kind: 'body-face';
      bodyId: string;
      faceId: string;
      normal: [number, number, number];
      origin: [number, number, number];
      /** False for cylinders, spheres and other curved faces. */
      planar: boolean;
    }
  | { kind: 'body-edge'; bodyId: string; edgeId: string }
  | { kind: 'sketch-edge'; sketchId: string; entityId: string }
  | {
      kind: 'body-vertex';
      bodyId: string;
      elementId: string;
      position: [number, number, number];
    };

/**
 * An angular handle: the grip turns around an axis instead of sliding along a
 * line. `origin` is where the grip is drawn; the arc explains the angle.
 */
export interface SceneArcHandle {
  /** Direction of the axis the grip turns around. */
  axis: [number, number, number];
  /** Point on the axis the arc is centred on. */
  center: [number, number, number];
  /** Direction of the zero angle, perpendicular to `axis`. */
  reference: [number, number, number];
  /** Angle of the grip in radians, right-handed around `axis`. */
  angle: number;
  radius: number;
}

/**
 * A 3D handle that belongs to an operation. The handle draws an arrow from
 * `origin` along `direction`; `value` is the length of the operation it shows.
 */
export interface SceneHandle {
  id: string;
  origin: [number, number, number];
  direction: [number, number, number];
  /** Length along `direction`; zero draws the idle affordance. */
  value: number;
  enabled: boolean;
  /** How heavy the arrow is drawn, relative to the thinnest one. */
  thickness?: number;
  /** Shown when the pointer hovers the handle. */
  tooltip?: string;
  /** Present on an angle handle: the grip turns around an axis. */
  arc?: SceneArcHandle;
}

/** Where a handle is on screen, for the drag chip and for tests. */
export interface SceneHandleScreen {
  id: string;
  originX: number;
  originY: number;
  tipX: number;
  tipY: number;
  value: number;
  enabled: boolean;
}

/** A preview ghost as the scene draws it; exposed for tests and diagnostics. */
export interface SceneGhostInfo {
  id: string;
  color: string;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

export interface SketchPick {
  point: Point2;
  entityId: string | null;
  pointIndex: number | null;
}

export interface ViewportHandle {
  fit: () => void;
  getHandles: () => SceneHandleScreen[];
  getGhosts: () => SceneGhostInfo[];
  setView: (name: ViewName) => void;
  setSketches: (sketches: SceneSketch[]) => void;
  setSketchOverlay: (
    preview: SketchEntity | null,
    draftPoints: Point2[],
    highlight?: boolean,
    marker?: Point2 | null,
  ) => void;
  alignSketch: (frame: SketchFrame, entities?: readonly SketchEntity[]) => void;
  getCameraState: () => ViewportCamera;
  setCameraState: (state: ViewportCamera) => void;
  pickSketch: (
    clientX: number,
    clientY: number,
    entities?: readonly SketchEntity[],
  ) => SketchPick | null;
  snapSketch: (
    clientX: number,
    clientY: number,
    tolerancePx?: number,
    entities?: readonly SketchEntity[],
  ) => SketchSnap | null;
  projectSketchPoint: (frame: SketchFrame, point: Point2) => { x: number; y: number } | null;
}

let current: ViewportHandle | null = null;

export function registerViewport(handle: ViewportHandle | null): void {
  current = handle;
}

export function getViewport(): ViewportHandle | null {
  return current;
}
