import type { TessellationResult } from '@icancad/kernel';
import type { SectionPlane, SketchEntity, SketchFrame } from '@icancad/model';
import {
  entityControlPoints,
  fundamentalEntities,
  isFundamentalEntityId,
  isSketchAxisId,
  SKETCH_ORIGIN_ID,
  SKETCH_X_AXIS_ID,
  sketchPointToWorld,
  tessellateEntity,
  withFundamentalEntities,
  worldToSketchPoint,
  type Point2,
} from '@icancad/sketch';
import * as THREE from 'three';
import type { Theme } from '../stores/themeStore';
import { useUiStore } from '../stores/uiStore';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { SketchSnap } from '../sketch/snap';
import type { PreviewFaceMark, PreviewMarkKind, SceneGhost } from '../stores/kernelStore';
import { isAdditiveClick } from '../ui/listSelection';
import {
  CAMERA_FOV_DEGREES,
  cameraFrustum,
  easeInOut,
  fitDistance,
  shortestAngle,
} from './cameraFit';
import { cameraDragMode, cameraScheme } from './cameraControls';
import {
  isTouchPointer,
  noteWheelKind,
  resolvedPointerKind,
  wheelPointerKind,
  type PointerKind,
} from './inputProfile';
import { orbitAbout, orbitRotation, pointOnRayAtTarget } from './orbitPivot';
import { facesPlane, sketchTurnMode } from './sketchView';
import { trackballOrbit } from './trackball';
import type {
  SceneArcHandle,
  SceneGhostInfo,
  SceneHandle,
  SceneHandleScreen,
  ScenePick,
  SceneSketch,
  SketchPick,
  ViewName,
  ViewportCamera,
} from './handle';
import { hoverColor, selectionColor } from './interactionColors';
import { isPlanarFace } from './planarFace';
import { OUTLINE_CREASE_RADIANS, outlineSegments } from './bodyOutline';
import { bodyElements } from '../sketch/projection';
import { RenderOrder, solidDepthBias } from './renderOrder';
import { firstUnclippedHit, sectionCrossings } from './sectionPick';
import { geometryHoverEnabled, hoverTargetOf } from './hoverMode';
import { handleDragValue } from '../quick/handleDrag';
import { outwardNormal, pointInMesh } from '../quick/geometry';
import type { SelectionHit } from './selectionPick';

function lineGeometry(positions: Float32Array): THREE.BufferGeometry | null {
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** How a ghost looks, so a redraw can tell whether it may keep its material. */
function ghostLook(ghost: SceneGhost): string {
  return `${ghost.color}|${ghost.opacity ?? ''}|${ghost.fade ? JSON.stringify(ghost.fade) : ''}`;
}

/** Identity of a pick, so the pointer only reports geometry that changed. */
function pickKey(pick: ScenePick): string {
  switch (pick.kind) {
    case 'body':
    case 'mesh':
      return `${pick.kind}:${pick.id}`;
    case 'face':
      return `face:${pick.sketchId}#${pick.faceId}`;
    case 'body-face':
      return `body-face:${pick.bodyId}#${pick.faceId}`;
    case 'body-edge':
      return `body-edge:${pick.bodyId}#${pick.edgeId}`;
    case 'body-vertex':
      return `body-vertex:${pick.bodyId}#${pick.elementId}`;
    case 'sketch-edge':
      return `sketch-edge:${pick.sketchId}#${pick.entityId}`;
  }
}

/** A placement of a ghost, from a row-major 3x4 affine to a scene matrix. */
function ghostPlacement(values: readonly number[]): THREE.Matrix4 {
  const [
    a11 = 1,
    a12 = 0,
    a13 = 0,
    a14 = 0,
    a21 = 0,
    a22 = 1,
    a23 = 0,
    a24 = 0,
    a31 = 0,
    a32 = 0,
    a33 = 1,
    a34 = 0,
  ] = values;
  return new THREE.Matrix4().set(
    a11,
    a12,
    a13,
    a14,
    a21,
    a22,
    a23,
    a24,
    a31,
    a32,
    a33,
    a34,
    0,
    0,
    0,
    1,
  );
}

/** Where the grip of an angle handle sits, in world space. */
/** How far along a trail a point sits, in world units from its start. */
function trailLengths(points: readonly [number, number, number][]): number[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    lengths.push(
      lengths[index - 1]! +
        Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]),
    );
  }
  return lengths;
}

/** The point of a trail at `distance` from its start. */
function pointOnTrail(
  points: readonly [number, number, number][],
  distance: number,
): THREE.Vector3 {
  if (points.length === 0) return new THREE.Vector3();
  const lengths = trailLengths(points);
  const total = lengths[lengths.length - 1] ?? 0;
  const target = Math.min(Math.max(distance, 0), total);
  let index = 1;
  while (index < lengths.length - 1 && lengths[index]! < target) index += 1;
  const previous = points[index - 1]!;
  const point = points[index] ?? previous;
  const span = (lengths[index] ?? 0) - (lengths[index - 1] ?? 0);
  const t = span > 1e-12 ? (target - lengths[index - 1]!) / span : 0;
  return new THREE.Vector3(
    previous[0] + (point[0] - previous[0]) * t,
    previous[1] + (point[1] - previous[1]) * t,
    previous[2] + (point[2] - previous[2]) * t,
  );
}

function arcGripPoint(arc: SceneArcHandle, angle: number): THREE.Vector3 {
  const axis = new THREE.Vector3(...arc.axis).normalize();
  const reference = new THREE.Vector3(...arc.reference).normalize();
  const tangent = new THREE.Vector3().crossVectors(axis, reference);
  return new THREE.Vector3(...arc.center)
    .addScaledVector(reference, Math.cos(angle) * arc.radius)
    .addScaledVector(tangent, Math.sin(angle) * arc.radius);
}

const HATCH_SPACING_PX = 6;
/** Screen distance over which a through-cut ghost fades out. */
const GHOST_FADE_PX = 100;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_SLOP_PX = 6;
/** Length of the idle arrow, before an operation gives the handle a value. */
const HANDLE_IDLE_PX = 48;
const HANDLE_HIT_PX = 9;
/** Overlays are lifted off the surface they annotate to avoid depth fighting. */
const FACE_OVERLAY_LIFT = 0.01;
/**
 * How far a hovered edge is lifted towards the viewer. Enough to clear the
 * surface tessellation under it at any zoom, small enough that a face in front
 * still hides it.
 */
const EDGE_HOVER_LIFT_PX = 12;
const SKETCH_FACE_LIFT = 0.02;
/** Tessellations above this size are not scanned for outlines. */
const OUTLINE_TRIANGLE_LIMIT = 250_000;
// Faces that lie exactly on a section plane are rejected per fragment on
// floating-point noise, which draws them as stripes. The extra thousandth of a
// millimetre keeps such faces whole.
const SECTION_CLIP_BIAS = 0.01;

/**
 * The pose a model opens with when nothing about it is known yet: an isometric
 * look at the origin, far enough out to hold a model of any size until the fit
 * that follows the build puts the camera where the model is.
 */
const DEFAULT_CAMERA_DISTANCE = 200;
const DEFAULT_CAMERA_AZIMUTH = -Math.PI / 4;
const DEFAULT_CAMERA_POLAR = Math.PI / 3;

/** A colour of the world axes, as the vertex colours of a line expect it. */
function axisColor(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export interface SceneBody {
  id: string;
  kind: 'solid' | 'mesh';
  mesh: TessellationResult;
  color: string;
  visible: boolean;
  /**
   * Place of the object in the object tree, from the top. It decides which body
   * owns a surface two of them share; the last row wins.
   */
  order?: number;
  /** Phantom delta of the operation being edited. */
  ghost?: PreviewMarkKind;
  /** Draw the ghost translucent; opaque moves stay solid so holes read as cuts. */
  translucent?: boolean;
  /** Objects the operation adds are shown but cannot be picked. */
  interactive?: boolean;
  /**
   * Tessellation used for picking. During a preview it is the body before the
   * edited operation, so interaction always targets the input model.
   */
  hitMesh?: TessellationResult;
}

interface BodyEntry {
  group: THREE.Group;
  kind: 'solid' | 'mesh';
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  edges: THREE.LineSegments | null;
  edgeGeometry: THREE.BufferGeometry | null;
  /** Tangency lines where a fillet blends into a face. */
  tangentEdges: THREE.LineSegments | null;
  tangentGeometry: THREE.BufferGeometry | null;
  meshRef: TessellationResult;
  /** Mesh and tessellation used for picking (the input model during a preview). */
  hitMesh: THREE.Mesh;
  hitGeometry: THREE.BufferGeometry | null;
  hitRef: TessellationResult;
  color: string;
  /** Depth units the body gives up to the objects listed below it. */
  depthBias: number;
  ghost: PreviewMarkKind | null;
  translucent: boolean;
  interactive: boolean;
}

const FOV_DEGREES = CAMERA_FOV_DEGREES;
const CAMERA_TRANSITION_MS = 500;
/** How far one pixel of a camera drag turns the view, in radians. */
const ORBIT_RADIANS_PER_PIXEL = 0.008;
/** A two-finger scroll moves much less per pixel than a drag does. */
const SCROLL_RADIANS_PER_PIXEL = 0.004;
/**
 * Zoom per wheel unit. A mouse sends whole notches of about a hundred units, a
 * trackpad scrolls in single units, and a pinch comes as a few of them, so the
 * same factor would make a pinch crawl.
 */
const WHEEL_ZOOM_RATE = 0.0012;
const SCROLL_ZOOM_RATE = 0.004;
const PINCH_ZOOM_RATE = 0.01;

/** Faces selected for an operation, plus the one under the cursor. */
export interface FaceHighlightState {
  /** `s:<sketchId>#<faceId>` or `b:<bodyId>#<faceId>`. */
  selected: readonly string[];
  invalid: readonly string[];
  picking: boolean;
  /** Bodies are being picked as operation targets. */
  bodyPicking: boolean;
  /** Ignore sketch face pickers and only accept solid-body faces. */
  bodyFacesOnly?: boolean;
  /** Pick body edges; a hit within the click tolerance wins over the face. */
  edgePicking?: boolean;
  /** Pick body vertices; a hit within the click tolerance wins over the edges. */
  vertexPicking?: boolean;
  /** Pick body vertices, edges or faces to project them into a sketch. */
  projecting?: boolean;
}

interface CameraPose {
  target: THREE.Vector3;
  distance: number;
  azimuth: number;
  polar: number;
  /** Tilt of the horizon; a view preset always levels it. */
  roll?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Mirrors the basis three.js derives in `lookAt` for our orbit camera.
function cameraBasis(azimuth: number, polar: number): { right: THREE.Vector3; up: THREE.Vector3 } {
  const offset = new THREE.Vector3(
    Math.sin(polar) * Math.cos(azimuth),
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
  );
  const upHint =
    Math.abs(Math.cos(polar)) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(upHint, offset).normalize();
  const up = new THREE.Vector3().crossVectors(offset, right).normalize();
  return { right, up };
}

function createCircleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(32, 32, 28, 0, Math.PI * 2);
    context.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

function pointSegmentDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
}

// Triangles of one B-rep face as a standalone highlight surface.
function faceGeometry(mesh: TessellationResult, faceId: number): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const { positions: source, normals: sourceNormals, indices, faceIds } = mesh;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] !== faceId) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[triangle * 3 + corner]!;
      positions.push(source[vertex * 3]!, source[vertex * 3 + 1]!, source[vertex * 3 + 2]!);
      normals.push(
        sourceNormals[vertex * 3]!,
        sourceNormals[vertex * 3 + 1]!,
        sourceNormals[vertex * 3 + 2]!,
      );
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function closestOnSegment(
  point: Point2,
  a: Point2,
  b: Point2,
): { point: Point2; distance: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { point: [a[0], a[1]], distance: Math.hypot(point[0] - a[0], point[1] - a[1]) };
  }
  const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared, 0, 1);
  const closest: Point2 = [a[0] + dx * t, a[1] + dy * t];
  return { point: closest, distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]) };
}

/** Camera angles of the named view; world Z is up. */
function viewAngles(name: ViewName): { azimuth: number; polar: number } {
  switch (name) {
    case 'front':
      return { azimuth: -Math.PI / 2, polar: Math.PI / 2 };
    case 'back':
      return { azimuth: Math.PI / 2, polar: Math.PI / 2 };
    case 'right':
      return { azimuth: 0, polar: Math.PI / 2 };
    case 'left':
      return { azimuth: Math.PI, polar: Math.PI / 2 };
    case 'top':
      return { azimuth: -Math.PI / 2, polar: 0.001 };
    case 'bottom':
      return { azimuth: -Math.PI / 2, polar: Math.PI - 0.001 };
    case 'iso':
      return { azimuth: -Math.PI / 4, polar: Math.PI / 3 };
  }
}

export class SceneController {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly bodies = new Map<string, BodyEntry>();
  private readonly resizeObserver: ResizeObserver;
  private grid: THREE.GridHelper;
  /** World axes: a view aid of the 3D view, drawn on request. */
  private axes: THREE.LineSegments;
  private showAxes = false;
  private showGrid = true;
  /** The diagonal line of a section cap; without it the cap keeps its colour. */
  private sectionHatch = true;
  private readonly sectionScene = new THREE.Scene();
  /** Transparent annotations drawn after the section caps. */
  private readonly overlayScene = new THREE.Scene();
  private readonly capGeometry = new THREE.PlaneGeometry(4000, 4000);
  private sectionPlanes: SectionPlane[] = [];
  private sectionClipPlanes: THREE.Plane[] = [];
  private sectionEntries: {
    group: THREE.Group;
    cap: THREE.Mesh;
    materials: THREE.Material[];
    bodyId: string;
  }[] = [];
  private sketchData: SceneSketch[] = [];
  private sketchEntries: {
    id: string;
    frame: SketchFrame;
    group: THREE.Group;
    hitObjects: THREE.Object3D[];
    active: boolean;
  }[] = [];
  private readonly facePickMeshes: THREE.Mesh[] = [];
  /** Translucent volumes that only exist in the operation preview. */
  private readonly ghostGroup = new THREE.Group();
  private readonly ghostEntries = new Map<
    string,
    {
      mesh: THREE.Mesh;
      material: THREE.MeshStandardMaterial;
      geometry: THREE.BufferGeometry;
      /** Bounds of the volume where it is drawn, placement included. */
      box: THREE.Box3;
      /** Tessellation and look the entry was built from; a match means reuse. */
      source: TessellationResult;
      look: string;
    }
  >();
  /** Geometries of the volumes the current ghosts draw; copies share one. */
  private readonly ghostGeometries = new Map<TessellationResult, THREE.BufferGeometry>();
  private ghostSources: readonly SceneGhost[] = [];
  /** Highlight surfaces for picked faces, keyed by `s:`/`b:` refs. */
  private readonly sketchFaceMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly bodyFaceOverlays = new Map<
    string,
    { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }
  >();
  private readonly faceOverlayGroup = new THREE.Group();
  /** New faces of the edge treatment being edited, coloured by what they do. */
  private treatmentMarks: readonly PreviewFaceMark[] = [];
  private readonly treatmentMarkGroup = new THREE.Group();
  private readonly treatmentMarkMeshes: Array<{
    mesh: THREE.Mesh;
    material: THREE.Material;
  }> = [];
  private faceHighlights: {
    selected: Set<string>;
    invalid: Set<string>;
    picking: boolean;
    bodyPicking: boolean;
    bodyFacesOnly: boolean;
    edgePicking: boolean;
    vertexPicking: boolean;
    projecting: boolean;
  } = {
    selected: new Set(),
    invalid: new Set(),
    picking: false,
    bodyPicking: false,
    bodyFacesOnly: false,
    projecting: false,
    edgePicking: false,
    vertexPicking: false,
  };
  private bodyStyles: {
    selected: Set<string>;
    highlighted: Set<string>;
    errored: Set<string>;
  } = { selected: new Set(), highlighted: new Set(), errored: new Set() };
  private hoveredBodyId: string | null = null;
  private hoveredFaceKey: string | null = null;
  private hoverFrame = 0;
  private hoverPoint: { x: number; y: number } | null = null;
  /** The geometry reported to the interface last, so the pointer can be quiet. */
  private geometryHover: { key: string; x: number; y: number } | null = null;
  private sketchOverlay: THREE.Group | null = null;
  private sketchLineMaterials: LineMaterial[] = [];
  private readonly pointTexture = createCircleTexture();
  private sketchOverlayState: {
    preview: SketchEntity | null;
    draftPoints: Point2[];
    highlight: boolean;
    marker: Point2 | null;
  } = { preview: null, draftPoints: [], highlight: false, marker: null };

  private animationFrame = 0;
  private needsRender = true;
  private disposed = false;

  private target = new THREE.Vector3(0, 0, 0);
  private distance = DEFAULT_CAMERA_DISTANCE;
  /** Tilt of the horizon about the view direction; zero for a turntable. */
  private roll = 0;
  /**
   * Point a drag turns the view around. It is the geometry under the pointer, or
   * the point of the pointer's ray at the depth of the target, and it stays on
   * its pixel while the model swings around it. Null keeps the plain turntable.
   */
  private orbitPivot: THREE.Vector3 | null = null;
  /** Fingers on the view, in client pixels, by pointer id. */
  private readonly fingers = new Map<number, { x: number; y: number }>();
  /** Centre and spread of the two-finger gesture, as they were one frame ago. */
  private pinch: { centre: { x: number; y: number }; spread: number } | null = null;
  /** A second finger joined, so what is left of the gesture only pans and pinches. */
  private multiTouch = false;
  private azimuth = DEFAULT_CAMERA_AZIMUTH;
  private polar = DEFAULT_CAMERA_POLAR;
  private theme: Theme = 'dark';
  private edgeColor = 0x0d1015;
  private width = 1;
  private height = 1;

