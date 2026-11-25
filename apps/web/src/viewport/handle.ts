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
  /** A broken formula paints the whole sketch red, over every other colour. */
  error?: boolean;
  /** Construction geometry is a helper, so it is only drawn when asked for. */
  showConstruction?: boolean;
  entities: SketchEntity[];
  faces: SceneSketchFace[];
  /** Faces are offered for picking, so they are shown faintly. */
  facesPicking?: boolean;
  selectionKeys: string[];
  dimmedEntityIds: string[];
  frozenEntityIds: string[];
  /** Fixed points, keyed `entityId#index`; they cannot move. */
  fixedPointIds?: string[];
  /** Geometry of conflicting or redundant constraints; drawn as a warning. */
  problemEntityIds: string[];
  /** Entities projected from 3D geometry; they are drawn in violet. */
  projectedEntityIds: string[];
  /** Projected entities whose source is gone; they use the snapshot in orange. */
  lostEntityIds: string[];
  highlightIds: string[];
  /** Geometry under the pointer while selecting. */
  hoverIds: string[];
  active: boolean;
  /** Draws over the bodies: the sketch is edited, selected, or its operation is. */
  onTop: boolean;
  /** Geometry the current tool cannot take: drawn grey and faded. */
  greyed?: boolean;
}

export interface ViewportCamera {
  target: [number, number, number];
  distance: number;
  azimuth: number;
  polar: number;
  /** Tilt of the horizon in a trackball view; absent means level. */
  roll?: number;
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
  /** Model-space radius; `radiusPx` replaces it when that is set. */
  radius: number;
  /**
   * A radius that stays the same number of screen pixels at any zoom. When set,
   * it replaces `radius` for drawing and hit testing.
   */
  radiusPx?: number;
  /**
   * The whole circle is the grip, not just the swept arc. A rotation ring has no
   * stored angle to sweep from, so it is grabbable anywhere around it.
   */
  fullCircle?: boolean;
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
  /** Present on a radial orbit handle: the grip slides along a circle. */
  orbit?: SceneArcHandle;
  /**
   * A trajectory the grip slides along, as world-space points. The pointer is
   * read where it meets the trajectory, so a count follows the curve it counts
   * along instead of a straight line from the seed.
   */
  trail?: [number, number, number][];
  /**
   * A move grip is a circle, a scale grip a yellow square, a stepped grip a
   * ball; every other handle is an arrow.
   */
  kind?: 'arrow' | 'move' | 'ball' | 'square';
  /** Translation arrows take the colour of their world axis. */
  axis?: 'x' | 'y' | 'z';
  /** A short translation arrow keeps its screen length instead of a model size. */
  fixedLengthPx?: number;
  /** Size handles draw a dashed shaft; move arrows keep it solid. */
  shaft?: 'solid' | 'dashed';
  /** Only the arrowhead is grabbable; the shaft is just a dimension line. */
  tipOnly?: boolean;
  /**
   * Screen distance the arrow stops short of its value, so a grip drawn at the
   * same point (a ball on the dial) keeps its outline clear.
   */
  endGapPx?: number;
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
  kind?: 'arrow' | 'move' | 'ball' | 'square';
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
    preview: SketchEntity | readonly SketchEntity[] | null,
    draftPoints: Point2[],
    highlight?: boolean,
    marker?: Point2 | null,
    /** Dotted construction the draft implies, such as the circle an arc cuts. */
    guides?: SketchEntity[],
    /** Where the next point of a creation tool would land, and whether it snaps. */
    cursor?: { point: Point2; snapped: boolean } | null,
    /** Entities of the edited sketch the preview takes over; they are hidden
     * while it is up, so their old shape cannot be read over the ghost. */
    replaced?: readonly string[],
  ) => void;
  alignSketch: (
    frame: SketchFrame,
    entities?: readonly SketchEntity[],
    extraPoints?: readonly Point2[],
  ) => void;
  /** Whether all of the sketch's geometry stands in the picture as it is now. */
  sketchFits: (
    frame: SketchFrame,
    entities?: readonly SketchEntity[],
    extraPoints?: readonly Point2[],
  ) => boolean;
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
  /** The point of the edited sketch plane under the pointer, without a magnet. */
  sketchPointAt: (clientX: number, clientY: number) => Point2 | null;
  /** Length of the sketch plane a band of screen pixels covers, in sketch units. */
  sketchLength: (px: number) => number;
}

let current: ViewportHandle | null = null;

export function registerViewport(handle: ViewportHandle | null): void {
  current = handle;
}

export function getViewport(): ViewportHandle | null {
  return current;
}