  private dragMode: 'orbit' | 'pan' | 'handle' | null = null;
  private lastX = 0;
  private lastY = 0;
  private pointerDown: { x: number; y: number } | null = null;
  private pointerMoved = false;
  /** Previous click, so a second one on the same spot reads as a double click. */
  private lastClick: { time: number; x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private transition: {
    from: CameraPose;
    to: CameraPose;
    azimuthDelta: number;
    rollDelta: number;
    startedAt: number;
    duration: number;
  } | null = null;
  /** Bodies and sketch opened by the current selection, used for detail picking. */
  private selectionDetail: {
    bodyIds: Set<string>;
    sketchId: string | null;
    /** A face or edge is selected, so every body is hovered as its geometry. */
    geometrySelected: boolean;
  } = {
    bodyIds: new Set(),
    sketchId: null,
    geometrySelected: false,
  };
  private readonly handleGroup = new THREE.Group();
  private handleData: SceneHandle[] = [];
  private handleEntries: Array<{
    handle: SceneHandle;
    /** Everything the handle drew; removed and disposed together. */
    objects: THREE.Object3D[];
    /** Materials that follow the hover colour. */
    colors: Array<{ color: THREE.Color }>;
    line?: Line2;
    material?: LineMaterial;
    /** Hairline drawn under the line so the arrow reads on a same-coloured body. */
    outlineMaterial?: LineMaterial;
  }> = [];
  private hoveredHandleId: string | null = null;
  private lastHandleHover: { x: number; y: number } | null = null;
  private edgeHighlights: string[] = [];
  private edgeHighlightEntries: Array<{ line: Line2; material: LineMaterial }> = [];
  /** Edge under the pointer while edges are being picked. */
  private hoveredEdgeKey: string | null = null;
  /** Curve of the opened sketch under the pointer. */
  private hoveredSketchEdge: { sketchId: string; entityId: string } | null = null;
  /** Sketch object under the pointer while no sketch is opened. */
  private hoveredSketchId: string | null = null;
  private edgeHoverEntries: Array<{ line: Line2; material: LineMaterial }> = [];
  private handleDrag: {
    id: string;
    /** Value when the pointer went down. */
    value: number;
    /** The grip moves in the view plane instead of sliding along an axis. */
    move: boolean;
    /** Angle handles turn with the pointer instead of sliding along an axis. */
    arc?: SceneArcHandle & { lastPointerAngle: number };
    /** The grip slides along this world-space trajectory, not along an axis. */
    trail?: readonly [number, number, number][];
    /** An orbit grip is read where the pointer points on its circle. */
    orbit?: boolean;
    lastValue: number;
    startX: number;
    startY: number;
    axisX: number;
    axisY: number;
    /** Screen pixels per millimetre along the handle axis. */
    pixelsPerMm: number;
    pointerId: number;
  } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    private readonly onPick?: (pick: ScenePick | null, additive: boolean) => void,
    /** Object under the right click: a body, a mesh or a sketch. */
    private readonly onObjectContextMenu?: (
      object: { kind: 'body' | 'mesh' | 'sketch'; id: string } | null,
      x: number,
      y: number,
    ) => void,
    private readonly onCameraChange?: (azimuth: number, polar: number, distance: number) => void,
    /** A double click on a face asks for the operation that produced it. */
    private readonly onDoublePick?: (pick: ScenePick) => void,
    private readonly callbacks: {
      /** Normal selection: object first, then the face or edge inside it. */
      onSelectPick?: (hit: SelectionHit | null, additive: boolean) => void;
      /** Lifecycle of a 3D handle drag. */
      onHandleDrag?: (event: {
        id: string;
        value: number;
        phase: 'start' | 'move' | 'end' | 'cancel';
        x: number;
        y: number;
        /** Shift is the second kind of an edge treatment while the grab lasts. */
        shift: boolean;
        /** World-space movement of a move grip since the grab started. */
        move?: [number, number, number];
      }) => void;
      /** Handle under the pointer, or null when it leaves the handle. */
      onHandleHover?: (
        event: {
          id: string;
          x: number;
          y: number;
          text: string;
        } | null,
      ) => void;
      /**
       * Geometry under the pointer, as the pick a click would take. Hovering a
       * face tells which operation made it, which is what the timeline lights
       * up and what the geometry tooltip names.
       */
      onGeometryHover?: (event: { pick: ScenePick; x: number; y: number } | null) => void;
    } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      stencil: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = true;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    this.camera.up.set(0, 0, 1);

    const addLights = (scene: THREE.Scene) => {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2f3a, 1.7));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(1, -1.5, 2);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0x99aaff, 0.5);
      fillLight.position.set(-1, 1, 0.5);
      scene.add(fillLight);
    };
    addLights(this.scene);
    addLights(this.overlayScene);

    this.grid = this.createGrid();
    this.scene.add(this.grid);
    this.axes = this.createAxes();
    this.scene.add(this.axes);
    // Transparent annotations render after the section caps, so hatching never
    // hides a delta, a sketch face or a face tint.
    this.ghostGroup.renderOrder = RenderOrder.delta;
    this.overlayScene.add(this.ghostGroup);
    this.faceOverlayGroup.renderOrder = RenderOrder.faceOverlayGroup;
    this.overlayScene.add(this.faceOverlayGroup);
    this.treatmentMarkGroup.renderOrder = RenderOrder.delta;
    this.overlayScene.add(this.treatmentMarkGroup);
    this.handleGroup.renderOrder = RenderOrder.handle;
    this.overlayScene.add(this.handleGroup);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.updateCamera();
    this.animate();
  }

  setBodies(
    bodies: SceneBody[],
    selectedBodyIds: readonly string[],
    highlightedBodyIds: readonly string[] = [],
    errorBodyIds: readonly string[] = [],
  ): void {
    const seen = new Set<string>();
    this.bodyStyles = {
      selected: new Set(selectedBodyIds),
      highlighted: new Set(highlightedBodyIds),
      errored: new Set(errorBodyIds),
    };
    let sectionChanged = false;

    for (const [index, body] of bodies.entries()) {
      seen.add(body.id);
      const existing = this.bodies.get(body.id);
      if (existing && existing.meshRef !== body.mesh) {
        this.removeEntry(body.id);
        sectionChanged = true;
      }

      let entry = this.bodies.get(body.id);
      if (!entry) {
        entry = this.createEntry(body);
        this.bodies.set(body.id, entry);
        this.scene.add(entry.group);
        sectionChanged = true;
      }

      this.syncHitMesh(entry, body);
      if (entry.group.visible !== body.visible) sectionChanged = true;
      // The cap keeps its own copy of the body colour.
      if (entry.color !== body.color) sectionChanged = true;
      entry.group.visible = body.visible;
      entry.kind = body.kind;
      entry.color = body.color;
      // A shared surface goes to the object listed lower in the tree.
      entry.depthBias = solidDepthBias(body.order ?? index, bodies.length);
      entry.ghost = body.ghost ?? null;
      entry.translucent = body.translucent !== false;
      entry.interactive = body.interactive !== false;
    }

    for (const id of [...this.bodies.keys()]) {
      if (!seen.has(id)) {
        this.removeEntry(id);
        sectionChanged = true;
      }
    }

    this.applyBodyMaterials();
    this.applyClipping();
    if (sectionChanged && this.sectionPlanes.length > 0) this.rebuildSection();
    this.applyFaceHighlights();
    this.invalidate();
  }

  /**
   * Tells the picker which bodies are opened for detail selection and which
   * sketch the user has selected, so its regions become clickable.
   */
  setSelectionDetail(detail: {
    bodyIds: readonly string[];
    sketchId?: string | null;
    geometrySelected?: boolean;
  }): void {
    this.selectionDetail = {
      bodyIds: new Set(detail.bodyIds),
      sketchId: detail.sketchId ?? null,
      geometrySelected: Boolean(detail.geometrySelected),
    };
  }

  setHandles(handles: readonly SceneHandle[]): void {
    this.handleData = handles.map((handle) => ({ ...handle }));
    if (
      this.hoveredHandleId &&
      !this.handleData.some((handle) => handle.id === this.hoveredHandleId)
    ) {
      this.hoveredHandleId = null;
      this.canvas.style.cursor = '';
    }
    this.updateHandles();
    this.invalidate();
  }

  getGhosts(): SceneGhostInfo[] {
    // A repeated ghost is one tessellation at many placements, so the bounds
    // are read from where it is drawn, not from the volume itself.
    return this.ghostSources.map((ghost) => {
      const box = this.ghostEntries.get(ghost.id)?.box;
      if (!box) return { id: ghost.id, color: ghost.color, bbox: ghost.mesh.bbox };
      return {
        id: ghost.id,
        color: ghost.color,
        bbox: {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
        },
      };
    });
  }

  getHandles(): SceneHandleScreen[] {
    const rect = this.canvas.getBoundingClientRect();
    return this.handleData.map((handle) => {
      const geometry = this.handleScreenGeometry(handle);
      if (!geometry) {
        return {
          id: handle.id,
          originX: 0,
          originY: 0,
          tipX: 0,
          tipY: 0,
          value: handle.value,
          enabled: false,
          ...(handle.kind ? { kind: handle.kind } : {}),
        };
      }
      return {
        id: handle.id,
        originX: geometry.origin.x + rect.left,
        originY: geometry.origin.y + rect.top,
        tipX: geometry.tip.x + rect.left,
        tipY: geometry.tip.y + rect.top,
        value: handle.value,
        enabled: handle.enabled,
        ...(handle.kind ? { kind: handle.kind } : {}),
      };
    });
  }

  /** Handles are blue; selection stays purple. */
  private handleColor(): number {
    return this.theme === 'dark' ? 0x3b82f6 : 0x2563eb;
  }

  /** Translation arrows follow the usual X/Y/Z colours. */
  private handleColorFor(handle: SceneHandle): number {
    if (!handle.axis) return this.handleColor();
    switch (handle.axis) {
      case 'x':
        return this.theme === 'dark' ? 0xf06a6a : 0xd64545;
      case 'y':
        return this.theme === 'dark' ? 0x6ccf78 : 0x2f9e44;
      case 'z':
        return this.theme === 'dark' ? 0x64a0f8 : 0x2f6fd0;
    }
  }

  /** The space behind the model: a hairline of it keeps handles readable. */
  private handleOutlineColor(): number {
    return this.theme === 'dark' ? 0x0c0e12 : 0xffffff;
  }

  /** Projected arrow of a handle, using the same length the user sees. */
  private handleScreenGeometry(
    handle: SceneHandle,
  ): { origin: { x: number; y: number }; tip: { x: number; y: number } } | null {
    const arc = handle.arc ?? handle.orbit;
    if (arc) {
      const grip = arcGripPoint(arc, arc.angle);
      const next = arcGripPoint(arc, arc.angle + 0.05);
      return {
        origin: this.projectWorld(grip),
        tip: this.projectWorld(next),
      };
    }
    const origin = new THREE.Vector3(...handle.origin);
    const trail = handle.trail;
    if (trail && trail.length >= 2) {
      // A grip on a trajectory sits where the trajectory is at its value.
      const grip = pointOnTrail(trail, Math.abs(handle.value));
      return { origin: this.projectWorld(origin), tip: this.projectWorld(grip) };
    }
    if (handle.kind === 'move') {
      const projected = this.projectWorld(origin);
      return {
        origin: { x: projected.x, y: projected.y },
        tip: { x: projected.x, y: projected.y },
      };
    }
    const direction = new THREE.Vector3(...handle.direction);
    if (direction.lengthSq() < 1e-12) return null;
    direction.normalize();
    const arrowDirection = handle.value < 0 ? direction.clone().negate() : direction;
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const minimum = 18 * worldPerPixel;
    const length =
      handle.fixedLengthPx !== undefined
        ? handle.fixedLengthPx * worldPerPixel
        : handle.value === 0
          ? HANDLE_IDLE_PX * worldPerPixel
          : Math.max(Math.abs(handle.value) - (handle.endGapPx ?? 0) * worldPerPixel, minimum);
    const tip = origin.clone().addScaledVector(arrowDirection, length);
    const projectedOrigin = this.projectWorld(origin);
    const projectedTip = this.projectWorld(tip);
    return {
      origin: { x: projectedOrigin.x, y: projectedOrigin.y },
      tip: { x: projectedTip.x, y: projectedTip.y },
    };
  }

  private updateHandles(): void {
    this.clearHandleGroup();
    if (this.handleData.length === 0) return;
    for (const handle of this.handleData) {
      if (handle.orbit) {
        this.addOrbitHandle(handle);
        continue;
      }
      if (handle.arc) {
        this.addArcHandle(handle);
        continue;
      }
      if (handle.kind === 'move') {
        this.addMoveHandle(handle);
        continue;
      }
      if (handle.kind === 'ball') {
        this.addBallHandle(handle);
        continue;
      }
      if (!this.handleScreenGeometry(handle)) continue;
      this.addArrowHandle(handle);
    }
  }

  /**
   * A grip that travels along a dashed line and stops at whole steps, such as
   * the number of copies of an array: the line is a guide, the ball is the grip.
   */
  private addBallHandle(handle: SceneHandle): void {
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const origin = new THREE.Vector3(...handle.origin);
    const direction = new THREE.Vector3(...handle.direction).normalize();
    const arrowDirection = handle.value < 0 ? direction.clone().negate() : direction;
    const length =
      handle.fixedLengthPx !== undefined
        ? handle.fixedLengthPx * worldPerPixel
        : handle.value === 0
          ? HANDLE_IDLE_PX * worldPerPixel
          : Math.max(Math.abs(handle.value), 18 * worldPerPixel);
    const trail = handle.trail;
    const onTrail = trail && trail.length >= 2;
    // A grip that slides along a trajectory sits on it, and the guide is the
    // trajectory itself, so the whole route the drag follows is visible.
    const tip = onTrail
      ? pointOnTrail(trail, Math.abs(handle.value))
      : origin.clone().addScaledVector(arrowDirection, length);
    const hovered = this.hoveredHandleId === handle.id;
    const color = hovered ? 0xffffff : this.handleColor();
    const outlineColor = this.handleOutlineColor();
    const radius = Math.max(0.001, 4.5 * (handle.thickness ?? 1) * worldPerPixel);

    const guideGeometry = new THREE.BufferGeometry().setFromPoints(
      onTrail ? trail.map(([x, y, z]) => new THREE.Vector3(x, y, z)) : [origin, tip],
    );
    const guideMaterial = new THREE.LineDashedMaterial({
      color,
      dashSize: 5 * worldPerPixel,
      gapSize: 4 * worldPerPixel,
      transparent: true,
      opacity: 0.65,
      depthTest: false,
      depthWrite: false,
    });
    const guide = new THREE.Line(guideGeometry, guideMaterial);
    guide.computeLineDistances();
    guide.renderOrder = RenderOrder.handleOutline;
    guide.userData.handleId = handle.id;

    const ballMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), ballMaterial);
    ball.position.copy(tip);
    ball.renderOrder = RenderOrder.handle;
    ball.userData.handleId = handle.id;

    const outlineBall = new THREE.Mesh(
      new THREE.SphereGeometry(radius + worldPerPixel, 16, 12),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    outlineBall.position.copy(tip);
    outlineBall.renderOrder = RenderOrder.handleOutline;
    outlineBall.userData.handleId = handle.id;

    this.handleGroup.add(guide, outlineBall, ball);
    this.handleEntries.push({
      handle,
      objects: [guide, outlineBall, ball],
      colors: [guideMaterial, ballMaterial],
    });
  }

  private addArrowHandle(handle: SceneHandle): void {
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const origin = new THREE.Vector3(...handle.origin);
    const direction = new THREE.Vector3(...handle.direction).normalize();
    const arrowDirection = handle.value < 0 ? direction.clone().negate() : direction;
    const length =
      handle.fixedLengthPx !== undefined
        ? handle.fixedLengthPx * worldPerPixel
        : handle.value === 0
          ? HANDLE_IDLE_PX * worldPerPixel
          : Math.max(
              Math.abs(handle.value) - (handle.endGapPx ?? 0) * worldPerPixel,
              18 * worldPerPixel,
            );
    const tip = origin.clone().addScaledVector(arrowDirection, length);
    const coneHeight = Math.min(12 * worldPerPixel, length * 0.7);
    const base = tip.clone().addScaledVector(arrowDirection, -coneHeight);
    const hovered = this.hoveredHandleId === handle.id;
    const color = hovered ? 0xffffff : this.handleColorFor(handle);
    const thickness = handle.thickness ?? 1;
    // The body under a handle can be the same blue, so the whole arrow is drawn
    // a pixel wider in the colour of the space behind it.
    const outlineColor = this.handleOutlineColor();
    const halo = worldPerPixel;
    const dashed = handle.shaft === 'dashed';

    const makeLine = (colorValue: number, linewidth: number, renderOrder: number) => {
      const geometry = new LineGeometry();
      geometry.setPositions([origin.x, origin.y, origin.z, base.x, base.y, base.z]);
      const lineMaterial = new LineMaterial({
        color: colorValue,
        linewidth,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        resolution: new THREE.Vector2(this.width, this.height),
      });
      const line = new Line2(geometry, lineMaterial);
      line.renderOrder = renderOrder;
      line.userData.handleId = handle.id;
      return line;
    };

    const linewidth = (hovered ? 3.2 : 2.3) * thickness;
    const outline = dashed
      ? null
      : makeLine(outlineColor, linewidth + 2, RenderOrder.handleOutline);
    const line = dashed ? null : makeLine(color, linewidth, RenderOrder.handle);
    const material = line ? (line.material as LineMaterial) : undefined;

    // A size handle is only its arrowhead: the shaft is a muted dashed
    // dimension line that never reacts to the pointer.
    let dashedLine: THREE.Line | null = null;
    if (dashed) {
      const geometry = new THREE.BufferGeometry().setFromPoints([origin, base]);
      const dashedMaterial = new THREE.LineDashedMaterial({
        color,
        dashSize: 5 * worldPerPixel,
        gapSize: 4 * worldPerPixel,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
        depthWrite: false,
      });
      dashedLine = new THREE.Line(geometry, dashedMaterial);
      dashedLine.computeLineDistances();
      dashedLine.renderOrder = RenderOrder.handleOutline;
      dashedLine.userData.handleId = handle.id;
    }

    const coneMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(
        Math.max(0.001, 4.5 * thickness * worldPerPixel),
        Math.max(0.001, coneHeight),
        16,
      ),
      coneMaterial,
    );
    cone.position.copy(tip).addScaledVector(arrowDirection, -coneHeight / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDirection);
    cone.renderOrder = RenderOrder.handle;
    cone.userData.handleId = handle.id;

    // The outline cone grows by a pixel on each side around the same centre,
    // which keeps the tip one pixel past the arrow tip.
    const outlineCone = new THREE.Mesh(
      new THREE.ConeGeometry(
        Math.max(0.001, 4.5 * thickness * worldPerPixel + halo),
        Math.max(0.001, coneHeight + 2 * halo),
        16,
      ),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    outlineCone.position.copy(cone.position);
    outlineCone.quaternion.copy(cone.quaternion);
    outlineCone.renderOrder = RenderOrder.handleOutline;
    outlineCone.userData.handleId = handle.id;

    const anchorMaterial = dashed
      ? null
      : new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
          depthWrite: false,
          transparent: true,
        });
    const anchorRadius = Math.max(0.001, 3.4 * thickness * worldPerPixel);
    const anchor =
      anchorMaterial &&
      new THREE.Mesh(new THREE.SphereGeometry(anchorRadius, 14, 10), anchorMaterial);
    if (anchor) {
      anchor.position.copy(origin);
      anchor.renderOrder = RenderOrder.handle;
      anchor.userData.handleId = handle.id;
    }

    const outlineAnchor = dashed
      ? null
      : new THREE.Mesh(
          new THREE.SphereGeometry(anchorRadius + halo, 14, 10),
          new THREE.MeshBasicMaterial({
            color: outlineColor,
            depthTest: false,
            depthWrite: false,
            transparent: true,
          }),
        );
    if (outlineAnchor) {
      outlineAnchor.position.copy(origin);
      outlineAnchor.renderOrder = RenderOrder.handleOutline;
      outlineAnchor.userData.handleId = handle.id;
    }

    const objects: THREE.Object3D[] = [outlineCone, cone];
    if (outline) objects.push(outline);
    if (line) objects.push(line);
    if (dashedLine) objects.push(dashedLine);
    if (outlineAnchor) objects.push(outlineAnchor);
    if (anchor) objects.push(anchor);
    this.handleGroup.add(...objects);

    const colors: Array<{ color: THREE.Color }> = [coneMaterial];
    if (anchorMaterial) colors.push(anchorMaterial);
    if (material) colors.push(material);
    this.handleEntries.push({
      handle,
      objects,
      colors,
      ...(line ? { line, material } : {}),
      ...(outline ? { outlineMaterial: outline.material as LineMaterial } : {}),
    });
  }

  /**
   * The centre of a translation gizmo: a screen-sized circle that moves the
   * object in the plane facing the camera.
   */
  private addMoveHandle(handle: SceneHandle): void {
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const origin = new THREE.Vector3(...handle.origin);
    const hovered = this.hoveredHandleId === handle.id;
    const color = hovered ? 0xffffff : this.handleColorFor(handle);
    const outlineColor = this.handleOutlineColor();
    const halo = worldPerPixel;
    const outer = Math.max(0.001, 6.5 * worldPerPixel);
    const inner = Math.max(0.001, 3.4 * worldPerPixel);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.001, inner - halo), Math.max(0.001, outer + halo), 28),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.copy(origin);
    ring.quaternion.copy(this.camera.quaternion);
    ring.renderOrder = RenderOrder.handleOutline;
    ring.userData.handleId = handle.id;

    const ringMain = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 28), ringMaterial);
    ringMain.position.copy(origin);
    ringMain.quaternion.copy(this.camera.quaternion);
    ringMain.renderOrder = RenderOrder.handle;
    ringMain.userData.handleId = handle.id;

    const dotMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(0.001, 1.7 * worldPerPixel), 20),
      dotMaterial,
    );
    dot.position.copy(origin);
    dot.quaternion.copy(this.camera.quaternion);
    dot.renderOrder = RenderOrder.handle;
    dot.userData.handleId = handle.id;

    const dotOutline = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(0.001, 2.7 * worldPerPixel), 20),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    dotOutline.position.copy(origin);
    dotOutline.quaternion.copy(this.camera.quaternion);
    dotOutline.renderOrder = RenderOrder.handleOutline;
    dotOutline.userData.handleId = handle.id;

    this.handleGroup.add(ring, ringMain, dotOutline, dot);
    this.handleEntries.push({
      handle,
      objects: [ring, ringMain, dotOutline, dot],
      colors: [ringMaterial, dotMaterial],
    });
  }

  /**
   * A radial orbit handle: a dashed line from the centre to a circular grip.
   * Only the grip is interactive; it slides along the circle it sits on.
   */
  private addOrbitHandle(handle: SceneHandle): void {
    const arc = handle.orbit;
    if (!arc) return;
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const center = new THREE.Vector3(...arc.center);
    const grip = arcGripPoint(arc, arc.angle);
    const hovered = this.hoveredHandleId === handle.id;
    const color = hovered ? 0xffffff : this.handleColorFor(handle);
    const outlineColor = this.handleOutlineColor();
    const halo = worldPerPixel;

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([center, grip]);
    const lineMaterial = new THREE.LineDashedMaterial({
      color: this.handleColorFor(handle),
      dashSize: 5 * worldPerPixel,
      gapSize: 4 * worldPerPixel,
      transparent: true,
      opacity: 0.65,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances();
    line.renderOrder = RenderOrder.handleOutline;
    line.userData.handleId = handle.id;

    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const outer = Math.max(0.001, 5.4 * worldPerPixel);
    const inner = Math.max(0.001, 3 * worldPerPixel);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.001, inner - halo), Math.max(0.001, outer + halo), 24),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.copy(grip);
    ring.quaternion.copy(this.camera.quaternion);
    ring.renderOrder = RenderOrder.handleOutline;
    ring.userData.handleId = handle.id;

    const ringMain = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 24), ringMaterial);
    ringMain.position.copy(grip);
    ringMain.quaternion.copy(this.camera.quaternion);
    ringMain.renderOrder = RenderOrder.handle;
    ringMain.userData.handleId = handle.id;

    const dotMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(0.001, 1.4 * worldPerPixel), 18),
      dotMaterial,
    );
    dot.position.copy(grip);
    dot.quaternion.copy(this.camera.quaternion);
    dot.renderOrder = RenderOrder.handle;
    dot.userData.handleId = handle.id;

    const dotOutline = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(0.001, 2.2 * worldPerPixel), 18),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    dotOutline.position.copy(grip);
    dotOutline.quaternion.copy(this.camera.quaternion);
    dotOutline.renderOrder = RenderOrder.handleOutline;
    dotOutline.userData.handleId = handle.id;

    this.handleGroup.add(line, ring, ringMain, dotOutline, dot);
    this.handleEntries.push({
      handle,
      objects: [line, ring, ringMain, dotOutline, dot],
      colors: [ringMaterial, dotMaterial],
    });
  }

  /**
   * An angle handle: the arc from the zero angle to an arrowhead, so dragging it
   * reads as turning the arc. The arc is drawn a pixel wider in the colour of
   * the space behind it, so it stays readable on a body of the same blue.
   */
  private addArcHandle(handle: SceneHandle): void {
    const arc = handle.arc;
    if (!arc) return;
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const hovered = this.hoveredHandleId === handle.id;
    const color = hovered ? 0xffffff : this.handleColor();
    const outlineColor = this.handleOutlineColor();
    const halo = worldPerPixel;
    const linewidth = (hovered ? 3.2 : 2.3) * (handle.thickness ?? 1);

    const steps = Math.max(2, Math.ceil(Math.abs(arc.angle) / (Math.PI / 36)));
    const positions: number[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const point = arcGripPoint(arc, (arc.angle * index) / steps);
      positions.push(point.x, point.y, point.z);
    }
    const grip = arcGripPoint(arc, arc.angle);

    const makeArc = (colorValue: number, width: number, order: number) => {
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const material = new LineMaterial({
        color: colorValue,
        linewidth: width,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        resolution: new THREE.Vector2(this.width, this.height),
      });
      const line = new Line2(geometry, material);
      line.renderOrder = order;
      line.userData.handleId = handle.id;
      return line;
    };

    // The whole circle the direction turns along, dashed like the guide of a
    // path: the arrow shows the span the copies take out of it.
    const ring: number[] = [];
    for (let index = 0; index <= 96; index += 1) {
      const point = arcGripPoint(arc, (Math.PI * 2 * index) / 96);
      ring.push(point.x, point.y, point.z);
    }
    const guideGeometry = new THREE.BufferGeometry().setFromPoints(
      Array.from(
        { length: ring.length / 3 },
        (_, index) =>
          new THREE.Vector3(ring[index * 3]!, ring[index * 3 + 1]!, ring[index * 3 + 2]!),
      ),
    );
    const guideMaterial = new THREE.LineDashedMaterial({
      color,
      dashSize: 5 * worldPerPixel,
      gapSize: 4 * worldPerPixel,
      transparent: true,
      opacity: 0.65,
      depthTest: false,
      depthWrite: false,
    });
    const guide = new THREE.Line(guideGeometry, guideMaterial);
    guide.computeLineDistances();
    guide.renderOrder = RenderOrder.handleOutline;
    guide.userData.handleId = handle.id;

    const outline = makeArc(outlineColor, linewidth + 2, RenderOrder.handleOutline);
    const line = makeArc(color, linewidth, RenderOrder.handle);
    const material = line.material as LineMaterial;

    // The arc ends in an arrowhead pointing the way the grip turns.
    const radial = grip.clone().sub(new THREE.Vector3(...arc.center));
    const axis = new THREE.Vector3(...arc.axis).normalize();
    const tangent = new THREE.Vector3().crossVectors(axis, radial);
    if (tangent.lengthSq() < 1e-12) tangent.copy(new THREE.Vector3(...arc.reference));
    tangent.normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    const tipHeight = Math.max(0.002, 7.5 * (handle.thickness ?? 1) * worldPerPixel);
    const tipRadius = Math.max(0.001, 3.2 * (handle.thickness ?? 1) * worldPerPixel);
    const dotMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const dot = new THREE.Mesh(new THREE.ConeGeometry(tipRadius, tipHeight, 16), dotMaterial);
    dot.position.copy(grip).addScaledVector(tangent, tipHeight / 2);
    dot.quaternion.copy(turn);
    dot.renderOrder = RenderOrder.handle;
    dot.userData.handleId = handle.id;

    const outlineDot = new THREE.Mesh(
      new THREE.ConeGeometry(tipRadius + halo, tipHeight + halo * 2, 16),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    outlineDot.position.copy(dot.position);
    outlineDot.quaternion.copy(turn);
    outlineDot.renderOrder = RenderOrder.handleOutline;
    outlineDot.userData.handleId = handle.id;

    this.handleGroup.add(guide, outline, line, outlineDot, dot);
    this.handleEntries.push({
      handle,
      objects: [guide, outline, line, outlineDot, dot],
      colors: [guideMaterial, material, dotMaterial],
      line,
      material,
      outlineMaterial: outline.material as LineMaterial,
    });
  }

  private clearHandleGroup(): void {
    for (const entry of this.handleEntries) {
      this.handleGroup.remove(...entry.objects);
      for (const object of entry.objects) {
        if (object instanceof Line2) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        } else if (object instanceof THREE.Line) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        } else if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      }
    }
    this.handleEntries = [];
  }

  private applyHandleStyles(): void {
    for (const entry of this.handleEntries) {
      const hovered = this.hoveredHandleId === entry.handle.id;
      const color = hovered ? 0xffffff : this.handleColorFor(entry.handle);
      for (const target of entry.colors) target.color.setHex(color);
      const linewidth = hovered ? 2.6 : 1.8;
      if (entry.material) entry.material.linewidth = linewidth;
      if (entry.outlineMaterial) entry.outlineMaterial.linewidth = linewidth + 2;
    }
  }

  /** World-space pointer displacement of a move grip since the grab started. */
  private moveDelta(
    drag: { startX: number; startY: number },
    event: PointerEvent,
  ): [number, number, number] {
    const worldPerPixel = (this.camera.top - this.camera.bottom) / Math.max(1, this.height);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const delta = right
      .multiplyScalar((event.clientX - drag.startX) * worldPerPixel)
      .add(up.multiplyScalar(-(event.clientY - drag.startY) * worldPerPixel));
    return [delta.x, delta.y, delta.z];
  }

  /** The move grip under the pointer, if any. */
  private handleMoveAt(local: { x: number; y: number }): {
    handle: SceneHandle;
    axisX: number;
    axisY: number;
    pixelsPerMm: number;
    distance: number;
  } | null {
    let best: {
      handle: SceneHandle;
      axisX: number;
      axisY: number;
      pixelsPerMm: number;
      distance: number;
    } | null = null;
    for (const handle of this.handleData) {
      if (!handle.enabled || handle.kind !== 'move') continue;
      const projected = this.projectWorld(new THREE.Vector3(...handle.origin));
      const distance = Math.hypot(local.x - projected.x, local.y - projected.y);
      if (distance > HANDLE_HIT_PX + 3) continue;
      if (best && distance >= best.distance) continue;
      best = { handle, axisX: 0, axisY: 0, pixelsPerMm: 1, distance };
    }
    return best;
  }

  /** The circular grip of a radial orbit handle under the pointer. */
  private handleOrbitAt(local: { x: number; y: number }): {
    handle: SceneHandle;
    axisX: number;
    axisY: number;
    pixelsPerMm: number;
    distance: number;
  } | null {
    let best: {
      handle: SceneHandle;
      axisX: number;
      axisY: number;
      pixelsPerMm: number;
      distance: number;
    } | null = null;
    for (const handle of this.handleData) {
      if (!handle.enabled || !handle.orbit) continue;
      const grip = arcGripPoint(handle.orbit, handle.orbit.angle);
      const projected = this.projectWorld(grip);
      const distance = Math.hypot(local.x - projected.x, local.y - projected.y);
      if (distance > HANDLE_HIT_PX + 4) continue;
      if (best && distance >= best.distance) continue;
      best = { handle, axisX: 0, axisY: 0, pixelsPerMm: 1, distance };
    }
    return best;
  }

  /** The angle handle whose grip or arc is under the pointer. */
  private handleArcAt(local: { x: number; y: number }): {
    handle: SceneHandle;
    axisX: number;
    axisY: number;
    pixelsPerMm: number;
    distance: number;
  } | null {
    let best: { handle: SceneHandle; distance: number; pixelsPerRadian: number } | null = null;
    for (const handle of this.handleData) {
      const arc = handle.arc;
      if (!handle.enabled || !arc) continue;
      const projected = this.handleScreenGeometry(handle);
      if (!projected) continue;
      const hitPx = HANDLE_HIT_PX * (handle.thickness ?? 1) + 2;
      let distance = Math.hypot(local.x - projected.origin.x, local.y - projected.origin.y);
      if (Math.abs(arc.angle) > 0.02) {
        const steps = Math.max(2, Math.ceil(Math.abs(arc.angle) / (Math.PI / 36)));
        let previous = this.projectWorld(arcGripPoint(arc, 0));
        for (let index = 1; index <= steps; index += 1) {
          const next = this.projectWorld(arcGripPoint(arc, (arc.angle * index) / steps));
          distance = Math.min(
            distance,
            pointSegmentDistance([local.x, local.y], [previous.x, previous.y], [next.x, next.y]),
          );
          previous = next;
        }
      }
      if (distance > hitPx) continue;
      const delta = 0.05;
      const unit = this.projectWorld(arcGripPoint(arc, arc.angle + delta));
      const reach = Math.hypot(unit.x - projected.origin.x, unit.y - projected.origin.y);
      if (reach < 1) continue;
      if (best && distance >= best.distance) continue;
      best = { handle, distance, pixelsPerRadian: reach / delta };
    }
    if (!best) return null;
    // A grip is dragged by the pointer angle around the axis, so the linear
    // axis of the arrow handles is only a fallback for the drag chip.
    return {
      handle: best.handle,
      axisX: 0,
      axisY: 0,
      pixelsPerMm: best.pixelsPerRadian,
      distance: best.distance,
    };
  }

  /**
   * How far along a trajectory the pointer is, in world units from its start.
   * The trajectory is projected to the screen and the pointer is taken to its
   * nearest point, which is what makes the grip follow a curve under the mouse.
   */
  private trailValueAt(
    trail: readonly [number, number, number][],
    clientX: number,
    clientY: number,
  ): number | null {
    const local = this.localPoint(clientX, clientY);
    const lengths = trailLengths(trail);
    let best: { distance: number; along: number } | null = null;
    let previousScreen = this.projectWorld(new THREE.Vector3(...trail[0]!));
    for (let index = 1; index < trail.length; index += 1) {
      const point = trail[index]!;
      const screen = this.projectWorld(new THREE.Vector3(point[0], point[1], point[2]));
      const a: Point2 = [previousScreen.x, previousScreen.y];
      const b: Point2 = [screen.x, screen.y];
      const closest = closestOnSegment([local.x, local.y], a, b);
      const span = (lengths[index] ?? 0) - (lengths[index - 1] ?? 0);
      const total = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t =
        total > 1e-6 ? Math.hypot(closest.point[0] - a[0], closest.point[1] - a[1]) / total : 0;
      const along = (lengths[index - 1] ?? 0) + span * t;
      if (!best || closest.distance < best.distance) best = { distance: closest.distance, along };
      previousScreen = screen;
    }
    return best ? best.along : null;
  }

  /** Angle of the pointer around a handle's axis, or null when it is edge-on. */
  private pointerAngleAt(arc: SceneArcHandle, clientX: number, clientY: number): number | null {
    const axis = new THREE.Vector3(...arc.axis).normalize();
    const raycaster = this.pointerToRay(clientX, clientY);
    const denominator = raycaster.ray.direction.dot(axis);
    if (Math.abs(denominator) < 1e-4) return null;
    const center = new THREE.Vector3(...arc.center);
    const distance = center.clone().sub(raycaster.ray.origin).dot(axis) / denominator;
    const point = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, distance);
    const offset = point.sub(center);
    const reference = new THREE.Vector3(...arc.reference).normalize();
    const tangent = new THREE.Vector3().crossVectors(axis, reference);
    return Math.atan2(offset.dot(tangent), offset.dot(reference));
  }

  private handleAt(
    clientX: number,
    clientY: number,
  ): {
    handle: SceneHandle;
    axisX: number;
    axisY: number;
    pixelsPerMm: number;
    distance: number;
  } | null {
    const local = this.localPoint(clientX, clientY);
    const moveHit = this.handleMoveAt(local);
    if (moveHit) return moveHit;
    const orbitHit = this.handleOrbitAt(local);
    if (orbitHit) return orbitHit;
    const arcHit = this.handleArcAt(local);
    if (arcHit) return arcHit;

    // A size handle is only its arrowhead: the dashed shaft is a dimension
    // line, not a grip, so it must not steal the pointer from the move arrows.
    let tipBest: {
      handle: SceneHandle;
      axisX: number;
      axisY: number;
      pixelsPerMm: number;
      distance: number;
      tipDistance: number;
    } | null = null;
    for (const handle of this.handleData) {
      if (!handle.enabled || !handle.tipOnly) continue;
      const projected = this.handleScreenGeometry(handle);
      if (!projected) continue;
      const direction = new THREE.Vector3(...handle.direction).normalize();
      const unit = this.projectWorld(new THREE.Vector3(...handle.origin).add(direction));
      const axisX = unit.x - projected.origin.x;
      const axisY = unit.y - projected.origin.y;
      const pixelsPerMm = Math.hypot(axisX, axisY);
      if (pixelsPerMm < 0.5) continue;
      const tipDistance = Math.hypot(local.x - projected.tip.x, local.y - projected.tip.y);
      const hitPx = HANDLE_HIT_PX * (handle.thickness ?? 1) + 4;
      if (tipDistance > hitPx) continue;
      if (tipBest && tipDistance >= tipBest.tipDistance) continue;
      tipBest = {
        handle,
        axisX: axisX / pixelsPerMm,
        axisY: axisY / pixelsPerMm,
        pixelsPerMm,
        distance: tipDistance,
        tipDistance,
      };
    }
    if (tipBest) return tipBest;

    let best: {
      handle: SceneHandle;
      axisX: number;
      axisY: number;
      pixelsPerMm: number;
      distance: number;
      tipDistance: number;
    } | null = null;
    for (const handle of this.handleData) {
      if (!handle.enabled || handle.tipOnly) continue;
      const projected = this.handleScreenGeometry(handle);
      if (!projected) continue;
      const direction = new THREE.Vector3(...handle.direction).normalize();
      const unit = this.projectWorld(new THREE.Vector3(...handle.origin).add(direction));
      // `direction` is the positive axis even when the arrow is drawn on the
      // opposite side, so dragging past zero keeps moving the same way.
      const axisX = unit.x - projected.origin.x;
      const axisY = unit.y - projected.origin.y;
      const pixelsPerMm = Math.hypot(axisX, axisY);
      if (pixelsPerMm < 0.5) continue;
      const distance = pointSegmentDistance(
        [local.x, local.y],
        [projected.origin.x, projected.origin.y],
        [projected.tip.x, projected.tip.y],
      );
      const tipDistance = Math.hypot(local.x - projected.tip.x, local.y - projected.tip.y);
      // A heavier arrow is easier to catch, so its band grows with it.
      const hitPx = HANDLE_HIT_PX * (handle.thickness ?? 1);
      if (distance > hitPx && tipDistance > hitPx + 3) continue;
      if (best) {
        // Opposite handles of one extrusion lie on the same line, so a point
        // can be on both shafts. The nearer tip then says which one is meant.
        const sameShaft = Math.abs(distance - best.distance) < 2;
        if (sameShaft ? tipDistance >= best.tipDistance : distance >= best.distance) continue;
      }
      best = {
        handle,
        axisX: axisX / pixelsPerMm,
        axisY: axisY / pixelsPerMm,
        pixelsPerMm,
        distance,
        tipDistance,
      };
    }
    return best;
  }

  private updateHandleHover(clientX: number, clientY: number): void {
    const hit = this.handleAt(clientX, clientY);
    const id = hit?.handle.id ?? null;
    const moved =
      !this.lastHandleHover ||
      Math.hypot(clientX - this.lastHandleHover.x, clientY - this.lastHandleHover.y) > 3;
    if (id === this.hoveredHandleId) {
      if (hit && moved) {
        this.lastHandleHover = { x: clientX, y: clientY };
        this.callbacks.onHandleHover?.({
          id: hit.handle.id,
          x: clientX,
          y: clientY,
          text: hit.handle.tooltip ?? '',
        });
      }
      return;
    }
    this.hoveredHandleId = id;
    this.lastHandleHover = null;
    this.canvas.style.cursor = id ? 'grab' : '';
    this.applyHandleStyles();
    this.invalidate();
    if (hit) {
      this.lastHandleHover = { x: clientX, y: clientY };
      this.callbacks.onHandleHover?.({
        id: hit.handle.id,
        x: clientX,
        y: clientY,
        text: hit.handle.tooltip ?? '',
      });
    } else {
      this.callbacks.onHandleHover?.(null);
    }
  }

  private startHandleDrag(
    hit: NonNullable<ReturnType<SceneController['handleAt']>>,
    event: PointerEvent,
  ): void {
    // An angle grip is dragged by the pointer angle; when the arc is edge-on
    // there is no angle to read, so the grab would jump.
    const arc = hit.handle.arc ?? hit.handle.orbit;
    const pointerAngle = arc ? this.pointerAngleAt(arc, event.clientX, event.clientY) : null;
    if (arc && pointerAngle === null) return;
    this.transition = null;
    this.dragMode = 'handle';
    this.pointerDown = null;
    this.pointerMoved = false;
    this.handleDrag = {
      id: hit.handle.id,
      value: hit.handle.value,
      lastValue: hit.handle.value,
      move: hit.handle.kind === 'move',
      ...(arc && pointerAngle !== null ? { arc: { ...arc, lastPointerAngle: pointerAngle } } : {}),
      startX: event.clientX,
      startY: event.clientY,
      axisX: hit.axisX,
      axisY: hit.axisY,
      pixelsPerMm: hit.pixelsPerMm,
      pointerId: event.pointerId,
      ...(hit.handle.trail ? { trail: hit.handle.trail } : {}),
      ...(hit.handle.orbit ? { orbit: true } : {}),
    };
    this.canvas.style.cursor = 'grabbing';
    this.callbacks.onHandleHover?.(null);
    this.canvas.setPointerCapture(event.pointerId);
    window.addEventListener('keydown', this.onHandleKeyDown, true);
    this.callbacks.onHandleDrag?.({
      id: hit.handle.id,
      value: hit.handle.value,
      phase: 'start',
      x: event.clientX,
      y: event.clientY,
      shift: event.shiftKey,
    });
  }

  private onHandleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.handleDrag) return;
    event.preventDefault();
    event.stopPropagation();
    this.finishHandleDrag(true, this.handleDrag.pointerId);
  };

  private finishHandleDrag(cancelled: boolean, pointerId: number): void {
    const drag = this.handleDrag;
    if (!drag) return;
    this.handleDrag = null;
    this.dragMode = null;
    window.removeEventListener('keydown', this.onHandleKeyDown, true);
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    this.canvas.style.cursor = this.hoveredHandleId ? 'grab' : '';
    this.callbacks.onHandleDrag?.({
      id: drag.id,
      value: drag.lastValue,
      phase: cancelled ? 'cancel' : 'end',
      x: 0,
      y: 0,
      shift: false,
    });
  }

  /** Thick accent lines over the edges the user picked. */
  setEdgeHighlights(keys: readonly string[]): void {
    this.edgeHighlights = [...keys];
    this.clearEdgeLines(this.edgeHighlightEntries);
    this.drawEdgeLines(
      this.edgeHighlightEntries,
      this.edgeHighlights,
      3.4,
      1,
      this.sketchSelectedColor(),
    );
    this.invalidate();
  }

  /** Draws accent lines over edges of the hit meshes; picks still land there. */
  private drawEdgeLines(
    into: Array<{ line: Line2; material: LineMaterial }>,
    keys: readonly string[],
    linewidth: number,
    opacity: number,
    color: number,
    depthTest = false,
    cameraBias = 0,
  ): void {
    // Lifting the line towards the viewer keeps it above the surface it lies
    // on while faces in front still hide it.
    const lift =
      cameraBias > 0
        ? this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-cameraBias)
        : null;
    for (const key of keys) {
      const separator = key.lastIndexOf('#');
      if (separator <= 0) continue;
      const bodyId = key.slice(0, separator);
      const edgeId = key.slice(separator + 1);
      const entry = this.bodies.get(bodyId);
      const edge = entry?.hitRef.edges?.find((candidate) => candidate.id === edgeId);
      if (!edge || edge.points.length < 6) continue;
      const geometry = new LineGeometry();
      const positions = [...edge.points];
      if (edge.closed) {
        positions.push(edge.points[0]!, edge.points[1]!, edge.points[2]!);
      }
      if (lift) {
        for (let index = 0; index < positions.length; index += 3) {
          positions[index] = positions[index]! + lift.x;
          positions[index + 1] = positions[index + 1]! + lift.y;
          positions[index + 2] = positions[index + 2]! + lift.z;
        }
      }
      geometry.setPositions(positions);
      const material = new LineMaterial({
        color,
        linewidth,
        transparent: true,
        opacity,
        depthTest,
        depthWrite: false,
        resolution: new THREE.Vector2(this.width, this.height),
      });
      const line = new Line2(geometry, material);
      line.renderOrder = RenderOrder.annotation;
      this.overlayScene.add(line);
      into.push({ line, material });
    }
  }

  private clearEdgeLines(entries: Array<{ line: Line2; material: LineMaterial }>): void {
    for (const entry of entries) {
      this.overlayScene.remove(entry.line);
      entry.line.geometry.dispose();
      entry.material.dispose();
    }
    entries.length = 0;
  }

  /**
   * The edge a click would take while edges are being picked. Without it the
   * thin lines of a body are hard to aim at. The hover is drawn depth-tested
   * and opaque: an edge lies over the faces only where it is not hidden.
   */
  private setHoveredEdge(key: string | null): void {
    if (key === this.hoveredEdgeKey) return;
    this.hoveredEdgeKey = key;
    this.drawHoveredEdge();
    this.invalidate();
  }

  /**
   * The hovered edge is lifted along the view direction: with a pure depth test
   * the screen-space line sinks into the surface it traces, and without one it
   * shows through the faces that hide it.
   */
  private drawHoveredEdge(): void {
    this.clearEdgeLines(this.edgeHoverEntries);
    if (!this.hoveredEdgeKey) return;
    this.drawEdgeLines(
      this.edgeHoverEntries,
      [this.hoveredEdgeKey],
      4.6,
      1,
      this.sketchHoverColor(),
      true,
      EDGE_HOVER_LIFT_PX / this.pixelsPerWorldUnit(),
    );
  }

  private applyBodyMaterials(): void {
    for (const entry of this.bodies.values()) {
      if (entry.ghost) {
        this.applyGhostBody(entry);
        continue;
      }
      this.applySolidMaterial(entry);
    }
    this.updateSectionColors();
  }

  /**
   * The colour a body currently reads as. Selection, hover and errors light a
   * body with an emissive tint, and the section cap has to follow it: the cut
   * is the same face seen through the hatch.
   */
  private bodyColorOf(entry: BodyEntry): THREE.Color {
    const color = entry.material.color.clone();
    if (entry.material.emissiveIntensity > 0) {
      color.add(entry.material.emissive.clone().multiplyScalar(entry.material.emissiveIntensity));
    }
    return color;
  }

  private sectionCapColors(entry: BodyEntry): { fill: THREE.Color; line: THREE.Color } {
    const background = new THREE.Color(this.theme === 'dark' ? 0x0d1015 : 0xffffff);
    const highlight = new THREE.Color(this.theme === 'dark' ? 0xffffff : 0x000000);
    const color = this.bodyColorOf(entry);
    return {
      fill: color.clone().lerp(background, 0.55),
      line: color.clone().lerp(highlight, this.theme === 'dark' ? 0.2 : 0.25),
    };
  }

  private updateSectionColors(): void {
    for (const entry of this.sectionEntries) {
      const body = this.bodies.get(entry.bodyId);
      if (!body) continue;
      const uniforms = (entry.cap.material as THREE.ShaderMaterial).uniforms as {
        uFill: { value: THREE.Color };
        uLine: { value: THREE.Color };
      };
      const colors = this.sectionCapColors(body);
      uniforms.uFill.value.copy(colors.fill);
      uniforms.uLine.value.copy(colors.line);
    }
  }

  // Objects an operation adds or changes are shown translucent; objects it
  // deletes stay visible in red until the operation is dismissed.
  private applyGhostBody(entry: BodyEntry): void {
    const removed = entry.ghost === 'removed';
    if (!removed && !entry.translucent) {
      // A cut keeps its result solid: the hole itself is the feedback.
      this.applySolidMaterial(entry);
      return;
    }
    entry.material.transparent = true;
    entry.material.depthTest = true;
    entry.material.depthWrite = false;
    entry.material.polygonOffset = true;
    entry.material.polygonOffsetFactor = -1;
    entry.material.polygonOffsetUnits = -1;
    entry.material.side = THREE.DoubleSide;
    entry.material.opacity = removed ? 0.45 : 0.38;
    entry.material.color.set(removed ? '#ef4444' : entry.color);
    entry.material.emissive.setHex(removed ? 0x5c1212 : 0x000000);
    entry.material.emissiveIntensity = removed ? 1 : 0;
    entry.mesh.renderOrder = RenderOrder.phantom;
    if (entry.edges) {
      entry.edges.visible = removed;
      entry.edges.renderOrder = removed ? RenderOrder.phantom : RenderOrder.bodyEdge;
      (entry.edges.material as THREE.LineBasicMaterial).depthTest = true;
      (entry.edges.material as THREE.LineBasicMaterial).color.setHex(
        removed ? 0xef4444 : this.edgeColor,
      );
    }
    if (entry.tangentEdges) entry.tangentEdges.visible = false;
  }

  private applySolidMaterial(entry: BodyEntry): void {
    const id = entry.mesh.userData.bodyId as string;
    entry.material.transparent = false;
    entry.material.depthTest = true;
    entry.material.depthWrite = true;
    // Two solids that meet on a surface compute the same depth there and fight
    // for it pixel by pixel. The body listed lower in the object tree gives up
    // nothing and the ones above it step back, so the seam belongs to the object
    // the user can point at in the panel.
    entry.material.polygonOffset = entry.depthBias > 0;
    entry.material.polygonOffsetFactor = entry.depthBias;
    entry.material.polygonOffsetUnits = entry.depthBias;
    entry.material.opacity = 1;
    entry.material.side = THREE.FrontSide;
    entry.material.color.set(entry.color);
    entry.mesh.renderOrder = RenderOrder.solid;
    if (entry.edges) {
      entry.edges.visible = true;
      entry.edges.renderOrder = RenderOrder.bodyEdge;
      (entry.edges.material as THREE.LineBasicMaterial).depthTest = true;
      (entry.edges.material as THREE.LineBasicMaterial).color.setHex(this.edgeColor);
    }
    if (entry.tangentEdges) {
      entry.tangentEdges.visible = true;
      entry.tangentEdges.renderOrder = RenderOrder.bodyEdge;
      (entry.tangentEdges.material as THREE.LineBasicMaterial).depthTest = true;
      (entry.tangentEdges.material as THREE.LineBasicMaterial).color.setHex(
        this.tangentEdgeColor(entry.color),
      );
    }
    const isError = this.bodyStyles.errored.has(id);
    const isSelected = !isError && this.bodyStyles.selected.has(id);
    const isHovered = !isError && !isSelected && this.hoveredBodyId === id;
    const isHighlighted =
      !isError && !isSelected && !isHovered && this.bodyStyles.highlighted.has(id);
    entry.material.emissive.setHex(
      isError ? 0x7a1a1a : isSelected || isHovered ? 0x2a4a8a : isHighlighted ? 0x24406e : 0x000000,
    );
    entry.material.emissiveIntensity = isError || isSelected || isHovered || isHighlighted ? 1 : 0;
  }

  /**
   * Faces the edited operation creates, coloured red where material was removed
   * and green where it was added. They are opaque: the colour is the message.
   */
  setTreatmentMarks(marks: readonly PreviewFaceMark[]): void {
    this.treatmentMarks = marks;
    this.rebuildTreatmentMarks();
  }

  private rebuildTreatmentMarks(): void {
    for (const { mesh, material } of this.treatmentMarkMeshes) {
      this.treatmentMarkGroup.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    }
    this.treatmentMarkMeshes.length = 0;
    for (const mark of this.treatmentMarks) {
      const entry = this.bodies.get(mark.bodyId);
      if (!entry || !entry.group.visible) continue;
      const faces: Array<{ ids: number[]; color: number }> = [
        { ids: mark.red, color: 0xef4444 },
        { ids: mark.green, color: 0x22c55e },
      ];
      for (const group of faces) {
        for (const faceId of group.ids) {
          // The faces belong to the result, which is what the scene draws.
          const geometry = faceGeometry(entry.meshRef, faceId);
          if (!geometry) continue;
          const pose = outwardNormal(entry.meshRef, faceId);
          if (pose) {
            geometry.translate(
              pose.normal[0] * FACE_OVERLAY_LIFT,
              pose.normal[1] * FACE_OVERLAY_LIFT,
              pose.normal[2] * FACE_OVERLAY_LIFT,
            );
          }
          // Lit like the model so a rounded surface still reads as curved.
          const material = new THREE.MeshStandardMaterial({
            color: group.color,
            roughness: 0.6,
            metalness: 0,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
            clippingPlanes: this.overlayClipPlanes(),
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = RenderOrder.delta;
          this.treatmentMarkGroup.add(mesh);
          this.treatmentMarkMeshes.push({ mesh, material });
        }
      }
    }
    this.invalidate();
  }

  setFaceHighlights(state: FaceHighlightState): void {
    this.faceHighlights = {
      selected: new Set(state.selected),
      invalid: new Set(state.invalid),
      picking: state.picking,
      bodyPicking: state.bodyPicking,
      bodyFacesOnly: Boolean(state.bodyFacesOnly),
      edgePicking: Boolean(state.edgePicking),
      vertexPicking: Boolean(state.vertexPicking),
      projecting: Boolean(state.projecting),
    };
    if (!state.picking) {
      this.hoveredFaceKey = null;
      this.setHoveredEdge(null);
    }
    if (!state.bodyPicking && this.hoveredBodyId !== null) {
      this.hoveredBodyId = null;
      this.applyBodyMaterials();
    }
    this.applyFaceHighlights();
    this.invalidate();
  }

  /** Volumes shown only for the operation preview, such as the shape a cut removes. */
  setGhosts(ghosts: readonly SceneGhost[]): void {
    if (this.ghostSources === ghosts) return;
    if (ghosts.length === 0 && this.ghostSources.length === 0) return;
    this.ghostSources = ghosts;

    // A repeated volume keeps its meshes between two evaluations: only the
    // placement changes, so a drag moves what is already on screen instead of
    // rebuilding it.
    const used = new Set<TessellationResult>();
    const kept = new Set<string>();
    for (const ghost of ghosts) {
      used.add(ghost.mesh);
      const look = ghostLook(ghost);
      const existing = this.ghostEntries.get(ghost.id);
      const entry =
        existing && existing.source === ghost.mesh && existing.look === look
          ? existing
          : this.createGhostEntry(ghost, look);
      if (entry !== existing) {
        // The same id can come back with a different volume: a primitive keeps
        // its ghost id while the handle resizes it. The entry it replaces has to
        // leave the group, or every size it passed stays drawn over the model
        // for the rest of the session, always on top and never in the way.
        if (existing) {
          this.ghostGroup.remove(existing.mesh);
          existing.material.dispose();
        }
        this.ghostEntries.set(ghost.id, entry);
      }
      this.placeGhost(entry, ghost.matrix);
      kept.add(ghost.id);
    }
    for (const [id, entry] of [...this.ghostEntries]) {
      if (kept.has(id)) continue;
      this.ghostGroup.remove(entry.mesh);
      entry.material.dispose();
      this.ghostEntries.delete(id);
    }
    for (const [source, geometry] of [...this.ghostGeometries]) {
      if (used.has(source)) continue;
      geometry.dispose();
      this.ghostGeometries.delete(source);
    }
    this.updateGhostFades();
    this.invalidate();
  }

  private createGhostEntry(
    ghost: SceneGhost,
    look: string,
  ): {
    mesh: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    geometry: THREE.BufferGeometry;
    box: THREE.Box3;
    source: TessellationResult;
    look: string;
  } {
    const geometry = this.ghostGeometry(ghost.mesh);
    const material = this.createGhostMaterial(ghost);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = RenderOrder.delta;
    this.ghostGroup.add(mesh);
    return {
      mesh,
      material,
      geometry,
      box: new THREE.Box3(),
      source: ghost.mesh,
      look,
    };
  }

  /** One geometry per volume: its copies share the tessellation. */
  private ghostGeometry(mesh: TessellationResult): THREE.BufferGeometry {
    const existing = this.ghostGeometries.get(mesh);
    if (existing) return existing;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.ghostGeometries.set(mesh, geometry);
    return geometry;
  }

  /** Puts a ghost where the operation drew it, and remembers the bounds there. */
  private placeGhost(
    entry: {
      mesh: THREE.Mesh;
      geometry: THREE.BufferGeometry;
      box: THREE.Box3;
    },
    matrix: readonly number[] | undefined,
  ): void {
    const local = entry.geometry.boundingBox ?? new THREE.Box3();
    if (matrix) {
      const placement = ghostPlacement(matrix);
      entry.mesh.matrixAutoUpdate = false;
      entry.mesh.matrix.copy(placement);
      entry.mesh.updateMatrixWorld(true);
      entry.box.copy(local).applyMatrix4(placement);
      return;
    }
    if (!entry.mesh.matrixAutoUpdate) {
      entry.mesh.matrixAutoUpdate = true;
      entry.mesh.matrix.identity();
      entry.mesh.updateMatrixWorld(true);
    }
    entry.box.copy(local);
  }

  private createGhostMaterial(ghost: SceneGhost): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ghost.color),
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: ghost.opacity ?? 0.4,
      depthWrite: false,
      // The delta is feedback for the operation, not part of the model: it stays
      // visible through the body it changes. Sketch lines draw in a later render
      // order, so they stay on top of it.
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const fade = ghost.fade ?? [];
    if (fade.length === 0) return material;

    // The ghost ends a short distance past the material, so the fade is capped
    // to what is left: a fade longer than the ghost would be cut off as a hard
    // edge instead of dissolving.
    const spanOf = (axis: readonly [number, number, number], start: number): number => {
      const positions = ghost.mesh.positions;
      let far = -Infinity;
      for (let index = 0; index < positions.length; index += 3) {
        const value =
          positions[index]! * axis[0] +
          positions[index + 1]! * axis[1] +
          positions[index + 2]! * axis[2];
        if (value > far) far = value;
      }
      return Number.isFinite(far) ? Math.max(1e-3, far - start) : 1e-3;
    };
    const uniforms = {
      uFade0: { value: new THREE.Vector4(...(fade[0]?.axis ?? [0, 0, 0]), fade[0]?.start ?? 0) },
      uFade1: { value: new THREE.Vector4(...(fade[1]?.axis ?? [0, 0, 0]), fade[1]?.start ?? 0) },
      uFade0Span: { value: fade[0] ? spanOf(fade[0].axis, fade[0].start) : 1 },
      uFade1Span: { value: fade[1] ? spanOf(fade[1].axis, fade[1].start) : 1 },
      uFadeCount: { value: fade.length },
      uFadeLength: { value: 1 },
    };
    material.userData.fadeUniforms = uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGhostPosition;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  vGhostPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          [
            '#include <common>',
            'uniform vec4 uFade0;',
            'uniform vec4 uFade1;',
            'uniform float uFade0Span;',
            'uniform float uFade1Span;',
            'uniform float uFadeCount;',
            'uniform float uFadeLength;',
            'varying vec3 vGhostPosition;',
          ].join('\n'),
        )
        .replace(
          '#include <opaque_fragment>',
          [
            '#include <opaque_fragment>',
            'float ghostFade = 1.0;',
            'float fadeLength0 = min(uFadeLength, uFade0Span);',
            'float fadeLength1 = min(uFadeLength, uFade1Span);',
            'if (uFadeCount > 0.5) ghostFade *= 1.0 - smoothstep(uFade0.w, uFade0.w + fadeLength0, dot(vGhostPosition, uFade0.xyz));',
            'if (uFadeCount > 1.5) ghostFade *= 1.0 - smoothstep(uFade1.w, uFade1.w + fadeLength1, dot(vGhostPosition, uFade1.xyz));',
            'gl_FragColor.a *= ghostFade;',
          ].join('\n'),
        );
    };
    material.customProgramCacheKey = () => 'ghost-fade';
    return material;
  }

  // The fade distance follows the zoom so the soft edge stays 100 screen pixels.
  private updateGhostFades(): void {
    if (this.ghostEntries.size === 0) return;
    const worldPerPixel = (this.camera.top - this.camera.bottom) / Math.max(1, this.height);
    const length = GHOST_FADE_PX * worldPerPixel;
    for (const entry of this.ghostEntries.values()) {
      const uniforms = entry.material.userData.fadeUniforms as
        { uFadeLength: { value: number } } | undefined;
      if (uniforms) uniforms.uFadeLength.value = length;
    }
  }

  setTheme(theme: Theme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.edgeColor = theme === 'dark' ? 0x0d1015 : 0x5f6876;

    for (const entry of this.bodies.values()) {
      if (entry.ghost === 'removed') continue;
      if (entry.edges) {
        (entry.edges.material as THREE.LineBasicMaterial).color.setHex(this.edgeColor);
      }
      if (entry.tangentEdges) {
        (entry.tangentEdges.material as THREE.LineBasicMaterial).color.setHex(
          this.tangentEdgeColor(entry.color),
        );
      }
    }

    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.grid = this.createGrid();
    this.scene.add(this.grid);
    this.scene.remove(this.axes);
    this.axes.geometry.dispose();
    (this.axes.material as THREE.Material).dispose();
    this.axes = this.createAxes();
    this.scene.add(this.axes);
    this.applyWorldAid();
    if (this.sectionPlanes.length > 0) this.rebuildSection();
    if (this.sketchData.length > 0) this.setSketches(this.sketchData);
    if (this.handleData.length > 0) this.updateHandles();
    this.invalidate();
  }

  /** Fits the model in view; `view` also aims the camera, in the same move. */
  fit(view?: ViewName): void {
    const angles = view ? viewAngles(view) : { azimuth: this.azimuth, polar: this.polar };
    const box = new THREE.Box3();
    let hasGeometry = false;

    for (const entry of this.bodies.values()) {
      entry.geometry.computeBoundingBox();
      const bounds = entry.geometry.boundingBox;
      if (bounds) {
        box.union(bounds);
        hasGeometry = true;
      }
    }

    if (!hasGeometry) {
      this.transitionTo({ target: new THREE.Vector3(0, 0, 0), distance: 200, ...angles });
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.001, size.length() / 2);
    this.transitionTo({
      target: center,
      distance: (radius * 1.35) / Math.tan((FOV_DEGREES * Math.PI) / 180 / 2),
      ...angles,
    });
  }

  setView(name: ViewName): void {
    this.transitionTo({
      target: this.target.clone(),
      distance: this.distance,
      ...viewAngles(name),
    });
  }

  getOrientation(): { azimuth: number; polar: number } {
    return { azimuth: this.azimuth, polar: this.polar };
  }

  setOrientation(azimuth: number, polar: number): void {
    this.transitionTo({
      target: this.target.clone(),
      distance: this.distance,
      azimuth,
      polar: clamp(polar, 0.001, Math.PI - 0.001),
    });
  }

  orbitBy(deltaX: number, deltaY: number): void {
    this.transition = null;
    // The nav cube speaks for the whole view, so it turns around the target the
    // camera already has. It also turns in a sketch: taking the view off the
    // plane is exactly what the cube is for there.
    this.orbitPivot = null;
    this.orbit(deltaX, deltaY);
  }

  /**
   * Whether the camera looks straight at the plane of the sketch being edited.
   * The frame of the active sketch is already in the scene, so the answer needs
   * no state of its own.
   */
  private facesSketchPlane(): boolean {
    const frame = this.sketchEntries.find((entry) => entry.active)?.frame;
    if (!frame) return false;
    return facesPlane(this.azimuth, this.polar, frame.normal);
  }

  /**
   * Turns the view by a pointer delta. With a pivot the eye and the target
   * rotate about it together, so the point under the pointer keeps its pixel
   * while the model swings around it. A turntable keeps the world up axis up; a
   * trackball turns the model in its own frame and lets the horizon tilt.
   */
  private orbit(
    deltaX: number,
    deltaY: number,
    pivot: THREE.Vector3 | null = this.orbitPivot,
    radiansPerPixel = ORBIT_RADIANS_PER_PIXEL,
  ): void {
    if (useUiStore.getState().orbitStyle === 'trackball') {
      const turn = trackballOrbit(
        { azimuth: this.azimuth, polar: this.polar, roll: this.roll },
        deltaX,
        deltaY,
        radiansPerPixel,
      );
      if (pivot) this.target.copy(orbitAbout(pivot, turn.rotation, this.target));
      this.azimuth = turn.state.azimuth;
      this.polar = turn.state.polar;
      this.roll = turn.state.roll;
      this.updateCamera();
      return;
    }
    const from = { azimuth: this.azimuth, polar: this.polar };
    const to = {
      azimuth: from.azimuth - deltaX * radiansPerPixel,
      polar: clamp(from.polar - deltaY * radiansPerPixel, 0.001, Math.PI - 0.001),
    };
    if (pivot) {
      this.target.copy(orbitAbout(pivot, orbitRotation(from, to), this.target));
    }
    this.azimuth = to.azimuth;
    this.polar = to.polar;
    this.roll = 0;
    this.updateCamera();
  }

  /**
   * The point a drag turns the view around: the surface under the pointer, or
   * the point of its ray at the depth the user is looking at when the ray hits
   * nothing at all.
   */
  private orbitPivotAt(clientX: number, clientY: number): THREE.Vector3 {
    const raycaster = this.pointerToRay(clientX, clientY);
    const bodyMeshes = [...this.bodies.values()]
      .filter((entry) => entry.group.visible && entry.interactive)
      .map((entry) => entry.hitMesh);
    const hit = firstUnclippedHit(
      raycaster.intersectObjects(bodyMeshes, false),
      this.sectionClipPlanes,
    );
    if (hit) return hit.point.clone();
    return pointOnRayAtTarget(raycaster.ray.origin, raycaster.ray.direction, this.target);
  }

  setSection(planes: SectionPlane[]): void {
    this.sectionPlanes = planes.filter((plane) => plane.visible);
    this.sectionClipPlanes = this.sectionPlanes.map((plane) => {
      const normal = new THREE.Vector3(...plane.normal).normalize();
      const point = new THREE.Vector3(...plane.origin).addScaledVector(normal, plane.offset);
      const clip = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
      clip.constant += SECTION_CLIP_BIAS;
      return clip;
    });
    this.applyClipping();
    this.rebuildSection();
    this.invalidate();
  }

  snapSketch(
    clientX: number,
    clientY: number,
    tolerancePx = 10,
    entities?: readonly SketchEntity[],
  ): SketchSnap | null {
    const active = this.sketchEntries.find((entry) => entry.active);
    if (!active) return null;
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const normal = new THREE.Vector3(...active.frame.normal);
    const origin = new THREE.Vector3(...active.frame.origin);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const world = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, world)) return null;
    const point = worldToSketchPoint(active.frame, [world.x, world.y, world.z]);
    const unitsPerPixel = (this.camera.top - this.camera.bottom) / Math.max(1, this.height);
    const limit = unitsPerPixel * tolerancePx;
    const sketchEntities = withFundamentalEntities(
      entities ?? this.sketchData.find((candidate) => candidate.id === active.id)?.entities ?? [],
    );

    let pointSnap: SketchSnap['pointSnap'] = null;
    let bestPoint = limit;
    for (const entity of sketchEntities) {
      // An axis has no ends to snap to; only its line is meaningful.
      if (isSketchAxisId(entity.id)) continue;
      this.sketchControlPoints(entity).forEach((candidate, index) => {
        const candidateDistance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
        if (candidateDistance <= bestPoint) {
          bestPoint = candidateDistance;
          pointSnap = { entityId: entity.id, pointIndex: index, point: candidate };
        }
      });
    }
    if (pointSnap) {
      return { point, pointSnap, curveSnap: null, midpointSnap: null };
    }

    let midpointSnap: SketchSnap['midpointSnap'] = null;
    let bestMidpoint = limit;
    for (const entity of sketchEntities) {
      if (entity.type !== 'line' || isSketchAxisId(entity.id)) continue;
      const midpoint: Point2 = [(entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2];
      const candidateDistance = Math.hypot(point[0] - midpoint[0], point[1] - midpoint[1]);
      if (candidateDistance <= bestMidpoint) {
        bestMidpoint = candidateDistance;
        midpointSnap = { entityId: entity.id, point: midpoint };
      }
    }
    if (midpointSnap) {
      return { point, pointSnap: null, curveSnap: null, midpointSnap };
    }

    let curveSnap: SketchSnap['curveSnap'] = null;
    let bestCurve = limit;
    for (const entity of sketchEntities) {
      if (
        entity.type !== 'line' &&
        entity.type !== 'circle' &&
        entity.type !== 'arc' &&
        entity.type !== 'ellipse'
      ) {
        continue;
      }
      const closest = this.closestPointOnEntity(entity, point);
      if (closest && closest.distance <= bestCurve) {
        bestCurve = closest.distance;
        curveSnap = { entityId: entity.id, type: entity.type, point: closest.point };
      }
    }
    return { point, pointSnap: null, curveSnap, midpointSnap: null };
  }

  private closestPointOnEntity(
    entity: SketchEntity,
    point: Point2,
  ): { point: Point2; distance: number } | null {
    if (entity.type === 'line') {
      return closestOnSegment(point, [entity.x1, entity.y1], [entity.x2, entity.y2]);
    }
    if (entity.type === 'point') return null;
    const curve = tessellateEntity(entity, 128);
    if (entity.type === 'circle' || entity.type === 'ellipse') {
      const first = curve[0];
      if (first) curve.push(first);
    }
    let best: { point: Point2; distance: number } | null = null;
    for (let index = 0; index < curve.length - 1; index += 1) {
      const closest = closestOnSegment(point, curve[index]!, curve[index + 1]!);
      if (!best || closest.distance < best.distance) best = closest;
    }
    return best;
  }

  projectSketchPoint(frame: SketchFrame, point: Point2): { x: number; y: number } | null {
    const world = this.sketchWorld(frame, point);
    const projected = world.project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.width,
      y: (-projected.y * 0.5 + 0.5) * this.height,
    };
  }

  private sketchColor(): number {
    return this.theme === 'dark' ? 0x8fb4ff : 0x2f5fc4;
  }

  private sketchPointColor(): number {
    return this.theme === 'dark' ? 0xffffff : 0x000000;
  }

  private sketchSelectedColor(): number {
    return selectionColor(this.theme);
  }

  private sketchConstructionColor(): number {
    return this.theme === 'dark' ? 0x7d8ea8 : 0x6d7a8d;
  }

  /** Accent of the geometry the magnet would snap to; shared with selection. */
  private sketchHighlightColor(): number {
    return selectionColor(this.theme);
  }

  private sketchHoverColor(): number {
    return hoverColor(this.theme);
  }

  private sketchFrozenLineColor(): number {
    return this.theme === 'dark' ? 0x3fbf73 : 0x2b8f57;
  }

  private sketchFrozenPointColor(): number {
    return this.theme === 'dark' ? 0x9af0b8 : 0x1d6b3e;
  }

  /** Projected geometry is violet; a lost link falls back to the orange snapshot. */
  private sketchProjectionColor(): number {
    return this.theme === 'dark' ? 0x8b5cf6 : 0x6d28d9;
  }

  private sketchLostProjectionColor(): number {
    return this.theme === 'dark' ? 0xf59e0b : 0xb45309;
  }

  /** Geometry of conflicting or redundant constraints warns without failing. */
  private sketchProblemColor(): number {
    return this.theme === 'dark' ? 0xf97316 : 0xc2410c;
  }

  /** A broken formula owns the colour of every line and point in the sketch. */
  private sketchErrorColor(): number {
    return this.theme === 'dark' ? 0xef4444 : 0xdc2626;
  }

  setSketches(sketches: SceneSketch[]): void {
    this.sketchData = sketches;
    // The groups are rebuilt below, so the hover has to be found again.
    this.hoveredSketchEdge = null;
    this.hoveredSketchId = null;
    this.disposeSketchEntries();
    const editingSketch = sketches.some((sketch) => sketch.active);
    // The sketch draws its own plane-aligned grid and its own axes; the world
    // ones would only duplicate it at a different orientation while editing.
    this.applyWorldAid();
    for (const sketch of sketches) {
      const group = new THREE.Group();
      group.renderOrder = RenderOrder.sketch;
      if (sketch.active) this.addSketchGrid(group, sketch.frame);
      const selected = new Set(sketch.selectionKeys.filter((key) => !key.includes('#')));
      const dimmed = new Set(sketch.dimmedEntityIds);
      const frozen = new Set(sketch.frozenEntityIds);
      const problem = new Set(sketch.problemEntityIds);
      const projected = new Set(sketch.projectedEntityIds);
      const lost = new Set(sketch.lostEntityIds);
      const highlighted = new Set(sketch.highlightIds.filter((key) => !key.includes('#')));
      const highlightedPoints = new Map<string, Set<number>>();
      for (const key of sketch.highlightIds) {
        const [entityId, index] = key.split('#');
        if (!entityId || index === undefined) continue;
        const set = highlightedPoints.get(entityId) ?? new Set<number>();
        set.add(Number(index));
        highlightedPoints.set(entityId, set);
      }
      const selectedPoints = new Map<string, Set<number>>();
      for (const key of sketch.selectionKeys) {
        const [entityId, index] = key.split('#');
        if (!entityId || index === undefined) continue;
        const set = selectedPoints.get(entityId) ?? new Set<number>();
        set.add(Number(index));
        selectedPoints.set(entityId, set);
      }
      const hovered = new Set(sketch.hoverIds.filter((key) => !key.includes('#')));
      const hoveredPoints = new Map<string, Set<number>>();
      for (const key of sketch.hoverIds) {
        const [entityId, index] = key.split('#');
        if (!entityId || index === undefined) continue;
        const set = hoveredPoints.get(entityId) ?? new Set<number>();
        set.add(Number(index));
        hoveredPoints.set(entityId, set);
      }
      // The origin and the axes are not part of the sketch, so they are drawn
      // with the grid instead of with the stored entities.
      if (sketch.active) {
        this.addSketchFundamentals(
          group,
          sketch.frame,
          sketch.selectionKeys,
          sketch.highlightIds,
          sketch.hoverIds,
        );
      }
      // Construction geometry is a modelling helper: it is only drawn when the
      // object asks for it, or while that sketch itself is being edited.
      const showConstruction = sketch.active || Boolean(sketch.showConstruction);
      const tint = sketch.color ? new THREE.Color(sketch.color).getHex() : null;
      for (const entity of sketch.entities) {
        if (entity.construction && !showConstruction) continue;
        this.addSketchEntity(
          group,
          entity,
          sketch.frame,
          selected.has(entity.id),
          selectedPoints.get(entity.id) ?? new Set<number>(),
          dimmed.has(entity.id),
          frozen.has(entity.id),
          problem.has(entity.id),
          projected.has(entity.id) && sketch.active,
          lost.has(entity.id) && sketch.active,
          highlighted.has(entity.id),
          highlightedPoints.get(entity.id) ?? new Set<number>(),
          hovered.has(entity.id),
          hoveredPoints.get(entity.id) ?? new Set<number>(),
          editingSketch && !sketch.active,
          sketch.error === true,
          sketch.active ? null : tint,
          sketch.onTop,
        );
      }
      this.addSketchFacePickers(group, sketch);
      this.overlayScene.add(group);
      this.sketchEntries.push({
        id: sketch.id,
        frame: sketch.frame,
        group,
        hitObjects: [],
        active: sketch.active,
      });
    }
    this.rebuildSketchOverlay();
    this.applyFaceHighlights();
    this.invalidate();
  }

  private applyFaceHighlights(): void {
    for (const [key, material] of this.sketchFaceMaterials) {
      const invalid = this.faceHighlights.invalid.has(key);
      const selected = this.faceHighlights.selected.has(key);
      const hovered = this.hoveredFaceKey === key;
      material.color.setHex(invalid ? 0xef4444 : this.sketchHighlightColor());
      const opacity = invalid
        ? 0.5
        : selected
          ? 0.45
          : hovered
            ? 0.3
            : this.faceHighlights.picking
              ? 0.12
              : 0;
      material.opacity = opacity;
      material.visible = opacity > 0;
    }

    for (const { mesh, material } of this.bodyFaceOverlays.values()) {
      this.faceOverlayGroup.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    }
    this.bodyFaceOverlays.clear();

    const keys = new Set<string>();
    for (const key of this.faceHighlights.selected) {
      if (key.startsWith('b:')) keys.add(key);
    }
    for (const key of this.faceHighlights.invalid) {
      if (key.startsWith('b:')) keys.add(key);
    }
    if (this.hoveredFaceKey?.startsWith('b:')) keys.add(this.hoveredFaceKey);

    for (const key of keys) {
      const [bodyId, faceId] = key.slice(2).split('#');
      if (!bodyId || faceId === undefined) continue;
      const entry = this.bodies.get(bodyId);
      if (!entry || !entry.group.visible) continue;
      // Picked faces belong to the input model, so they are drawn on its mesh.
      const geometry = faceGeometry(entry.hitRef, Number(faceId));
      if (!geometry) continue;
      // The tint lies on the surface itself; lift it a hair along the outward
      // normal so it does not fight the face, the section cap or a sketch fill.
      const pose = outwardNormal(entry.hitRef, Number(faceId));
      if (pose) {
        geometry.translate(
          pose.normal[0] * FACE_OVERLAY_LIFT,
          pose.normal[1] * FACE_OVERLAY_LIFT,
          pose.normal[2] * FACE_OVERLAY_LIFT,
        );
      }
      const invalid = this.faceHighlights.invalid.has(key);
      const selected = this.faceHighlights.selected.has(key);
      const material = new THREE.MeshBasicMaterial({
        color: invalid ? 0xef4444 : this.sketchHighlightColor(),
        transparent: true,
        opacity: invalid ? 0.5 : selected ? 0.45 : 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        clippingPlanes: this.overlayClipPlanes(),
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = RenderOrder.faceOverlay;
      this.faceOverlayGroup.add(mesh);
      this.bodyFaceOverlays.set(key, { mesh, material });
    }
  }

  setSketchOverlay(
    preview: SketchEntity | null,
    draftPoints: Point2[],
    highlight = false,
    marker: Point2 | null = null,
  ): void {
    this.sketchOverlayState = { preview, draftPoints, highlight, marker };
    this.rebuildSketchOverlay();
    this.invalidate();
  }

  getCameraState(): ViewportCamera {
    return {
      target: [this.target.x, this.target.y, this.target.z],
      distance: this.distance,
      azimuth: this.azimuth,
      polar: this.polar,
      roll: this.roll,
    };
  }

  setCameraState(state: ViewportCamera): void {
    this.transitionTo({
      target: new THREE.Vector3(...state.target),
      distance: state.distance,
      azimuth: state.azimuth,
      polar: state.polar,
      roll: state.roll ?? 0,
    });
  }

  /**
   * True while the camera is on its way between two poses. The pose it passes
   * through is not a view: only where it comes to rest is looked at again.
   */
  isCameraSettling(): boolean {
    return this.transition !== null;
  }

  /**
   * The pose a model opens with before it has a view of its own. Opening one the
   * first time starts here and is fitted once its build has finished.
   */
  defaultCameraPose(): ViewportCamera {
    return {
      target: [0, 0, 0],
      distance: DEFAULT_CAMERA_DISTANCE,
      azimuth: DEFAULT_CAMERA_AZIMUTH,
      polar: DEFAULT_CAMERA_POLAR,
      roll: 0,
    };
  }

  alignSketch(
    frame: SketchFrame,
    entities: readonly SketchEntity[] = [],
    extraPoints: readonly Point2[] = [],
  ): void {
    const [nx, ny, nz] = frame.normal;
    const length = Math.hypot(nx, ny, nz) || 1;
    // Look straight along the sketch normal, including tilted faces. The tiny
    // clamps avoid the singular poles where the orbit basis flips.
    const azimuth = Math.atan2(ny / length, nx / length);
    const polar = clamp(Math.acos(nz / length), 0.001, Math.PI - 0.001);
    this.transitionTo(this.sketchPose(frame, entities, extraPoints, azimuth, polar));
  }

  // Frames the sketch content with a fixed margin on both sides of the viewport.
  private sketchPose(
    frame: SketchFrame,
    entities: readonly SketchEntity[],
    extraPoints: readonly Point2[],
    azimuth: number,
    polar: number,
  ): CameraPose {
    const origin = new THREE.Vector3(...frame.origin);
    const pose: CameraPose = { target: origin, distance: this.distance, azimuth, polar };
    const { right, up } = cameraBasis(azimuth, polar);

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    const offset = new THREE.Vector3();
    const include = (point: Point2) => {
      const world = sketchPointToWorld(frame, point);
      offset.set(world[0], world[1], world[2]).sub(origin);
      const u = offset.dot(right);
      const v = offset.dot(up);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    };
    for (const entity of entities) {
      for (const point of tessellateEntity(entity)) include(point);
    }
    for (const point of extraPoints) include(point);
    // An empty sketch keeps the current zoom and only centres on its plane.
    if (!Number.isFinite(minU)) return pose;

    return {
      target: origin
        .clone()
        .addScaledVector(right, (minU + maxU) / 2)
        .addScaledVector(up, (minV + maxV) / 2),
      distance: fitDistance(maxU - minU, maxV - minV, this.width, this.height),
      azimuth,
      polar,
    };
  }

  private transitionTo(pose: CameraPose): void {
    const from: CameraPose = {
      target: this.target.clone(),
      distance: this.distance,
      azimuth: this.azimuth,
      polar: this.polar,
      roll: this.roll,
    };
    this.transition = {
      from,
      to: pose,
      azimuthDelta: shortestAngle(from.azimuth, pose.azimuth),
      rollDelta: shortestAngle(from.roll ?? 0, pose.roll ?? 0),
      startedAt: performance.now(),
      duration: CAMERA_TRANSITION_MS,
    };
    this.invalidate();
  }

  private stepTransition(now: number): void {
    const transition = this.transition;
    if (!transition) return;
    const progress = clamp((now - transition.startedAt) / transition.duration, 0, 1);
    const eased = easeInOut(progress);
    const { from, to } = transition;
    this.target.lerpVectors(from.target, to.target, eased);
    // Zoom interpolates geometrically so the perceived speed stays even.
    this.distance =
      from.distance > 0 && to.distance > 0
        ? from.distance * (to.distance / from.distance) ** eased
        : from.distance + (to.distance - from.distance) * eased;
    this.azimuth = from.azimuth + transition.azimuthDelta * eased;
    this.polar = from.polar + (to.polar - from.polar) * eased;
    this.roll = (from.roll ?? 0) + transition.rollDelta * eased;
    if (progress >= 1) this.transition = null;
    this.updateCamera();
  }

  pickSketch(
    clientX: number,
    clientY: number,
    entities?: readonly SketchEntity[],
  ): SketchPick | null {
    const active = this.sketchEntries.find((entry) => entry.active);
    if (!active) return null;
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const normal = new THREE.Vector3(...active.frame.normal);
    const origin = new THREE.Vector3(...active.frame.origin);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const world = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, world)) return null;
    const point = worldToSketchPoint(active.frame, [world.x, world.y, world.z]);
    const unitsPerPixel = (this.camera.top - this.camera.bottom) / Math.max(1, this.height);
    const sketchEntities = withFundamentalEntities(
      entities ?? this.sketchData.find((candidate) => candidate.id === active.id)?.entities ?? [],
    );
    const hitDistance = (entity: SketchEntity): number => {
      if (entity.type === 'point') {
        return Math.hypot(point[0] - entity.x, point[1] - entity.y);
      }
      let distance = Number.POSITIVE_INFINITY;
      const curve = tessellateEntity(entity, 64);
      if (entity.type === 'circle' || entity.type === 'ellipse') {
        const first = curve[0];
        if (first) curve.push(first);
      }
      for (let index = 0; index < curve.length - 1; index += 1) {
        distance = Math.min(
          distance,
          pointSegmentDistance(point, curve[index]!, curve[index + 1]!),
        );
      }
      return distance;
    };
    let entityId: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    const consider = (entity: SketchEntity) => {
      const distance = hitDistance(entity);
      const limit = unitsPerPixel * (entity.type === 'point' ? 4 : 3);
      if (distance <= limit && distance < best) {
        best = distance;
        entityId = entity.id;
      }
    };
    // Stored geometry wins over a fundamental reference it happens to lie on.
    for (const entity of sketchEntities) {
      if (!isFundamentalEntityId(entity.id)) consider(entity);
    }
    if (!entityId) {
      for (const entity of sketchEntities) {
        if (isFundamentalEntityId(entity.id)) consider(entity);
      }
    }
    // Control points always win the hit test over curves, including points
    // that coincide with a curve. Pick the nearest point globally.
    let pointEntityId: string | null = null;
    let pointIndex: number | null = null;
    let bestPoint = unitsPerPixel * 4;
    for (const entity of sketchEntities) {
      // Axis endpoints are not geometry the user can grab or constrain.
      if (isSketchAxisId(entity.id)) continue;
      this.sketchControlPoints(entity).forEach((candidate, index) => {
        const distance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
        if (distance <= bestPoint) {
          bestPoint = distance;
          pointEntityId = entity.id;
          pointIndex = index;
        }
      });
    }
    if (pointEntityId && pointIndex !== null) {
      return { point, entityId: pointEntityId, pointIndex };
    }
    return { point, entityId, pointIndex: null };
  }

  private addSketchGrid(group: THREE.Group, frame: SketchFrame): void {
    const extent = 200;
    const step = 10;
    const majorStep = 50;
    const offset: Point2 = [0, 0];
    const minor: THREE.Vector3[] = [];
    const major: THREE.Vector3[] = [];
    for (let value = -extent; value <= extent; value += step) {
      const target = value % majorStep === 0 ? major : minor;
      target.push(
        this.sketchWorld(frame, [-extent, value], offset),
        this.sketchWorld(frame, [extent, value], offset),
        this.sketchWorld(frame, [value, -extent], offset),
        this.sketchWorld(frame, [value, extent], offset),
      );
    }
    const makeLines = (points: THREE.Vector3[], color: number, opacity: number) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.renderOrder = RenderOrder.sketchGrid;
      group.add(lines);
    };
    makeLines(minor, this.theme === 'dark' ? 0x5c6575 : 0x9aa4b2, 0.18);
    makeLines(major, this.theme === 'dark' ? 0x8c97a8 : 0x6d7787, 0.38);
  }

  /**
   * Fundamental geometry of the sketch being edited: the two axes and the
   * origin. It is not stored in the sketch, so it is drawn from the shared
   * definition instead of from `sketch.entities`.
   */
  private addSketchFundamentals(
    group: THREE.Group,
    frame: SketchFrame,
    selectionKeys: readonly string[],
    highlightKeys: readonly string[],
    hoverKeys: readonly string[],
  ): void {
    const selected = new Set(selectionKeys.map((key) => key.split('#')[0]));
    const highlighted = new Set(highlightKeys.map((key) => key.split('#')[0]));
    const hovered = new Set(hoverKeys.map((key) => key.split('#')[0]));
    for (const entity of fundamentalEntities()) {
      if (entity.type !== 'line') continue;
      const picked = selected.has(entity.id) || highlighted.has(entity.id);
      const color = selected.has(entity.id)
        ? this.sketchSelectedColor()
        : hovered.has(entity.id)
          ? this.sketchHoverColor()
          : highlighted.has(entity.id)
            ? this.sketchHighlightColor()
            : entity.id === SKETCH_X_AXIS_ID
              ? 0xd48282
              : 0x82b482;
      const width = selected.has(entity.id) ? 3 : hovered.has(entity.id) ? 2.5 : picked ? 3 : 1.5;
      const line = this.createSketchLine(entity, frame, color, width, 1);
      if (!line) continue;
      line.renderOrder = RenderOrder.sketchGrid;
      group.add(line);
    }

    const originSelected = selected.has(SKETCH_ORIGIN_ID);
    const originHighlighted = highlighted.has(SKETCH_ORIGIN_ID);
    const originHovered = hovered.has(SKETCH_ORIGIN_ID);
    const origin = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([this.sketchWorld(frame, [0, 0])]),
      new THREE.PointsMaterial({
        color: originSelected
          ? this.sketchSelectedColor()
          : originHovered
            ? this.sketchHoverColor()
            : originHighlighted
              ? this.sketchHighlightColor()
              : this.sketchPointColor(),
        map: this.pointTexture,
        alphaTest: 0.5,
        transparent: true,
        size: originSelected ? 8 : originHovered ? 7 : originHighlighted ? 8 : 6,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    origin.renderOrder =
      originSelected || originHovered || originHighlighted
        ? RenderOrder.sketchPointActive
        : RenderOrder.sketchPoint;
    group.add(origin);
  }

  private sketchWorld(frame: SketchFrame, point: Point2, extra?: Point2): THREE.Vector3 {
    const world = sketchPointToWorld(frame, point);
    const lift = 0.08;
    return new THREE.Vector3(
      world[0] + frame.normal[0] * lift + (extra?.[0] ?? 0),
      world[1] + frame.normal[1] * lift + (extra?.[1] ?? 0),
      world[2] + frame.normal[2] * lift,
    );
  }

  private addSketchEntity(
    group: THREE.Group,
    entity: SketchEntity,
    frame: SketchFrame,
    selected: boolean,
    selectedPoints: ReadonlySet<number>,
    dimmed: boolean,
    frozen: boolean,
    problem: boolean,
    projected: boolean,
    lost: boolean,
    highlighted: boolean,
    highlightedPoints: ReadonlySet<number>,
    hovered: boolean,
    hoveredPoints: ReadonlySet<number>,
    background: boolean,
    error: boolean,
    tint: number | null,
    onTop: boolean,
  ): void {
    // A problem replaces the ordinary blue. Every explicit state above it
    // (selection, hover, magnet highlight, frozen, projection) still wins.
    const color = error
      ? this.sketchErrorColor()
      : selected
        ? this.sketchSelectedColor()
        : hovered
          ? this.sketchHoverColor()
          : highlighted
            ? this.sketchHighlightColor()
            : lost
              ? this.sketchLostProjectionColor()
              : projected
                ? this.sketchProjectionColor()
                : frozen
                  ? this.sketchFrozenLineColor()
                  : entity.construction
                    ? this.sketchConstructionColor()
                    : problem
                      ? this.sketchProblemColor()
                      : (tint ?? this.sketchColor());
    // Sketches that are not being edited are drawn thinner so they cannot be
    // mistaken for the sketch in progress.
    const width = selected ? 3 : hovered ? 3 : highlighted ? 3 : background ? 1 : 2;
    if (entity.type !== 'point') {
      const line = this.createSketchLine(
        entity,
        frame,
        color,
        width,
        dimmed && !error ? 0.2 : 1,
        entity.construction,
        !onTop,
      );
      if (line) {
        line.userData.entityId = entity.id;
        line.userData.baseColor = color;
        line.userData.baseWidth = width;
        group.add(line);
      }
    }
    const controlPoints = this.sketchControlPoints(entity);
    controlPoints.forEach((point, index) => {
      const pointHighlighted = highlighted || highlightedPoints.has(index);
      const pointHovered = hovered || hoveredPoints.has(index);
      const selectedPoint = selected || selectedPoints.has(index);
      const pointColor = error
        ? this.sketchErrorColor()
        : selectedPoint
          ? this.sketchSelectedColor()
          : pointHovered
            ? this.sketchHoverColor()
            : pointHighlighted
              ? this.sketchHighlightColor()
              : lost
                ? this.sketchLostProjectionColor()
                : projected
                  ? this.sketchProjectionColor()
                  : frozen
                    ? this.sketchFrozenPointColor()
                    : problem
                      ? this.sketchProblemColor()
                      : this.sketchPointColor();
      const pointSize = selectedPoint ? 6 : pointHovered ? 5 : pointHighlighted ? 6 : 4;
      const geometry = new THREE.BufferGeometry().setFromPoints([this.sketchWorld(frame, point)]);
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: pointColor,
          map: this.pointTexture,
          alphaTest: 0.5,
          transparent: true,
          opacity: dimmed && !error ? 0.25 : 1,
          size: pointSize,
          sizeAttenuation: false,
          depthTest: !onTop,
          depthWrite: false,
        }),
      );
      points.renderOrder =
        selectedPoint || pointHovered || pointHighlighted
          ? RenderOrder.sketchPointActive
          : RenderOrder.sketchPoint;
      points.userData.entityId = entity.id;
      points.userData.pointIndex = index;
      points.userData.baseColor = pointColor;
      points.userData.baseSize = pointSize;
      group.add(points);
    });
  }

  private sketchControlPoints(entity: SketchEntity): Point2[] {
    return entityControlPoints(entity);
  }

  private createSketchLine(
    entity: SketchEntity,
    frame: SketchFrame,
    color: number,
    width: number,
    opacity: number,
    dashed = false,
    depthTest = false,
  ): Line2 | null {
    if (entity.type === 'point') return null;
    const curve = tessellateEntity(entity, 96);
    if (entity.type === 'circle' || entity.type === 'ellipse') {
      const first = curve[0];
      if (first) curve.push(first);
    }
    const positions: number[] = [];
    for (const point of curve) {
      const world = this.sketchWorld(frame, point);
      positions.push(world.x, world.y, world.z);
    }
    if (positions.length < 6) return null;
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color,
      linewidth: width,
      transparent: true,
      opacity,
      depthTest,
      depthWrite: false,
      // A depth-tested sketch often lies on the face it was drawn on; the bias
      // keeps its lines above that face without letting them out of the body.
      polygonOffset: depthTest,
      polygonOffsetFactor: depthTest ? -1 : 0,
      polygonOffsetUnits: depthTest ? -1 : 0,
      resolution: new THREE.Vector2(this.width, this.height),
      dashed,
      dashSize: 8,
      gapSize: 8,
      dashScale: this.pixelsPerWorldUnit(),
    });
    this.sketchLineMaterials.push(material);
    const line = new Line2(geometry, material);
    if (dashed) line.computeLineDistances();
    line.renderOrder = RenderOrder.annotation;
    return line;
  }

  private rebuildSketchOverlay(): void {
    if (this.sketchOverlay) {
      this.overlayScene.remove(this.sketchOverlay);
      this.disposeObject(this.sketchOverlay);
      this.sketchOverlay = null;
    }
    const active = this.sketchEntries.find((entry) => entry.active);
    if (!active) return;
    const group = new THREE.Group();
    const { preview, draftPoints, highlight, marker } = this.sketchOverlayState;
    const previewColor = highlight ? this.sketchHighlightColor() : this.sketchColor();
    if (preview) {
      const line = this.createSketchLine(preview, active.frame, previewColor, 2, 0.75);
      if (line) group.add(line);
    }
    if (draftPoints.length > 0) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        draftPoints.map((point) => this.sketchWorld(active.frame, point)),
      );
      const draft = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: highlight ? this.sketchHighlightColor() : this.sketchPointColor(),
          map: this.pointTexture,
          alphaTest: 0.5,
          transparent: true,
          size: 4,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      draft.renderOrder = RenderOrder.sketchDraft;
      group.add(draft);
    }
    if (marker) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        this.sketchWorld(active.frame, marker),
      ]);
      const phantom = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: this.sketchHighlightColor(),
          map: this.pointTexture,
          alphaTest: 0.5,
          transparent: true,
          opacity: 0.9,
          size: 7,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      phantom.renderOrder = RenderOrder.sketchPhantom;
      group.add(phantom);
    }
    if (group.children.length === 0) return;
    this.overlayScene.add(group);
    this.sketchOverlay = group;
  }

  private disposeSketchEntries(): void {
    for (const entry of this.sketchEntries) {
      this.overlayScene.remove(entry.group);
      this.disposeObject(entry.group);
    }
    this.sketchEntries = [];
    this.sketchLineMaterials = [];
    this.sketchFaceMaterials.clear();
    this.facePickMeshes.length = 0;
    if (this.sketchOverlay) {
      this.overlayScene.remove(this.sketchOverlay);
      this.disposeObject(this.sketchOverlay);
      this.sketchOverlay = null;
    }
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
      const withGeometry = object as THREE.Object3D & { geometry?: THREE.BufferGeometry };
      withGeometry.geometry?.dispose();
      const withMaterial = object as THREE.Object3D & {
        material?: THREE.Material | THREE.Material[];
      };
      const materials = withMaterial.material;
      if (Array.isArray(materials)) for (const material of materials) material.dispose();
      else materials?.dispose();
    });
  }

  private applyClipping(): void {
    const planes = this.sectionClipPlanes;
    for (const entry of this.bodies.values()) {
      entry.material.clippingPlanes = planes;
      entry.material.needsUpdate = true;
      for (const lines of [entry.edges, entry.tangentEdges]) {
        const material = lines?.material as THREE.LineBasicMaterial | undefined;
        if (!material) continue;
        material.clippingPlanes = planes;
        material.needsUpdate = true;
      }
    }
  }

  /**
   * A face overlay can lie exactly on the cut plane, for example the selected
   * face a sketch is attached to. The clipping test then rejects it on
   * floating-point noise and the hatching shows through in stripes, so the
   * overlay gets planes nudged by a hair towards the kept side.
   */
  private overlayClipPlanes(): THREE.Plane[] {
    return this.sectionClipPlanes.map((plane) => {
      const biased = plane.clone();
      biased.constant += SECTION_CLIP_BIAS;
      return biased;
    });
  }

  private disposeSection(): void {
    for (const entry of this.sectionEntries) {
      for (const material of entry.materials) material.dispose();
    }
    this.sectionScene.clear();
    this.sectionEntries = [];
  }

  private rebuildSection(): void {
    this.disposeSection();
    if (this.sectionPlanes.length === 0) return;

    this.sectionPlanes.forEach((section, index) => {
      const effectiveNormal = new THREE.Vector3(...section.normal).normalize();
      const point = new THREE.Vector3(...section.origin).addScaledVector(
        effectiveNormal,
        section.offset,
      );
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(effectiveNormal, point);
      for (const [bodyId, body] of this.bodies) {
        if (!body.group.visible) continue;

        const back = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          depthTest: false,
          stencilWrite: true,
          stencilFunc: THREE.AlwaysStencilFunc,
          stencilFail: THREE.IncrementWrapStencilOp,
          stencilZFail: THREE.IncrementWrapStencilOp,
          stencilZPass: THREE.IncrementWrapStencilOp,
          side: THREE.BackSide,
          // The stencil needs a closed solid, so only its own plane may clip it.
          clippingPlanes: [this.sectionClipPlanes[index]!],
        });
        const front = back.clone();
        front.side = THREE.FrontSide;
        front.stencilFail = THREE.DecrementWrapStencilOp;
        front.stencilZFail = THREE.DecrementWrapStencilOp;
        front.stencilZPass = THREE.DecrementWrapStencilOp;

        const { fill, line } = this.sectionCapColors(body);

        const capMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uPixelRatio: { value: this.renderer.getPixelRatio() },
            uSpacing: { value: HATCH_SPACING_PX },
            // Without the hatch the cap keeps its colour: a section is then read
            // as a flat face rather than as cut material.
            uHatch: { value: this.sectionHatch ? 1 : 0 },
            uFill: { value: fill },
            uLine: { value: line },
          },
          vertexShader: `
            #include <clipping_planes_pars_vertex>
            void main() {
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              #include <clipping_planes_vertex>
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            #include <clipping_planes_pars_fragment>
            uniform float uPixelRatio;
            uniform float uSpacing;
            uniform float uHatch;
            uniform vec3 uFill;
            uniform vec3 uLine;
            void main() {
              #include <clipping_planes_fragment>
              float d = (gl_FragCoord.x + gl_FragCoord.y) * 0.70710678 / uPixelRatio;
              float cell = d / uSpacing;
              float distanceToLine = abs(fract(cell + 0.5) - 0.5) * uSpacing;
              float line = uHatch * (1.0 - smoothstep(0.4, 0.9, distanceToLine));
              gl_FragColor = vec4(mix(uFill, uLine, line), 1.0);
            }
          `,
          side: THREE.DoubleSide,
          clipping: true,
          // The cap is an annotation on the cut face: it hides behind solid
          // material in front of the plane, but it must not block the operation
          // delta, sketch faces or handles drawn over the same area.
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          stencilWrite: true,
          stencilRef: 0,
          stencilFunc: THREE.NotEqualStencilFunc,
          stencilFail: THREE.KeepStencilOp,
          stencilZFail: THREE.KeepStencilOp,
          stencilZPass: THREE.KeepStencilOp,
          clippingPlanes: this.sectionClipPlanes.filter((_, other) => other !== index),
        });

        const group = new THREE.Group();
        const backMesh = new THREE.Mesh(body.geometry, back);
        const frontMesh = new THREE.Mesh(body.geometry, front);
        backMesh.renderOrder = RenderOrder.section - 2;
        frontMesh.renderOrder = RenderOrder.section - 1;
        group.add(backMesh, frontMesh);

        const cap = new THREE.Mesh(this.capGeometry, capMaterial);
        cap.renderOrder = RenderOrder.section;
        cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), effectiveNormal);
        cap.position.copy(effectiveNormal).multiplyScalar(-plane.constant);
        group.add(cap);
        group.visible = false;

        this.sectionScene.add(group);
        this.sectionEntries.push({ group, cap, materials: [back, front, capMaterial], bodyId });
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    cancelAnimationFrame(this.hoverFrame);
    this.resizeObserver.disconnect();
    this.unbindEvents();
    this.clearHandleGroup();
    this.overlayScene.remove(this.handleGroup);
    this.clearEdgeLines(this.edgeHighlightEntries);
    this.clearEdgeLines(this.edgeHoverEntries);
    this.hoveredEdgeKey = null;

    for (const id of [...this.bodies.keys()]) this.removeEntry(id);
    for (const entry of this.ghostEntries.values()) {
      this.ghostGroup.remove(entry.mesh);
      entry.material.dispose();
    }
    this.ghostEntries.clear();
    for (const geometry of this.ghostGeometries.values()) geometry.dispose();
    this.ghostGeometries.clear();
    for (const { mesh, material } of this.bodyFaceOverlays.values()) {
      this.faceOverlayGroup.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    }
    this.bodyFaceOverlays.clear();
    this.disposeSection();
    this.disposeSketchEntries();
    this.capGeometry.dispose();
    this.pointTexture.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.axes.geometry.dispose();
    (this.axes.material as THREE.Material).dispose();
    this.renderer.dispose();
  }

  private createGrid(): THREE.GridHelper {
    const major = this.theme === 'dark' ? 0x39404d : 0xb6bec9;
    const minor = this.theme === 'dark' ? 0x232831 : 0xd9dee6;
    const grid = new THREE.GridHelper(2000, 200, major, minor);
    grid.rotation.x = Math.PI / 2;
    const material = grid.material as THREE.LineBasicMaterial;
    material.depthWrite = false;
    material.transparent = true;
    material.opacity = 0.9;
    grid.renderOrder = RenderOrder.grid;
    return grid;
  }

  /**
   * The world axes: a ray along each of the three directions from the origin,
   * coloured the way the nav cube names them. They are a view aid like the grid,
   * so they rest with it and leave the sketch, which draws its own axes.
   */
  private createAxes(): THREE.LineSegments {
    const length = 60;
    const positions = new Float32Array([
      0,
      0,
      0,
      length,
      0,
      0,
      0,
      0,
      0,
      0,
      length,
      0,
      0,
      0,
      0,
      0,
      0,
      length,
    ]);
    const colors = new Float32Array([
      ...axisColor('#d48282'),
      ...axisColor('#d48282'),
      ...axisColor('#82b482'),
      ...axisColor('#82b482'),
      ...axisColor('#84a4e4'),
      ...axisColor('#84a4e4'),
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    const axes = new THREE.LineSegments(geometry, material);
    axes.renderOrder = RenderOrder.grid;
    return axes;
  }

  /**
   * What the view draws besides the model. The world grid and the axes are a
   * working aid of the 3D view and never reach the sketch editor; the hatch is
   * the diagonal line of a section cap, which without it keeps its colour alone.
   */
  setViewElements(elements: { axes: boolean; grid: boolean; hatching: boolean }): void {
    this.showAxes = elements.axes;
    this.showGrid = elements.grid;
    this.applyWorldAid();
    if (this.sectionHatch !== elements.hatching) {
      this.sectionHatch = elements.hatching;
      this.applySectionHatch();
    }
  }

  /** The grid and the axes belong to the free 3D view, not to a sketch. */
  private applyWorldAid(): void {
    const editing = this.sketchData.some((sketch) => sketch.active);
    this.grid.visible = this.showGrid && !editing;
    this.axes.visible = this.showAxes && !editing;
  }

  private applySectionHatch(): void {
    for (const entry of this.sectionEntries) {
      for (const material of entry.materials) {
        if (material instanceof THREE.ShaderMaterial) {
          material.uniforms.uHatch!.value = this.sectionHatch ? 1 : 0;
        }
      }
    }
    this.invalidate();
  }

  /**
   * A tangent edge marks where a fillet blends into a face. Mixing it towards
   * the body keeps the blend readable without the hard line of a real corner.
   */
  private tangentEdgeColor(bodyColor: string): number {
    return new THREE.Color(this.edgeColor).lerp(new THREE.Color(bodyColor), 0.25).getHex();
  }

  private createEntry(body: SceneBody): BodyEntry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(body.mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(body.mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(body.mesh.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: body.color,
      roughness: 0.55,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.bodyId = body.id;
    const group = new THREE.Group();
    group.add(mesh);

    let edges: THREE.LineSegments | null = null;
    let edgeGeometry: THREE.BufferGeometry | null = null;
    let tangentEdges: THREE.LineSegments | null = null;
    let tangentGeometry: THREE.BufferGeometry | null = null;
    const bodyEdges = body.kind === 'mesh' ? undefined : body.mesh.edges;
    if (bodyEdges && bodyEdges.length > 0) {
      const outline = outlineSegments(bodyEdges);
      edgeGeometry = lineGeometry(outline.sharp);
      tangentGeometry = lineGeometry(outline.tangent);
    } else if (body.mesh.triangleCount <= OUTLINE_TRIANGLE_LIMIT) {
      // Imported meshes have no B-rep to read edges from.
      edgeGeometry = new THREE.EdgesGeometry(geometry, (OUTLINE_CREASE_RADIANS * 180) / Math.PI);
    }
    if (edgeGeometry) {
      edges = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: this.edgeColor }),
      );
      group.add(edges);
    }
    if (tangentGeometry) {
      tangentEdges = new THREE.LineSegments(
        tangentGeometry,
        new THREE.LineBasicMaterial({ color: this.tangentEdgeColor(body.color) }),
      );
      group.add(tangentEdges);
    }

    const entry: BodyEntry = {
      group,
      kind: body.kind,
      mesh,
      geometry,
      material,
      edges,
      edgeGeometry,
      tangentEdges,
      tangentGeometry,
      meshRef: body.mesh,
      hitMesh: mesh,
      hitGeometry: null,
      hitRef: body.mesh,
      color: body.color,
      depthBias: 0,
      ghost: body.ghost ?? null,
      translucent: body.translucent !== false,
      interactive: body.interactive !== false,
    };
    this.syncHitMesh(entry, body);
    return entry;
  }

  /**
   * Picking always happens against the state before the edited operation, so a
   * previewed body keeps an invisible hit mesh built from its input shape.
   */
  private syncHitMesh(entry: BodyEntry, body: SceneBody): void {
    const target = body.hitMesh ?? body.mesh;
    if (entry.hitRef === target) return;
    // Drop a previous dedicated hit mesh before attaching a new one.
    if (entry.hitMesh !== entry.mesh) {
      this.scene.remove(entry.hitMesh);
      entry.hitGeometry?.dispose();
      (entry.hitMesh.material as THREE.Material).dispose();
      entry.hitMesh = entry.mesh;
      entry.hitGeometry = null;
    }
    entry.hitRef = target;
    if (target === body.mesh) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(target.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(target.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(target.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const hit = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
    hit.visible = false;
    hit.userData.bodyId = body.id;
    this.scene.add(hit);
    entry.hitMesh = hit;
    entry.hitGeometry = geometry;
  }

  private removeEntry(id: string): void {
    const entry = this.bodies.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    entry.geometry.dispose();
    entry.material.dispose();
    entry.edgeGeometry?.dispose();
    if (entry.edges) (entry.edges.material as THREE.Material).dispose();
    entry.tangentGeometry?.dispose();
    if (entry.tangentEdges) (entry.tangentEdges.material as THREE.Material).dispose();
    if (entry.hitMesh !== entry.mesh) {
      this.scene.remove(entry.hitMesh);
      entry.hitGeometry?.dispose();
      (entry.hitMesh.material as THREE.Material).dispose();
    }
    this.bodies.delete(id);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height, false);
    for (const material of this.sketchLineMaterials) {
      material.resolution.set(this.width, this.height);
    }
    for (const entry of [...this.edgeHighlightEntries, ...this.edgeHoverEntries]) {
      entry.material.resolution.set(this.width, this.height);
    }
    this.updateCamera();
  }

  // LineMaterial measures dashes in world units multiplied by dashScale, so a
  // scale of pixels-per-unit makes an 8/8 dash pattern 8 screen pixels wide.
  private pixelsPerWorldUnit(): number {
    return this.height / Math.max(1e-6, this.camera.top - this.camera.bottom);
  }

  /**
   * Distance from the orbit target to the farthest drawn vertex. The camera
   * keeps this much clearance behind the target instead of following the zoom,
   * so an orthographic zoom never drives the near plane through the model, and
   * the depth range follows the content rather than the magnification.
   */
  private contentRadius(): number {
    const box = new THREE.Box3();
    const collect = (geometry: THREE.BufferGeometry): void => {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox);
    };
    for (const entry of this.bodies.values()) {
      if (entry.group.visible) collect(entry.geometry);
    }
    for (const entry of this.ghostEntries.values()) box.union(entry.box);
    if (box.isEmpty()) return 100;

    let radius = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          radius = Math.max(
            radius,
            Math.hypot(x - this.target.x, y - this.target.y, z - this.target.z),
          );
        }
      }
    }
    return Math.max(radius, 1);
  }

  private updateCamera(): void {
    const aspect = this.width / this.height;
    const halfHeight = this.distance * Math.tan((FOV_DEGREES * Math.PI) / 180 / 2);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;

    const { eye, near, far } = cameraFrustum(this.distance, this.contentRadius());
    this.camera.near = near;
    this.camera.far = far;

    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + eye * sinPolar * Math.cos(this.azimuth),
      this.target.y + eye * sinPolar * Math.sin(this.azimuth),
      this.target.z + eye * Math.cos(this.polar),
    );
    // The up vector is the turntable one, rolled about the view direction when a
    // trackball has tilted the horizon.
    const basis = cameraBasis(this.azimuth, this.polar);
    this.camera.up.copy(basis.up);
    if (this.roll !== 0) {
      this.camera.up.applyAxisAngle(
        new THREE.Vector3(
          sinPolar * Math.cos(this.azimuth),
          sinPolar * Math.sin(this.azimuth),
          Math.cos(this.polar),
        ),
        this.roll,
      );
    }
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const dashScale = this.pixelsPerWorldUnit();
    for (const material of this.sketchLineMaterials) {
      (
        material as unknown as { uniforms: { dashScale: { value: number } } }
      ).uniforms.dashScale.value = dashScale;
    }
    this.onCameraChange?.(this.azimuth, this.polar, this.distance);
    if (this.hoveredEdgeKey) this.drawHoveredEdge();
    this.updateGhostFades();
    if (this.handleData.length > 0) this.updateHandles();
    this.invalidate();
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.transition = null;
    // A press is the start of a gesture or of a selection: the tooltip of the
    // geometry under the pointer would be in the way of both.
    this.clearGeometryHover();
    if (this.touchDown(event)) return;
    if (event.button === 0) {
      this.pointerDown = { x: event.clientX, y: event.clientY };
      this.pointerMoved = false;
    }

    // The camera is asked first: a gesture it names always wins, even when the
    // press lands on a handle of a quick operation. Turning the view is the
    // harder gesture to reach any other way, and a handle sits on the model
    // where the user aims at it by accident.
    const scheme = cameraScheme(useUiStore.getState().cameraScheme);
    const mode = cameraDragMode(scheme, {
      button: event.button,
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey || event.metaKey,
    });
    if (mode) {
      // A sketch is drawn flat: while the camera faces its plane a turn pans
      // instead, so the sheet the user works on cannot tilt away under the
      // gesture. Turning the nav cube takes the view off the plane, and rotation
      // comes back with it.
      const turn = mode === 'orbit' ? sketchTurnMode(this.facesSketchPlane()) : mode;
      this.dragMode = turn;
      // Only a turn picks a pivot, and only when the scheme takes it from the
      // pointer: the nav cube and the schemes that keep the middle of the model
      // turn around the target the camera already has.
      this.orbitPivot =
        turn === 'orbit' && scheme.pivot === 'cursor'
          ? this.orbitPivotAt(event.clientX, event.clientY)
          : null;
      event.preventDefault();
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    // What is left is selection and the handles: a handle is grabbed before
    // selection, but not while a picking tool owns the pointer. Shift is the
    // second edge treatment kind, so it must not turn a grab into a pan.
    if (
      event.button === 0 &&
      !event.altKey &&
      !this.faceHighlights.picking &&
      !this.faceHighlights.bodyPicking
    ) {
      const hit = this.handleAt(event.clientX, event.clientY);
      if (hit) {
        event.preventDefault();
        this.startHandleDrag(hit, event);
      }
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.touchMove(event)) return;
    if (this.dragMode === 'handle' && this.handleDrag) {
      const drag = this.handleDrag;
      // A grip on a trajectory is read where the pointer meets the trajectory,
      // so it follows a curve instead of a straight line.
      if (drag.trail && drag.trail.length >= 2) {
        const value = this.trailValueAt(drag.trail, event.clientX, event.clientY);
        if (value === null) return;
        if (Math.abs(value - drag.lastValue) < 0.02) return;
        drag.lastValue = value;
        this.callbacks.onHandleDrag?.({
          id: drag.id,
          value,
          phase: 'move',
          x: event.clientX,
          y: event.clientY,
          shift: event.shiftKey,
        });
        return;
      }
      if (drag.arc) {
        const angle = this.pointerAngleAt(drag.arc, event.clientX, event.clientY);
        if (angle === null) return;
        if (drag.orbit) {
          // An orbit grip is where the pointer points: the angle from the start
          // of the circle is the value, not a delta from where it was grabbed.
          const value = (angle * 180) / Math.PI;
          if (Math.abs(value - drag.lastValue) < 0.05) return;
          drag.lastValue = value;
          this.callbacks.onHandleDrag?.({
            id: drag.id,
            value,
            phase: 'move',
            x: event.clientX,
            y: event.clientY,
            shift: event.shiftKey,
          });
          return;
        }
        let delta = angle - drag.arc.lastPointerAngle;
        // The pointer can cross the branch cut of atan2 between two moves.
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        drag.arc.lastPointerAngle = angle;
        const value = drag.lastValue + (delta * 180) / Math.PI;
        if (Math.abs(value - drag.lastValue) < 0.05) return;
        drag.lastValue = value;
        this.callbacks.onHandleDrag?.({
          id: drag.id,
          value,
          phase: 'move',
          x: event.clientX,
          y: event.clientY,
          shift: event.shiftKey,
        });
        return;
      }
      if (drag.move) {
        const move = this.moveDelta(drag, event);
        const distance = Math.hypot(move[0], move[1], move[2]);
        if (Math.abs(distance - drag.lastValue) < 0.02) return;
        drag.lastValue = distance;
        this.callbacks.onHandleDrag?.({
          id: drag.id,
          value: distance,
          phase: 'move',
          x: event.clientX,
          y: event.clientY,
          shift: event.shiftKey,
          move,
        });
        return;
      }
      const value = handleDragValue({
        startValue: drag.value,
        deltaX: event.clientX - drag.startX,
        deltaY: event.clientY - drag.startY,
        axisX: drag.axisX,
        axisY: drag.axisY,
        pixelsPerMm: drag.pixelsPerMm,
      });
      if (Math.abs(value - drag.lastValue) < 0.02) return;
      drag.lastValue = value;
      this.callbacks.onHandleDrag?.({
        id: drag.id,
        value,
        phase: 'move',
        x: event.clientX,
        y: event.clientY,
        shift: event.shiftKey,
      });
      return;
    }
    if (this.pointerDown && !this.pointerMoved) {
      const movedX = event.clientX - this.pointerDown.x;
      const movedY = event.clientY - this.pointerDown.y;
      if (Math.hypot(movedX, movedY) > 4) this.pointerMoved = true;
    }
    if (!this.dragMode) {
      if (event.buttons === 0 && !this.faceHighlights.picking && !this.faceHighlights.bodyPicking) {
        this.updateHandleHover(event.clientX, event.clientY);
        // Over a handle the handle speaks for itself; everywhere else the
        // geometry under the pointer is what a click would add. `hoverEnabled`
        // covers handles, but also a selected face or edge whose body offers
        // none, such as a curved face.
        if (this.hoveredHandleId === null && this.hoverEnabled) {
          this.scheduleHover(event.clientX, event.clientY);
        }
      }
      if ((this.faceHighlights.picking || this.faceHighlights.bodyPicking) && event.buttons === 0) {
        this.scheduleHover(event.clientX, event.clientY);
      }
      return;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    if (this.dragMode === 'orbit') {
      this.orbit(dx, dy);
      return;
    }

    this.panBy(dx, dy);
    this.updateCamera();
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.touchUp(event);
    if (this.dragMode === 'handle') {
      this.finishHandleDrag(event.type === 'pointercancel', event.pointerId);
      return;
    }
    if (this.dragMode) {
      this.dragMode = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    }

    if (event.button === 0 && this.pointerDown) {
      const shouldPick = !this.pointerMoved;
      this.pointerDown = null;
      this.pointerMoved = false;
      if (shouldPick) {
        const now = performance.now();
        const previous = this.lastClick;
        const double =
          previous !== null &&
          now - previous.time < DOUBLE_CLICK_MS &&
          Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <=
            DOUBLE_CLICK_SLOP_PX;
        this.lastClick = double ? null : { time: now, x: event.clientX, y: event.clientY };
        if (double) {
          // The pair means "open what made this face", so it must not also
          // re-select the object the first click already selected.
          // A face of a solid wins over a sketch lying on it: the sketch face is
          // a picker, not something the user aims at.
          const pick = this.pickSceneAt(event.clientX, event.clientY, true, false, true);
          if (pick) this.onDoublePick?.(pick);
          return;
        }
        const additive = isAdditiveClick(event);
        // Tool picking keeps its own contract; normal selection drills from the
        // object into its faces and edges.
        const toolPicking = this.faceHighlights.picking || this.faceHighlights.bodyPicking;
        if (toolPicking || !this.callbacks.onSelectPick) {
          const projecting = Boolean(this.faceHighlights.projecting);
          // A vertex is a finer target than an edge, so picking one wins over
          // the edge it belongs to.
          const vertexPicking = projecting || Boolean(this.faceHighlights.vertexPicking);
          const pick = this.pickSceneAt(
            event.clientX,
            event.clientY,
            // Faces stay on the table while projecting: `pickSceneAt` tries a
            // vertex first, then an edge, and falls back to the face under the
            // pointer, which is what a click on a plain face has to project.
            this.faceHighlights.picking,
            this.faceHighlights.bodyFacesOnly,
            // Projecting aims at the solid, never at the sketch face pickers.
            projecting || vertexPicking,
            projecting || Boolean(this.faceHighlights.edgePicking),
            vertexPicking,
          );
          this.onPick?.(pick, additive);
        } else {
          this.callbacks.onSelectPick(this.pickSelectionAt(event.clientX, event.clientY), additive);
        }
      }
    }
  };

  /**
   * A finger on the view turns it: one finger orbits the point it holds, two
   * fingers pan and pinch. A tap still selects, because the release goes through
   * the same press tracking as a click, and a finger that comes down on a handle
   * of a quick operation pulls it: a tablet has no second button to offer. The
   * event says what the pointer is, so no media query has to agree first.
   */
  private touchDown(event: PointerEvent): boolean {
    if (!isTouchPointer(event.pointerType)) return false;
    this.fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.fingers.size >= 2) {
      // The second finger takes the gesture over: a handle the first one grabbed
      // is let go of, the turn it started is dropped, and the release must not
      // select anything. Two fingers are the camera's even over a sketch,
      // because one is not enough to zoom.
      if (this.handleDrag) this.finishHandleDrag(false, this.handleDrag.pointerId);
      event.preventDefault();
      this.multiTouch = true;
      this.dragMode = null;
      this.pointerMoved = true;
      this.pinch = this.pinchState();
      return true;
    }
    // Inside a sketch one finger draws and drags geometry; it belongs to the
    // sketch editor, which listens on the same canvas and needs its click.
    if (useUiStore.getState().activeSketchId) return false;
    // A handle under the finger wins over the turn: it is the only way a tablet
    // can reach a quick operation, and the arrow is what the finger aims at.
    if (!this.faceHighlights.picking && !this.faceHighlights.bodyPicking) {
      const hit = this.handleAt(event.clientX, event.clientY);
      if (hit) {
        event.preventDefault();
        this.startHandleDrag(hit, event);
        return true;
      }
    }
    event.preventDefault();
    this.pointerDown = { x: event.clientX, y: event.clientY };
    this.pointerMoved = false;
    this.dragMode = 'orbit';
    this.orbitPivot = this.orbitPivotAt(event.clientX, event.clientY);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    return true;
  }

  private touchMove(event: PointerEvent): boolean {
    if (!isTouchPointer(event.pointerType)) return false;
    if (!this.fingers.has(event.pointerId)) return false;
    this.fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.multiTouch) {
      const next = this.pinchState();
      if (next && this.pinch) {
        this.panBy(next.centre.x - this.pinch.centre.x, next.centre.y - this.pinch.centre.y);
        this.zoomAt(next.centre.x, next.centre.y, this.pinch.spread / next.spread);
      }
      this.pinch = next;
      return true;
    }
    if (this.dragMode !== 'orbit') {
      // A handle a finger pulls is moved by the rest of the pointer handler.
      return this.dragMode !== 'handle';
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (dx !== 0 || dy !== 0) this.pointerMoved = true;
    this.orbit(dx, dy);
    return true;
  }

  /** Lifts a finger. The press tracking of the click path finishes the gesture. */
  private touchUp(event: PointerEvent): void {
    if (!isTouchPointer(event.pointerType)) return;
    if (!this.fingers.delete(event.pointerId)) return;
    this.pinch = this.fingers.size >= 2 ? this.pinchState() : null;
    if (this.fingers.size === 0) {
      this.multiTouch = false;
      // A handle the finger pulled ends on the release below, which reads the
      // mode to know what it is finishing.
      if (this.dragMode !== 'handle') this.dragMode = null;
    }
  }

  /** Centre and spread of the two fingers on the view, or null for one. */
  private pinchState(): { centre: { x: number; y: number }; spread: number } | null {
    const [first, second] = [...this.fingers.values()];
    if (!first || !second) return null;
    return {
      centre: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      spread: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
    };
  }

  /** Moves the view with the pointer: the target follows it on screen. */
  private panBy(dx: number, dy: number): void {
    const unitsPerPixel = (this.camera.top - this.camera.bottom) / this.height;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * unitsPerPixel);
    this.target.addScaledVector(up, dy * unitsPerPixel);
  }

  /**
   * Zooms by a ratio and keeps the point under the pixel where it is: the target
   * slides towards that point by the same ratio the viewport shrinks.
   */
  private zoomAt(clientX: number, clientY: number, ratio: number): void {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const distance = clamp(this.distance * ratio, 0.05, 10_000_000);
    const raycaster = this.pointerToRay(clientX, clientY);
    const anchor = pointOnRayAtTarget(raycaster.ray.origin, raycaster.ray.direction, this.target);
    this.target
      .sub(anchor)
      .multiplyScalar(distance / this.distance)
      .add(anchor);
    this.distance = distance;
    this.updateCamera();
  }

  private pointerToRay(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    return this.raycaster;
  }

  private pickSceneAt(
    clientX: number,
    clientY: number,
    faces = false,
    bodyFacesOnly = false,
    preferBody = false,
    edges = false,
    vertices = false,
  ): ScenePick | null {
    const raycaster = this.pointerToRay(clientX, clientY);
    const bodyMeshes = [...this.bodies.values()]
      .filter((entry) => entry.group.visible && entry.interactive)
      .map((entry) => entry.hitMesh);
    const faceHit =
      faces && !bodyFacesOnly
        ? raycaster.intersectObjects(this.facePickMeshes, false)[0]
        : undefined;
    // A section hides material without touching the tessellation, so the ray
    // must skip hits the clip planes removed. What is left is either a wall the
    // section exposes, such as the inside of a cavity, or nothing at all.
    const bodyHit = firstUnclippedHit(
      raycaster.intersectObjects(bodyMeshes, false),
      this.sectionClipPlanes,
    );
    // The cut itself is not a face of the B-rep, so it stands for the body as
    // a whole and wins over anything the ray reaches behind it.
    const section = this.pickSectionAt(raycaster, bodyHit);
    const visibleDistance = Math.min(bodyHit?.distance ?? Infinity, section?.distance ?? Infinity);
    // While faces are being picked they win over the solids they produced, so a
    // face stays clickable after it has been extruded.
    if (faces && faceHit && !preferBody) {
      const face = faceHit.object.userData.sketchFace as
        { sketchId: string; faceId: string } | undefined;
      if (face) return { kind: 'face', sketchId: face.sketchId, faceId: face.faceId };
    }
    // A sketch line is an edge too: a revolve axis can be drawn in a sketch.
    // The line has to be in front of the body for the click to mean it.
    if (edges) {
      const curve = this.pickSketchCurveAt(raycaster, this.localPoint(clientX, clientY));
      if (curve && curve.depth <= visibleDistance + 0.5) {
        return { kind: 'sketch-edge', sketchId: curve.id, entityId: curve.entityId };
      }
    }
    if (section) {
      const entry = this.bodies.get(section.bodyId);
      return entry?.kind === 'mesh'
        ? { kind: 'mesh', id: section.bodyId }
        : { kind: 'body', id: section.bodyId };
    }
    if (bodyHit) {
      const bodyId = bodyHit.object.userData.bodyId as string | undefined;
      if (bodyId && vertices) {
        const entry = this.bodies.get(bodyId);
        if (entry && entry.kind === 'solid') {
          const vertex = this.pickVertexAt(entry, bodyId, clientX, clientY);
          if (vertex) return vertex;
        }
      }
      if (bodyId && edges) {
        const entry = this.bodies.get(bodyId);
        if (entry && entry.kind === 'solid') {
          const edgeId = this.pickEdgeAt(entry, clientX, clientY);
          if (edgeId) return { kind: 'body-edge', bodyId, edgeId };
        }
      }
      if (bodyId && faces) {
        const entry = this.bodies.get(bodyId);
        const faceId = entry?.hitRef.faceIds[bodyHit.faceIndex ?? -1];
        if (entry && entry.kind === 'solid' && faceId !== undefined) {
          const normal = bodyHit.face?.normal;
          return {
            kind: 'body-face',
            bodyId,
            faceId: String(faceId),
            normal: normal ? [normal.x, normal.y, normal.z] : [0, 0, 1],
            origin: [bodyHit.point.x, bodyHit.point.y, bodyHit.point.z],
            planar: isPlanarFace(entry.hitRef, faceId),
          };
        }
      }
      if (bodyId) {
        const entry = this.bodies.get(bodyId);
        return entry?.kind === 'mesh' ? { kind: 'mesh', id: bodyId } : { kind: 'body', id: bodyId };
      }
    }
    if (faceHit) {
      const face = faceHit.object.userData.sketchFace as
        { sketchId: string; faceId: string } | undefined;
      if (face) return { kind: 'face', sketchId: face.sketchId, faceId: face.faceId };
    }
    return null;
  }

  /**
   * Hover over the regions and curves of the sketch the user has opened. Returns
   * whether the pointer is on that sketch, so the caller can fall back to the
   * body under it.
   */
  private updateSketchDetailHover(clientX: number, clientY: number): boolean {
    const sketchId = this.selectionDetail.sketchId;
    if (!sketchId) return false;
    const raycaster = this.pointerToRay(clientX, clientY);
    const bodyMeshes = [...this.bodies.values()]
      .filter((entry) => entry.group.visible && entry.interactive)
      .map((entry) => entry.hitMesh);
    const bodyHit = firstUnclippedHit(
      raycaster.intersectObjects(bodyMeshes, false),
      this.sectionClipPlanes,
    );
    const visibleDistance = Math.min(
      bodyHit?.distance ?? Infinity,
      this.pickSectionAt(raycaster, bodyHit)?.distance ?? Infinity,
    );
    const curve = this.pickSketchCurveAt(raycaster, this.localPoint(clientX, clientY), sketchId);
    const visibleCurve = curve && curve.depth <= visibleDistance + 0.5 ? curve : null;
    let faceKey: string | null = null;
    if (!visibleCurve) {
      const pickers = this.facePickMeshes.filter((mesh) => {
        const data = mesh.userData.sketchFace as { sketchId: string } | undefined;
        return data?.sketchId === sketchId;
      });
      const hit = raycaster.intersectObjects(pickers, false)[0];
      const face = hit?.object.userData.sketchFace as
        { sketchId: string; faceId: string } | undefined;
      if (face && hit!.distance <= visibleDistance + 0.5) {
        faceKey = `s:${sketchId}#${face.faceId}`;
      }
    }
    const edge = visibleCurve ? { sketchId, entityId: visibleCurve.entityId } : null;
    const hit = Boolean(edge || faceKey);
    if (
      edge?.entityId === this.hoveredSketchEdge?.entityId &&
      faceKey === this.hoveredFaceKey &&
      this.hoveredBodyId === null &&
      this.hoveredSketchId === null
    ) {
      return hit;
    }
    this.hoveredBodyId = null;
    this.hoveredFaceKey = faceKey;
    this.setHoveredSketch(null);
    this.setHoveredSketchEdge(edge);
    this.canvas.style.cursor = hit ? 'pointer' : '';
    this.applyBodyMaterials();
    this.applyFaceHighlights();
    this.invalidate();
    return hit;
  }

  /** Highlights the face or region a face-picking tool would take. */
  private hoverFacePick(key: string): void {
    if (
      key === this.hoveredFaceKey &&
      this.hoveredBodyId === null &&
      this.hoveredSketchId === null
    ) {
      return;
    }
    if (this.hoveredEdgeKey !== null) this.setHoveredEdge(null);
    if (this.hoveredSketchEdge !== null) this.setHoveredSketchEdge(null);
    this.hoveredBodyId = null;
    this.hoveredFaceKey = key;
    this.setHoveredSketch(null);
    this.canvas.style.cursor = 'pointer';
    this.applyBodyMaterials();
    this.applyFaceHighlights();
    this.invalidate();
  }

  /** Highlights a sketch object: all of its curves thicken, like a hovered face. */
  private hoverSketchObject(sketchId: string): void {
    if (this.hoveredEdgeKey !== null) this.setHoveredEdge(null);
    if (this.hoveredSketchEdge !== null) this.setHoveredSketchEdge(null);
    if (
      sketchId === this.hoveredSketchId &&
      this.hoveredBodyId === null &&
      this.hoveredFaceKey === null
    ) {
      return;
    }
    this.hoveredBodyId = null;
    this.hoveredFaceKey = null;
    this.setHoveredSketch(sketchId);
    this.canvas.style.cursor = 'pointer';
    this.applyBodyMaterials();
    this.applyFaceHighlights();
    this.invalidate();
  }

  /** Thickens every curve of the sketch object under the pointer. */
  private setHoveredSketch(next: string | null): void {
    if (next === this.hoveredSketchId) return;
    if (this.hoveredSketchId) this.paintSketchHover(this.hoveredSketchId, false);
    this.hoveredSketchId = next;
    if (next) this.paintSketchHover(next, true);
  }

  /** Colours the curves of one hovered sketch entity until the pointer leaves. */
  private setHoveredSketchEdge(next: { sketchId: string; entityId: string } | null): void {
    const current = this.hoveredSketchEdge;
    if (current?.sketchId === next?.sketchId && current?.entityId === next?.entityId) return;
    if (current) this.paintSketchEntityHover(current, false);
    this.hoveredSketchEdge = next;
    if (next) this.paintSketchEntityHover(next, true);
  }

  private paintSketchEntityHover(
    edge: { sketchId: string; entityId: string },
    hovered: boolean,
  ): void {
    this.paintSketchHover(edge.sketchId, hovered, edge.entityId);
  }

  /** Thickens the whole sketch under the pointer, or one entity of it. */
  private paintSketchHover(sketchId: string, hovered: boolean, entityId?: string): void {
    const entry = this.sketchEntries.find((candidate) => candidate.id === sketchId);
    if (!entry) return;
    entry.group.traverse((object) => {
      if (entityId !== undefined && object.userData.entityId !== entityId) return;
      const material = (object as THREE.Mesh).material as
        LineMaterial | THREE.PointsMaterial | undefined;
      if (!material || !('color' in material)) return;
      const baseColor = object.userData.baseColor as number | undefined;
      if (baseColor === undefined) return;
      if (material instanceof THREE.PointsMaterial) {
        material.color.setHex(hovered ? this.sketchHoverColor() : baseColor);
        material.size = hovered
          ? 5
          : ((object.userData.baseSize as number | undefined) ?? material.size);
      } else {
        material.color.setHex(hovered ? this.sketchHoverColor() : baseColor);
        material.linewidth = hovered
          ? 3
          : ((object.userData.baseWidth as number | undefined) ?? material.linewidth);
      }
    });
  }

  /**
   * Normal selection pick. Unlike tool picking it resolves the detail the user
   * has already opened: the regions of the selected sketch, then a face or edge
   * of a body that is in the selection. Everything else stays object-level.
   */
  private pickSelectionAt(clientX: number, clientY: number): SelectionHit | null {
    const raycaster = this.pointerToRay(clientX, clientY);

    const bodyMeshes = [...this.bodies.values()]
      .filter((entry) => entry.group.visible && entry.interactive)
      .map((entry) => entry.hitMesh);
    const bodyHit = firstUnclippedHit(
      raycaster.intersectObjects(bodyMeshes, false),
      this.sectionClipPlanes,
    );
    const section = this.pickSectionAt(raycaster, bodyHit);
    const bodyId = section?.bodyId ?? (bodyHit?.object.userData.bodyId as string | undefined);
    const entry = bodyId ? this.bodies.get(bodyId) : undefined;
    const visibleDistance = Math.min(bodyHit?.distance ?? Infinity, section?.distance ?? Infinity);
    // A sketch the user has selected shows its regions; they win over the body
    // the sketch lies on, because the click is meant for the sketch.
    if (this.selectionDetail.sketchId) {
      // An edge is a thin target inside a region, so it wins like a body edge
      // wins over its face.
      const curve = this.pickSketchCurveAt(
        raycaster,
        this.localPoint(clientX, clientY),
        this.selectionDetail.sketchId,
      );
      if (curve && curve.depth <= visibleDistance + 0.5) {
        return { sketchEdge: { sketchId: curve.id, entityId: curve.entityId } };
      }
      const pickers = this.facePickMeshes.filter((mesh) => {
        const data = mesh.userData.sketchFace as { sketchId: string } | undefined;
        return data?.sketchId === this.selectionDetail.sketchId;
      });
      const hit = raycaster.intersectObjects(pickers, false)[0];
      const face = hit?.object.userData.sketchFace as
        { sketchId: string; faceId: string } | undefined;
      if (face && hit!.distance <= visibleDistance + 0.5) {
        return { sketchFace: { sketchId: face.sketchId, faceId: face.faceId } };
      }
    }

    // A cut face belongs to the body as a whole. Once the body is open for
    // detail picking there is no face here to take, so the click takes nothing.
    if (section) {
      const open =
        this.selectionDetail.bodyIds.has(section.bodyId) || this.selectionDetail.geometrySelected;
      if (open) return null;
      return { body: { id: section.bodyId, kind: entry?.kind ?? 'solid' } };
    }

    // A body that is already selected is open, and so is every body while a
    // face or an edge is selected: the click drills into the face or edge under
    // the pointer instead of selecting the object.
    if (
      bodyId &&
      entry &&
      bodyHit &&
      entry.kind === 'solid' &&
      (this.selectionDetail.bodyIds.has(bodyId) || this.selectionDetail.geometrySelected)
    ) {
      const faceId = entry.hitRef.faceIds[bodyHit.faceIndex ?? -1];
      const edgeId = this.pickEdgeAt(entry, clientX, clientY);
      return {
        body: {
          id: bodyId,
          kind: 'solid',
          faceId: faceId === undefined ? undefined : String(faceId),
          edgeId: edgeId ?? undefined,
        },
      };
    }

    const local = this.localPoint(clientX, clientY);
    const curve = this.pickSketchCurveAt(raycaster, local);
    // A sketch behind a solid is not visible, so it cannot be clicked.
    if (curve && curve.depth <= visibleDistance + 0.5) {
      return { sketch: { id: curve.id } };
    }

    if (bodyId && entry) return { body: { id: bodyId, kind: entry.kind } };
    return null;
  }

  private localPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private projectWorld(point: THREE.Vector3): { x: number; y: number; depth: number } {
    const projected = point.clone().project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.width,
      y: (-projected.y * 0.5 + 0.5) * this.height,
      depth: point.clone().applyMatrix4(this.camera.matrixWorldInverse).z,
    };
  }

  /** Nearest vertex of one body in screen space, within a click tolerance. */
  private pickVertexAt(
    entry: BodyEntry,
    bodyId: string,
    clientX: number,
    clientY: number,
  ): ScenePick | null {
    const elements = bodyElements(entry.hitRef);
    if (elements.vertices.size === 0) return null;
    const local = this.localPoint(clientX, clientY);
    let best: { distance: number; elementId: string; point: THREE.Vector3 } | null = null;
    for (const [elementId, position] of elements.vertices) {
      const point = new THREE.Vector3(position[0], position[1], position[2]);
      const projected = this.projectWorld(point);
      const distance = Math.hypot(local.x - projected.x, local.y - projected.y);
      if (distance > 8) continue;
      if (!best || distance < best.distance) best = { distance, elementId, point };
    }
    if (!best) return null;
    if (!this.isEdgePointVisible(entry, best.point)) return null;
    return {
      kind: 'body-vertex',
      bodyId,
      elementId: best.elementId,
      position: [best.point.x, best.point.y, best.point.z],
    };
  }

  /** Nearest edge of one body in screen space, within a click tolerance. */
  private pickEdgeAt(entry: BodyEntry, clientX: number, clientY: number): string | null {
    const edges = entry.hitRef.edges ?? [];
    if (edges.length === 0) return null;
    const local = this.localPoint(clientX, clientY);
    const candidates = new Map<string, { distance: number; point: THREE.Vector3 }>();
    for (const edge of edges) {
      const points = edge.points;
      const count = points.length / 3;
      if (count < 2) continue;
      let previous: { x: number; y: number; point: THREE.Vector3 } | null = null;
      for (let index = 0; index <= count; index += 1) {
        const source = index === count ? (edge.closed ? 0 : null) : index;
        if (source === null) break;
        const point = new THREE.Vector3(
          points[source * 3]!,
          points[source * 3 + 1]!,
          points[source * 3 + 2]!,
        );
        const projected = this.projectWorld(point);
        if (previous) {
          const dx = projected.x - previous.x;
          const dy = projected.y - previous.y;
          const lengthSquared = dx * dx + dy * dy;
          const t =
            lengthSquared > 0
              ? Math.min(
                  1,
                  Math.max(
                    0,
                    ((local.x - previous.x) * dx + (local.y - previous.y) * dy) / lengthSquared,
                  ),
                )
              : 0;
          const distance = Math.hypot(
            local.x - (previous.x + dx * t),
            local.y - (previous.y + dy * t),
          );
          if (distance <= 6) {
            const best = candidates.get(edge.id);
            if (!best || distance < best.distance) {
              candidates.set(edge.id, {
                distance,
                point: previous.point.clone().lerp(point, t),
              });
            }
          }
        }
        previous = { x: projected.x, y: projected.y, point };
      }
    }
    // An edge only owns the pointer where its line lies on the visible
    // surface: the nearest one can be the far rim of a hole behind a face.
    // Checking visibility costs a raycast per edge, so only the few nearest
    // candidates are worth it; anything further does not want the pointer.
    const ordered = [...candidates.entries()]
      .sort((a, b) => a[1].distance - b[1].distance)
      .slice(0, 3);
    for (const [edgeId, candidate] of ordered) {
      if (this.isEdgePointVisible(entry, candidate.point)) return edgeId;
    }
    return null;
  }

  /** Whether the body encloses a section plane point. */
  private meshContains(entry: BodyEntry, point: THREE.Vector3): boolean {
    const bounds = entry.geometry.boundingBox;
    if (bounds && !bounds.containsPoint(point)) return false;
    return pointInMesh(entry.meshRef, [point.x, point.y, point.z]);
  }

  /**
   * The body whose section cap is the visible surface under the pointer. A
   * cut face is the material a plane removed, so it is not a face of the body:
   * it can only stand for the whole object. Nothing solid the section kept may
   * lie in front of the plane, and the plane point has to be inside the body.
   */
  private pickSectionAt(
    raycaster: THREE.Raycaster,
    bodyHit: THREE.Intersection | undefined,
  ): { bodyId: string; distance: number } | null {
    const limit = bodyHit?.distance ?? Infinity;
    for (const crossing of sectionCrossings(raycaster.ray, this.sectionClipPlanes)) {
      if (crossing.distance >= limit) break;
      const point = new THREE.Vector3(...crossing.point);
      for (const [id, entry] of this.bodies) {
        if (!entry.group.visible || !entry.interactive) continue;
        if (!this.meshContains(entry, point)) continue;
        return { bodyId: id, distance: crossing.distance };
      }
    }
    return null;
  }

  /** Whether a visible cut hides a point of the body at this ray depth. */
  private isCutInFront(
    raycaster: THREE.Raycaster,
    depth: number,
    mesh: TessellationResult,
  ): boolean {
    for (const crossing of sectionCrossings(raycaster.ray, this.sectionClipPlanes)) {
      if (crossing.distance >= depth) break;
      const [x, y, z] = crossing.point;
      const { min, max } = mesh.bbox;
      if (x < min[0] || y < min[1] || z < min[2] || x > max[0] || y > max[1] || z > max[2]) {
        continue;
      }
      if (pointInMesh(mesh, crossing.point)) return true;
    }
    return false;
  }

  private isEdgePointVisible(entry: BodyEntry, point: THREE.Vector3): boolean {
    const ndc = point.clone().project(this.camera);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const hit = firstUnclippedHit(
      raycaster.intersectObject(entry.hitMesh, false),
      this.sectionClipPlanes,
    );
    const depth = point.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction);
    // A cut face is a surface like any other: it hides the edges behind it.
    if (this.isCutInFront(raycaster, depth, entry.meshRef)) return false;
    if (!hit) return true;
    return hit.distance >= depth - Math.max(1e-3, this.distance * 1e-4);
  }

  /** Nearest visible sketch curve in screen space. */
  private pickSketchCurveAt(
    raycaster: THREE.Raycaster,
    local: { x: number; y: number },
    sketchId?: string,
  ): { id: string; entityId: string; depth: number } | null {
    let best: { id: string; entityId: string; distance: number; depth: number } | null = null;
    const byId = new Map(this.sketchData.map((sketch) => [sketch.id, sketch]));
    for (const entry of this.sketchEntries) {
      if (!entry.group.visible || entry.active) continue;
      if (sketchId && entry.id !== sketchId) continue;
      const sketch = byId.get(entry.id);
      if (!sketch) continue;
      for (const entity of sketch.entities) {
        if (entity.construction && !sketch.showConstruction) continue;
        const points = tessellateEntity(entity, 24);
        for (let index = 0; index + 1 < points.length; index += 1) {
          const a = this.sketchWorld(entry.frame, points[index]!);
          const b = this.sketchWorld(entry.frame, points[index + 1]!);
          const pa = this.projectWorld(a);
          const pb = this.projectWorld(b);
          const distance = pointSegmentDistance([local.x, local.y], [pa.x, pa.y], [pb.x, pb.y]);
          if (distance > 6) continue;
          const depth = Math.min(
            a.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction),
            b.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction),
          );
          if (!best || distance < best.distance) {
            best = { id: entry.id, entityId: entity.id, distance, depth };
          }
        }
      }
    }
    return best;
  }

  private pickBodyAt(clientX: number, clientY: number): string | null {
    const pick = this.pickSceneAt(clientX, clientY);
    return pick?.kind === 'body' ? pick.id : null;
  }

  /** Object under the pointer: a sketch line in front, otherwise a body. */
  private pickObjectAt(
    clientX: number,
    clientY: number,
  ): { kind: 'body' | 'mesh' | 'sketch'; id: string } | null {
    const pick = this.pickSceneAt(clientX, clientY, false, false, true, true);
    if (pick?.kind === 'sketch-edge') return { kind: 'sketch', id: pick.sketchId };
    if (pick?.kind === 'body' || pick?.kind === 'mesh') return { kind: pick.kind, id: pick.id };
    return null;
  }

  /**
   * The pointer always says what a click would take, except while a sketch is
   * being edited: the sketch tools draw their own preview there.
   */
  private get hoverEnabled(): boolean {
    return geometryHoverEnabled(
      this.sketchData.some((sketch) => sketch.active),
      this.faceHighlights.projecting,
    );
  }

  private scheduleHover(clientX: number, clientY: number): void {
    this.hoverPoint = { x: clientX, y: clientY };
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (!this.hoverPoint || !this.hoverEnabled) {
        this.clearGeometryHover();
        return;
      }
      this.updateHover(this.hoverPoint.x, this.hoverPoint.y);
      this.emitGeometryHover(this.hoverPoint.x, this.hoverPoint.y);
    });
  }

  /**
   * Reports the face under the pointer with the whole detail of a tool pick, so
   * the operation behind it can be named. The hover itself stays as it is: an
   * object-level hover still selects the object on a click.
   */
  private emitGeometryHover(clientX: number, clientY: number): void {
    const pick = this.pickSceneAt(clientX, clientY, true, false, true, true);
    const key = pick ? pickKey(pick) : '';
    const previous = this.geometryHover;
    if (
      previous &&
      previous.key === key &&
      Math.hypot(clientX - previous.x, clientY - previous.y) < 3
    ) {
      return;
    }
    if (!previous && !pick) return;
    this.geometryHover = pick ? { key, x: clientX, y: clientY } : null;
    this.callbacks.onGeometryHover?.(pick ? { pick, x: clientX, y: clientY } : null);
  }

  /** The pointer left the geometry: nothing is being pointed at any more. */
  private clearGeometryHover(): void {
    if (!this.geometryHover) return;
    this.geometryHover = null;
    this.callbacks.onGeometryHover?.(null);
  }

  /**
   * Highlights the face or the edge under the pointer of whichever body it hits.
   * The edge picker also takes faces, so an edge wins only while the pointer is
   * near a visible part of its line and the face under it highlights otherwise.
   */
  private hoverBodyDetail(clientX: number, clientY: number): void {
    const pick = this.pickSceneAt(
      clientX,
      clientY,
      true,
      this.faceHighlights.bodyFacesOnly,
      false,
      true,
    );
    const edgeKey = pick?.kind === 'body-edge' ? `${pick.bodyId}#${pick.edgeId}` : null;
    const faceKey =
      !edgeKey && pick?.kind === 'body-face' ? `b:${pick.bodyId}#${pick.faceId}` : null;
    // A curve of a sketch is a pickable edge too: a path or an axis takes it,
    // so it lights up under the pointer like a body edge does.
    const sketchEdge =
      !edgeKey && pick?.kind === 'sketch-edge'
        ? { sketchId: pick.sketchId, entityId: pick.entityId }
        : null;
    if (
      edgeKey === this.hoveredEdgeKey &&
      faceKey === this.hoveredFaceKey &&
      sketchEdge?.entityId === this.hoveredSketchEdge?.entityId &&
      this.hoveredBodyId === null
    ) {
      return;
    }
    this.hoveredBodyId = null;
    this.hoveredFaceKey = faceKey;
    this.setHoveredSketch(null);
    this.canvas.style.cursor = edgeKey || faceKey || sketchEdge ? 'pointer' : '';
    this.setHoveredEdge(edgeKey);
    this.setHoveredSketchEdge(sketchEdge);
    this.applyBodyMaterials();
    this.applyFaceHighlights();
    this.invalidate();
  }

  /** Highlights a whole object, the way a click on it would select it. */
  private hoverObject(objectId: string | null): void {
    if (this.hoveredEdgeKey !== null) this.setHoveredEdge(null);
    if (
      objectId === this.hoveredBodyId &&
      this.hoveredFaceKey === null &&
      this.hoveredSketchId === null
    ) {
      return;
    }
    this.hoveredBodyId = objectId;
    this.hoveredFaceKey = null;
    this.setHoveredSketch(null);
    this.canvas.style.cursor = objectId ? 'pointer' : '';
    this.applyBodyMaterials();
    this.applyFaceHighlights();
    this.invalidate();
  }

  private updateHover(clientX: number, clientY: number): void {
    // Geometry is shown only where a click would take geometry: a tool that
    // picks edges, or a selected face or edge. Handles alone do not open a body:
    // a selected sketch or operation still clicks bodies as objects.
    const hover = {
      geometryMode: this.faceHighlights.edgePicking || this.selectionDetail.geometrySelected,
      openedBodyIds: this.selectionDetail.bodyIds,
    };
    if (this.hoveredEdgeKey !== null) this.setHoveredEdge(null);
    // A selected sketch answers first: its curves and regions are what the next
    // click takes, even while its operation offers handles over the model.
    if (this.selectionDetail.sketchId && this.updateSketchDetailHover(clientX, clientY)) return;
    if (hover.geometryMode) {
      this.hoverBodyDetail(clientX, clientY);
      return;
    }
    if (this.hoveredSketchEdge !== null) this.setHoveredSketchEdge(null);
    if (this.faceHighlights.bodyPicking) {
      const pick = this.pickSceneAt(clientX, clientY, false);
      this.hoverObject(pick?.kind === 'body' ? pick.id : null);
      return;
    }

    // A curve of a sketch is a finer target than the surface under it, so it
    // answers first while objects are selected or edges are being picked. A
    // face picker is not asking for curves: the face under the pointer is.
    const edgesFirst = this.faceHighlights.edgePicking || !this.faceHighlights.picking;
    let pick = this.pickSceneAt(
      clientX,
      clientY,
      true,
      this.faceHighlights.bodyFacesOnly,
      false,
      edgesFirst,
    );
    // A face-picking tool shows the face or region under the pointer itself.
    if (this.faceHighlights.picking) {
      if (pick?.kind === 'face') {
        this.hoverFacePick(`s:${pick.sketchId}#${pick.faceId}`);
        return;
      }
      if (pick?.kind === 'body-face') {
        this.hoverFacePick(`b:${pick.bodyId}#${pick.faceId}`);
        return;
      }
    }
    if (pick?.kind === 'face') {
      // An invisible sketch region can sit in front of the body under it.
      pick = this.pickSceneAt(
        clientX,
        clientY,
        true,
        this.faceHighlights.bodyFacesOnly,
        true,
        edgesFirst,
      );
    }
    if (pick?.kind === 'sketch-edge') {
      this.hoverSketchObject(pick.sketchId);
      return;
    }
    const bodyId =
      pick?.kind === 'body-face' || pick?.kind === 'body-edge'
        ? pick.bodyId
        : pick?.kind === 'body' || pick?.kind === 'mesh'
          ? pick.id
          : null;
    if (bodyId !== null && hoverTargetOf(hover, bodyId) === 'geometry') {
      this.hoverBodyDetail(clientX, clientY);
      return;
    }
    this.hoverObject(bodyId);
  }

  // Sketch faces are invisible picking surfaces: they let the 3D view select a
  // region of a sketch the same way the tree does.
  private addSketchFacePickers(group: THREE.Group, sketch: SceneSketch): void {
    if (sketch.faces.length === 0) return;
    const [ox, oy, oz] = sketch.frame.origin;
    const [xx, xy, xz] = sketch.frame.xAxis;
    const [yx, yy, yz] = sketch.frame.yAxis;
    const [nx, ny, nz] = sketch.frame.normal;
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(xx, xy, xz),
      new THREE.Vector3(yx, yy, yz),
      new THREE.Vector3(nx, ny, nz),
    );
    for (const face of sketch.faces) {
      const shape = new THREE.Shape(
        face.outline.map((point) => new THREE.Vector2(point[0], point[1])),
      );
      for (const hole of face.holes) {
        shape.holes.push(
          new THREE.Path(hole.map((point) => new THREE.Vector2(point[0], point[1]))),
        );
      }
      const material = new THREE.MeshBasicMaterial({
        color: this.sketchHighlightColor(),
        transparent: true,
        opacity: sketch.facesPicking ? 0.12 : 0,
        depthWrite: false,
        // The fill lies exactly on the sketch plane, which may also be a
        // section plane: the bias keeps the fill above the hatching.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
      mesh.renderOrder = RenderOrder.sketchFace;
      mesh.matrixAutoUpdate = false;
      mesh.matrix
        .copy(basis)
        .setPosition(
          ox + nx * SKETCH_FACE_LIFT,
          oy + ny * SKETCH_FACE_LIFT,
          oz + nz * SKETCH_FACE_LIFT,
        );
      mesh.updateMatrixWorld(true);
      mesh.userData.sketchFace = { sketchId: sketch.id, faceId: face.id };
      group.add(mesh);
      this.facePickMeshes.push(mesh);
      this.sketchFaceMaterials.set(`s:${sketch.id}#${face.id}`, material);
    }
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.transition = null;
    const scheme = cameraScheme(useUiStore.getState().cameraScheme);
    const kind = this.pointerKind(event);
    // A pinch reaches the page as the wheel with Ctrl held, whatever the device.
    if (event.ctrlKey) {
      this.zoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * PINCH_ZOOM_RATE));
      return;
    }
    if (kind === 'trackpad' && scheme.scrollOrbits) {
      // Two fingers scroll: the same scroll pans with Shift held, and the pinch
      // above zooms. The directions are the reverse of dragging the model, which
      // is how Blender turns a trackpad.
      if (event.shiftKey) {
        this.panBy(-event.deltaX, -event.deltaY);
        this.updateCamera();
      } else if (this.facesSketchPlane()) {
        // In a sketch the view stays on the plane: the same two fingers move the
        // sheet instead of turning it away.
        this.panBy(-event.deltaX, -event.deltaY);
        this.updateCamera();
      } else {
        this.orbit(
          -event.deltaX,
          -event.deltaY,
          this.orbitPivotAt(event.clientX, event.clientY),
          SCROLL_RADIANS_PER_PIXEL,
        );
      }
      return;
    }
    const ratio = Math.exp(event.deltaY * (kind === 'mouse' ? WHEEL_ZOOM_RATE : SCROLL_ZOOM_RATE));
    if (scheme.zoomToCursor) {
      this.zoomAt(event.clientX, event.clientY, ratio);
      return;
    }
    this.distance = clamp(this.distance * ratio, 0.05, 10_000_000);
    this.updateCamera();
  };

  /** The device behind a wheel event, remembered for the next one. */
  private pointerKind(event: WheelEvent): PointerKind {
    const preference = useUiStore.getState().inputPreference;
    noteWheelKind(wheelPointerKind(event));
    return resolvedPointerKind(preference);
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const object = this.pickObjectAt(event.clientX, event.clientY);
    this.onObjectContextMenu?.(object, event.clientX, event.clientY);
  };

  private onPointerLeave = (): void => {
    this.clearGeometryHover();
    if (this.hoveredHandleId !== null) {
      this.hoveredHandleId = null;
      this.canvas.style.cursor = '';
      this.applyHandleStyles();
      this.callbacks.onHandleHover?.(null);
      this.invalidate();
    }
    this.hoverPoint = null;
    if (
      this.hoveredFaceKey === null &&
      this.hoveredBodyId === null &&
      this.hoveredSketchEdge === null &&
      this.hoveredSketchId === null
    ) {
      return;
    }
    this.hoveredFaceKey = null;
    this.hoveredBodyId = null;
    this.setHoveredSketchEdge(null);
    this.setHoveredSketch(null);
    this.canvas.style.cursor = '';
    this.applyBodyMaterials();
    this.applyFaceHighlights();
    this.invalidate();
  };

  private invalidate(): void {
    this.needsRender = true;
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    if (this.transition) this.stepTransition(performance.now());
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);

    this.renderer.autoClear = false;
    if (this.sectionEntries.length > 0) {
      for (const entry of this.sectionEntries) {
        for (const other of this.sectionEntries) other.group.visible = other === entry;
        this.renderer.clearStencil();
        this.renderer.render(this.sectionScene, this.camera);
      }
      for (const entry of this.sectionEntries) entry.group.visible = false;
      this.renderer.clearStencil();
    }
    // Annotations come last: hatching stays behind deltas, sketch fills, face
    // tints and handles. The depth buffer still holds the solid model, so they
    // remain correctly hidden by material in front of them.
    this.renderer.render(this.overlayScene, this.camera);
    this.renderer.autoClear = true;
  };
}
