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
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { SketchSnap } from '../sketch/snap';
import type { PreviewFaceMark, PreviewMarkKind, SceneGhost } from '../stores/kernelStore';
import {
  CAMERA_FOV_DEGREES,
  cameraFrustum,
  easeInOut,
  fitDistance,
  shortestAngle,
} from './cameraFit';
import type {
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
import { RenderOrder } from './renderOrder';
import { firstUnclippedHit } from './sectionPick';
import { SKETCH_SECTION_ID } from '../sketch/sectionPlane';
import { handleDragValue } from '../quick/handleDrag';
import { outwardNormal } from '../quick/geometry';
import type { SelectionHit } from './selectionPick';

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
const SKETCH_FACE_LIFT = 0.02;
// Faces that lie exactly on a section plane are rejected per fragment on
// floating-point noise, which draws them as stripes. The extra thousandth of a
// millimetre keeps such faces whole.
const SECTION_CLIP_BIAS = 0.01;

export interface SceneBody {
  id: string;
  kind: 'solid' | 'mesh';
  mesh: TessellationResult;
  color: string;
  visible: boolean;
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
  meshRef: TessellationResult;
  /** Mesh and tessellation used for picking (the input model during a preview). */
  hitMesh: THREE.Mesh;
  hitGeometry: THREE.BufferGeometry | null;
  hitRef: TessellationResult;
  color: string;
  ghost: PreviewMarkKind | null;
  translucent: boolean;
  interactive: boolean;
}

const FOV_DEGREES = CAMERA_FOV_DEGREES;
const CAMERA_TRANSITION_MS = 500;

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
}

interface CameraPose {
  target: THREE.Vector3;
  distance: number;
  azimuth: number;
  polar: number;
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

export class SceneController {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly bodies = new Map<string, BodyEntry>();
  private readonly resizeObserver: ResizeObserver;
  private grid: THREE.GridHelper;
  private readonly sectionScene = new THREE.Scene();
  /** Transparent annotations drawn after the section caps. */
  private readonly overlayScene = new THREE.Scene();
  private readonly capGeometry = new THREE.PlaneGeometry(4000, 4000);
  private sectionPlanes: SectionPlane[] = [];
  private sectionClipPlanes: THREE.Plane[] = [];
  private sectionEntries: { group: THREE.Group; cap: THREE.Mesh; materials: THREE.Material[] }[] =
    [];
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
    { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; geometry: THREE.BufferGeometry }
  >();
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
  } = {
    selected: new Set(),
    invalid: new Set(),
    picking: false,
    bodyPicking: false,
    bodyFacesOnly: false,
    edgePicking: false,
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
  private distance = 200;
  private azimuth = -Math.PI / 4;
  private polar = Math.PI / 3;
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
    startedAt: number;
    duration: number;
  } | null = null;
  /** Bodies and sketch opened by the current selection, used for detail picking. */
  private selectionDetail: { bodyIds: Set<string>; sketchId: string | null } = {
    bodyIds: new Set(),
    sketchId: null,
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
  private edgeHoverEntries: Array<{ line: Line2; material: LineMaterial }> = [];
  private handleDrag: {
    id: string;
    /** Value when the pointer went down. */
    value: number;
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
    private readonly onBodyContextMenu?: (bodyId: string | null, x: number, y: number) => void,
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
      }) => void;
      /** Handle under the pointer, or null when it leaves the handle. */
      onHandleHover?: (event: {
        id: string;
        x: number;
        y: number;
        text: string;
      } | null) => void;
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

    for (const body of bodies) {
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
      entry.group.visible = body.visible;
      entry.kind = body.kind;
      entry.color = body.color;
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
  }): void {
    this.selectionDetail = {
      bodyIds: new Set(detail.bodyIds),
      sketchId: detail.sketchId ?? null,
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
    return this.ghostSources.map((ghost) => ({
      id: ghost.id,
      color: ghost.color,
      bbox: ghost.mesh.bbox,
    }));
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
      };
    });
  }

  /** Handles are blue; selection stays purple. */
  private handleColor(): number {
    return this.theme === 'dark' ? 0x3b82f6 : 0x2563eb;
  }

  /** The space behind the model: a hairline of it keeps handles readable. */
  private handleOutlineColor(): number {
    return this.theme === 'dark' ? 0x0c0e12 : 0xffffff;
  }

  /** Projected arrow of a handle, using the same length the user sees. */
  private handleScreenGeometry(
    handle: SceneHandle,
  ): { origin: { x: number; y: number }; tip: { x: number; y: number } } | null {
    const origin = new THREE.Vector3(...handle.origin);
    const direction = new THREE.Vector3(...handle.direction);
    if (direction.lengthSq() < 1e-12) return null;
    direction.normalize();
    const arrowDirection = handle.value < 0 ? direction.clone().negate() : direction;
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const minimum = 18 * worldPerPixel;
    const length =
      handle.value === 0
        ? HANDLE_IDLE_PX * worldPerPixel
        : Math.max(Math.abs(handle.value), minimum);
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
      if (!this.handleScreenGeometry(handle)) continue;
      this.addArrowHandle(handle);
    }
  }

  private addArrowHandle(handle: SceneHandle): void {
    const worldPerPixel = 1 / this.pixelsPerWorldUnit();
    const origin = new THREE.Vector3(...handle.origin);
    const direction = new THREE.Vector3(...handle.direction).normalize();
    const arrowDirection = handle.value < 0 ? direction.clone().negate() : direction;
    const length =
      handle.value === 0
        ? HANDLE_IDLE_PX * worldPerPixel
        : Math.max(Math.abs(handle.value), 18 * worldPerPixel);
    const tip = origin.clone().addScaledVector(arrowDirection, length);
    const coneHeight = Math.min(12 * worldPerPixel, length * 0.7);
    const base = tip.clone().addScaledVector(arrowDirection, -coneHeight);
    const hovered = this.hoveredHandleId === handle.id;
    const color = hovered ? 0xffffff : this.handleColor();
    const thickness = handle.thickness ?? 1;
    // The body under a handle can be the same blue, so the whole arrow is drawn
    // a pixel wider in the colour of the space behind it.
    const outlineColor = this.handleOutlineColor();
    const halo = worldPerPixel;

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
    const outline = makeLine(outlineColor, linewidth + 2, RenderOrder.handleOutline);
    const line = makeLine(color, linewidth, RenderOrder.handle);
    const material = line.material as LineMaterial;

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

    const anchorMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const anchorRadius = Math.max(0.001, 3.4 * thickness * worldPerPixel);
    const anchor = new THREE.Mesh(new THREE.SphereGeometry(anchorRadius, 14, 10), anchorMaterial);
    anchor.position.copy(origin);
    anchor.renderOrder = RenderOrder.handle;
    anchor.userData.handleId = handle.id;

    const outlineAnchor = new THREE.Mesh(
      new THREE.SphereGeometry(anchorRadius + halo, 14, 10),
      new THREE.MeshBasicMaterial({
        color: outlineColor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    outlineAnchor.position.copy(origin);
    outlineAnchor.renderOrder = RenderOrder.handleOutline;
    outlineAnchor.userData.handleId = handle.id;

    this.handleGroup.add(outline, line, outlineCone, cone, outlineAnchor, anchor);
    this.handleEntries.push({
      handle,
      objects: [outline, line, outlineCone, cone, outlineAnchor, anchor],
      colors: [material, coneMaterial, anchorMaterial],
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
      const color = hovered ? 0xffffff : this.handleColor();
      for (const target of entry.colors) target.color.setHex(color);
      const linewidth = hovered ? 2.6 : 1.8;
      if (entry.material) entry.material.linewidth = linewidth;
      if (entry.outlineMaterial) entry.outlineMaterial.linewidth = linewidth + 2;
    }
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
    let best: {
      handle: SceneHandle;
      axisX: number;
      axisY: number;
      pixelsPerMm: number;
      distance: number;
      tipDistance: number;
    } | null = null;
    for (const handle of this.handleData) {
      if (!handle.enabled) continue;
      const projected = this.handleScreenGeometry(handle);
      if (!projected) continue;
      const direction = new THREE.Vector3(...handle.direction).normalize();
      const unit = this.projectWorld(
        new THREE.Vector3(...handle.origin).add(direction),
      );
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
    this.transition = null;
    this.dragMode = 'handle';
    this.pointerDown = null;
    this.pointerMoved = false;
    this.handleDrag = {
      id: hit.handle.id,
      value: hit.handle.value,
      lastValue: hit.handle.value,
      startX: event.clientX,
      startY: event.clientY,
      axisX: hit.axisX,
      axisY: hit.axisY,
      pixelsPerMm: hit.pixelsPerMm,
      pointerId: event.pointerId,
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
  ): void {
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
      geometry.setPositions(positions);
      const material = new LineMaterial({
        color,
        linewidth,
        transparent: true,
        opacity,
        depthTest: false,
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
   * thin lines of a body are hard to aim at.
   */
  private setHoveredEdge(key: string | null): void {
    if (key === this.hoveredEdgeKey) return;
    this.hoveredEdgeKey = key;
    this.clearEdgeLines(this.edgeHoverEntries);
    if (key) {
      this.drawEdgeLines(this.edgeHoverEntries, [key], 4.6, 0.55, this.sketchHoverColor());
    }
    this.invalidate();
  }

  private applyBodyMaterials(): void {
    for (const entry of this.bodies.values()) {
      if (entry.ghost) {
        this.applyGhostBody(entry);
        continue;
      }
      this.applySolidMaterial(entry);
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
  }

  private applySolidMaterial(entry: BodyEntry): void {
    const id = entry.mesh.userData.bodyId as string;
    entry.material.transparent = false;
    entry.material.depthTest = true;
    entry.material.depthWrite = true;
    entry.material.polygonOffset = false;
    entry.material.polygonOffsetFactor = 0;
    entry.material.polygonOffsetUnits = 0;
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
    for (const [id, entry] of this.ghostEntries) {
      this.ghostGroup.remove(entry.mesh);
      entry.geometry.dispose();
      entry.material.dispose();
      this.ghostEntries.delete(id);
    }
    for (const ghost of ghosts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(ghost.mesh.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(ghost.mesh.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(ghost.mesh.indices, 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = this.createGhostMaterial(ghost);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = RenderOrder.delta;
      this.ghostGroup.add(mesh);
      this.ghostEntries.set(ghost.id, { mesh, material, geometry });
    }
    this.updateGhostFades();
    this.invalidate();
  }

  private createGhostMaterial(ghost: SceneGhost): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ghost.color),
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      // A ghost touches the body at coincident faces. A small depth bias makes
      // the shared triangles win consistently instead of shimmering, while the
      // ghost is still hidden by material actually in front of it.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
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
      if (entry.edges && entry.ghost !== 'removed') {
        (entry.edges.material as THREE.LineBasicMaterial).color.setHex(this.edgeColor);
      }
    }

    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.grid = this.createGrid();
    this.scene.add(this.grid);
    if (this.sectionPlanes.length > 0) this.rebuildSection();
    if (this.sketchData.length > 0) this.setSketches(this.sketchData);
    if (this.handleData.length > 0) this.updateHandles();
    this.invalidate();
  }

  fit(): void {
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
      this.transitionTo({
        target: new THREE.Vector3(0, 0, 0),
        distance: 200,
        azimuth: this.azimuth,
        polar: this.polar,
      });
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.001, size.length() / 2);
    this.transitionTo({
      target: center,
      distance: (radius * 1.35) / Math.tan((FOV_DEGREES * Math.PI) / 180 / 2),
      azimuth: this.azimuth,
      polar: this.polar,
    });
  }

  setView(name: ViewName): void {
    let azimuth = this.azimuth;
    let polar = this.polar;
    switch (name) {
      case 'front':
        azimuth = -Math.PI / 2;
        polar = Math.PI / 2;
        break;
      case 'back':
        azimuth = Math.PI / 2;
        polar = Math.PI / 2;
        break;
      case 'right':
        azimuth = 0;
        polar = Math.PI / 2;
        break;
      case 'left':
        azimuth = Math.PI;
        polar = Math.PI / 2;
        break;
      case 'top':
        azimuth = -Math.PI / 2;
        polar = 0.001;
        break;
      case 'bottom':
        azimuth = -Math.PI / 2;
        polar = Math.PI - 0.001;
        break;
      case 'iso':
        azimuth = -Math.PI / 4;
        polar = Math.PI / 3;
        break;
    }
    this.transitionTo({ target: this.target.clone(), distance: this.distance, azimuth, polar });
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
    this.azimuth -= deltaX * 0.008;
    this.polar = clamp(this.polar - deltaY * 0.008, 0.001, Math.PI - 0.001);
    this.updateCamera();
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
        // The circle rim handle is derived from center and radius, so it is not
        // a solver primitive that a coincidence can reference.
        if (entity.type === 'circle' && index === 1) return;
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
      // The axes are unbounded references, so making them snap targets would
      // capture ordinary clicks across the whole sketch. They are constrained
      // by selecting them instead; drawing along one already adds the
      // horizontal or vertical constraint.
      if (isSketchAxisId(entity.id)) continue;
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

  setSketches(sketches: SceneSketch[]): void {
    this.sketchData = sketches;
    this.disposeSketchEntries();
    const editingSketch = sketches.some((sketch) => sketch.active);
    for (const sketch of sketches) {
      const group = new THREE.Group();
      group.renderOrder = RenderOrder.sketch;
      if (sketch.active) this.addSketchGrid(group, sketch.frame);
      const selected = new Set(sketch.selectionKeys.filter((key) => !key.includes('#')));
      const dimmed = new Set(sketch.dimmedEntityIds);
      const frozen = new Set(sketch.frozenEntityIds);
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
          highlighted.has(entity.id),
          highlightedPoints.get(entity.id) ?? new Set<number>(),
          hovered.has(entity.id),
          hoveredPoints.get(entity.id) ?? new Set<number>(),
          editingSketch && !sketch.active,
          sketch.active ? null : tint,
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
    };
  }

  setCameraState(state: ViewportCamera): void {
    this.transitionTo({
      target: new THREE.Vector3(...state.target),
      distance: state.distance,
      azimuth: state.azimuth,
      polar: state.polar,
    });
  }

  alignSketch(frame: SketchFrame, entities: readonly SketchEntity[] = []): void {
    const [nx, ny, nz] = frame.normal;
    const length = Math.hypot(nx, ny, nz) || 1;
    // Look straight along the sketch normal, including tilted faces. The tiny
    // clamps avoid the singular poles where the orbit basis flips.
    const azimuth = Math.atan2(ny / length, nx / length);
    const polar = clamp(Math.acos(nz / length), 0.001, Math.PI - 0.001);
    this.transitionTo(this.sketchPose(frame, entities, azimuth, polar));
  }

  // Frames the sketch content with a fixed margin on both sides of the viewport.
  private sketchPose(
    frame: SketchFrame,
    entities: readonly SketchEntity[],
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
    for (const entity of entities) {
      for (const point of tessellateEntity(entity)) {
        const world = sketchPointToWorld(frame, point);
        offset.set(world[0], world[1], world[2]).sub(origin);
        const u = offset.dot(right);
        const v = offset.dot(up);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
    }
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
    };
    this.transition = {
      from,
      to: pose,
      azimuthDelta: shortestAngle(from.azimuth, pose.azimuth),
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
    highlighted: boolean,
    highlightedPoints: ReadonlySet<number>,
    hovered: boolean,
    hoveredPoints: ReadonlySet<number>,
    background: boolean,
    tint: number | null,
  ): void {
    const color = selected
      ? this.sketchSelectedColor()
      : hovered
        ? this.sketchHoverColor()
        : highlighted
          ? this.sketchHighlightColor()
          : frozen
            ? this.sketchFrozenLineColor()
            : entity.construction
              ? this.sketchConstructionColor()
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
        dimmed ? 0.2 : 1,
        entity.construction,
      );
      if (line) {
        line.userData.entityId = entity.id;
        group.add(line);
      }
    }
    const controlPoints = this.sketchControlPoints(entity);
    controlPoints.forEach((point, index) => {
      const pointHighlighted = highlighted || highlightedPoints.has(index);
      const pointHovered = hovered || hoveredPoints.has(index);
      const selectedPoint = selected || selectedPoints.has(index);
      const geometry = new THREE.BufferGeometry().setFromPoints([this.sketchWorld(frame, point)]);
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: selectedPoint
            ? this.sketchSelectedColor()
            : pointHovered
              ? this.sketchHoverColor()
              : pointHighlighted
                ? this.sketchHighlightColor()
                : frozen
                  ? this.sketchFrozenPointColor()
                  : this.sketchPointColor(),
          map: this.pointTexture,
          alphaTest: 0.5,
          transparent: true,
          opacity: dimmed ? 0.25 : 1,
          size: selectedPoint ? 6 : pointHovered ? 5 : pointHighlighted ? 6 : 4,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      points.renderOrder =
        selectedPoint || pointHovered || pointHighlighted
          ? RenderOrder.sketchPointActive
          : RenderOrder.sketchPoint;
      points.userData.entityId = entity.id;
      points.userData.pointIndex = index;
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
      depthTest: false,
      depthWrite: false,
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
      if (entry.edges) {
        (entry.edges.material as THREE.LineBasicMaterial).clippingPlanes = planes;
        (entry.edges.material as THREE.LineBasicMaterial).needsUpdate = true;
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

    const background = new THREE.Color(this.theme === 'dark' ? 0x0d1015 : 0xffffff);
    const highlight = new THREE.Color(this.theme === 'dark' ? 0xffffff : 0x000000);

    this.sectionPlanes.forEach((section, index) => {
      const effectiveNormal = new THREE.Vector3(...section.normal).normalize();
      const point = new THREE.Vector3(...section.origin).addScaledVector(
        effectiveNormal,
        section.offset,
      );
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(effectiveNormal, point);
      for (const body of this.bodies.values()) {
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

        const color = body.material.color;
        const fill = color.clone().lerp(background, 0.55);
        const line = color.clone().lerp(highlight, this.theme === 'dark' ? 0.2 : 0.25);

        const capMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uPixelRatio: { value: this.renderer.getPixelRatio() },
            uSpacing: { value: HATCH_SPACING_PX },
            // The sketch plane is a working surface, not a material section:
            // a flat fill keeps the sketch and its face tint readable.
            uHatch: { value: section.id === SKETCH_SECTION_ID ? 0 : 1 },
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
        this.sectionEntries.push({ group, cap, materials: [back, front, capMaterial] });
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
      entry.geometry.dispose();
      entry.material.dispose();
    }
    this.ghostEntries.clear();
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
    if (body.mesh.triangleCount <= 250_000) {
      edgeGeometry = new THREE.EdgesGeometry(geometry, 20);
      edges = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: this.edgeColor }),
      );
      group.add(edges);
    }

    const entry: BodyEntry = {
      group,
      kind: body.kind,
      mesh,
      geometry,
      material,
      edges,
      edgeGeometry,
      meshRef: body.mesh,
      hitMesh: mesh,
      hitGeometry: null,
      hitRef: body.mesh,
      color: body.color,
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
    for (const entry of this.ghostEntries.values()) collect(entry.geometry);
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
    this.camera.up.set(0, 0, 1);
    if (Math.abs(Math.cos(this.polar)) > 0.999) {
      this.camera.up.set(0, 1, 0);
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
    // A handle is grabbed before orbit, pan or selection, but not while a
    // picking tool owns the pointer. Shift is the second edge treatment kind,
    // so it must not turn a grab into a pan.
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
        return;
      }
    }
    if (event.button === 0) {
      this.pointerDown = { x: event.clientX, y: event.clientY };
      this.pointerMoved = false;
    }

    const wantsPan =
      event.button === 2 || ((event.button === 0 || event.button === 1) && event.shiftKey);
    const wantsOrbit = event.button === 1 || (event.button === 0 && event.altKey);
    if (wantsPan) this.dragMode = 'pan';
    else if (wantsOrbit) this.dragMode = 'orbit';
    else return;

    event.preventDefault();
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.dragMode === 'handle' && this.handleDrag) {
      const drag = this.handleDrag;
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
        // geometry under the pointer is what a click would add.
        if (this.handleData.length > 0 && this.hoveredHandleId === null) {
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
      this.azimuth -= dx * 0.008;
      this.polar = clamp(this.polar - dy * 0.008, 0.001, Math.PI - 0.001);
      this.updateCamera();
      return;
    }

    const unitsPerPixel = (this.camera.top - this.camera.bottom) / this.height;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * unitsPerPixel);
    this.target.addScaledVector(up, dy * unitsPerPixel);
    this.updateCamera();
  };

  private onPointerUp = (event: PointerEvent): void => {
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
          Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= DOUBLE_CLICK_SLOP_PX;
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
        const additive = event.metaKey || event.ctrlKey || event.shiftKey;
        // Tool picking keeps its own contract; normal selection drills from the
        // object into its faces and edges.
        const toolPicking = this.faceHighlights.picking || this.faceHighlights.bodyPicking;
        if (toolPicking || !this.callbacks.onSelectPick) {
          const pick = this.pickSceneAt(
            event.clientX,
            event.clientY,
            this.faceHighlights.picking,
            this.faceHighlights.bodyFacesOnly,
          );
          this.onPick?.(pick, additive);
        } else {
          this.callbacks.onSelectPick(this.pickSelectionAt(event.clientX, event.clientY), additive);
        }
      }
    }
  };

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
    // While faces are being picked they win over the solids they produced, so a
    // face stays clickable after it has been extruded.
    if (faces && faceHit && !preferBody) {
      const face = faceHit.object.userData.sketchFace as
        { sketchId: string; faceId: string } | undefined;
      if (face) return { kind: 'face', sketchId: face.sketchId, faceId: face.faceId };
    }
    if (bodyHit) {
      const bodyId = bodyHit.object.userData.bodyId as string | undefined;
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
    const bodyId = bodyHit?.object.userData.bodyId as string | undefined;
    const entry = bodyId ? this.bodies.get(bodyId) : undefined;

    // A sketch the user has selected shows its regions; they win over the body
    // the sketch lies on, because the click is meant for the sketch.
    if (this.selectionDetail.sketchId) {
      const pickers = this.facePickMeshes.filter((mesh) => {
        const data = mesh.userData.sketchFace as { sketchId: string } | undefined;
        return data?.sketchId === this.selectionDetail.sketchId;
      });
      const hit = raycaster.intersectObjects(pickers, false)[0];
      const face = hit?.object.userData.sketchFace as
        { sketchId: string; faceId: string } | undefined;
      if (face && (!bodyHit || hit!.distance <= bodyHit.distance + 0.5)) {
        return { sketchFace: { sketchId: face.sketchId, faceId: face.faceId } };
      }
    }

    // A body that is already selected is open: the click drills into its face
    // or edge instead of selecting the object again.
    if (bodyId && entry && bodyHit && this.selectionDetail.bodyIds.has(bodyId) && entry.kind === 'solid') {
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
    if (curve && (!bodyHit || curve.depth <= bodyHit.distance + 0.5)) {
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

  /** Nearest edge of one body in screen space, within a click tolerance. */
  private pickEdgeAt(entry: BodyEntry, clientX: number, clientY: number): string | null {
    const edges = entry.hitRef.edges ?? [];
    if (edges.length === 0) return null;
    const local = this.localPoint(clientX, clientY);
    let best: { id: string; distance: number } | null = null;
    for (const edge of edges) {
      const points = edge.points;
      const count = points.length / 3;
      if (count < 2) continue;
      let previous: { x: number; y: number } | null = null;
      for (let index = 0; index <= count; index += 1) {
        const source = index === count ? (edge.closed ? 0 : null) : index;
        if (source === null) break;
        const projected = this.projectWorld(
          new THREE.Vector3(points[source * 3]!, points[source * 3 + 1]!, points[source * 3 + 2]!),
        );
        if (previous) {
          const distance = pointSegmentDistance(
            [local.x, local.y],
            [previous.x, previous.y],
            [projected.x, projected.y],
          );
          if (distance <= 6 && (!best || distance < best.distance)) {
            best = { id: edge.id, distance };
          }
        }
        previous = { x: projected.x, y: projected.y };
      }
    }
    return best?.id ?? null;
  }

  /** Nearest visible sketch curve in screen space. */
  private pickSketchCurveAt(
    raycaster: THREE.Raycaster,
    local: { x: number; y: number },
  ): { id: string; depth: number } | null {
    let best: { id: string; distance: number; depth: number } | null = null;
    const byId = new Map(this.sketchData.map((sketch) => [sketch.id, sketch]));
    for (const entry of this.sketchEntries) {
      if (!entry.group.visible || entry.active) continue;
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
          const distance = pointSegmentDistance(
            [local.x, local.y],
            [pa.x, pa.y],
            [pb.x, pb.y],
          );
          if (distance > 6) continue;
          const depth = Math.min(
            a.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction),
            b.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction),
          );
          if (!best || distance < best.distance) best = { id: entry.id, distance, depth };
        }
      }
    }
    return best;
  }

  private pickBodyAt(clientX: number, clientY: number): string | null {
    const pick = this.pickSceneAt(clientX, clientY);
    return pick?.kind === 'body' ? pick.id : null;
  }

  private pickObjectIdAt(clientX: number, clientY: number): string | null {
    const pick = this.pickSceneAt(clientX, clientY);
    return pick?.kind === 'body' || pick?.kind === 'mesh' ? pick.id : null;
  }

  /**
   * What the pointer is over matters while a tool is picking it, and while a
   * selection shows its handles: the same highlight then says what a click
   * would add.
   */
  private get hoverEnabled(): boolean {
    return (
      this.faceHighlights.picking ||
      this.faceHighlights.bodyPicking ||
      this.handleData.length > 0
    );
  }

  private scheduleHover(clientX: number, clientY: number): void {
    this.hoverPoint = { x: clientX, y: clientY };
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (!this.hoverPoint || !this.hoverEnabled) return;
      this.updateHover(this.hoverPoint.x, this.hoverPoint.y);
    });
  }

  private updateHover(clientX: number, clientY: number): void {
    // The edge picker also takes faces, so an edge wins only while the pointer
    // is near its line and the face under it highlights otherwise.
    if (this.faceHighlights.edgePicking || this.handleData.length > 0) {
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
      if (
        edgeKey === this.hoveredEdgeKey &&
        faceKey === this.hoveredFaceKey &&
        this.hoveredBodyId === null
      ) {
        return;
      }
      this.hoveredBodyId = null;
      this.hoveredFaceKey = faceKey;
      this.canvas.style.cursor = edgeKey || faceKey ? 'pointer' : '';
      this.setHoveredEdge(edgeKey);
      this.applyBodyMaterials();
      this.applyFaceHighlights();
      this.invalidate();
      return;
    }
    if (this.hoveredEdgeKey !== null) this.setHoveredEdge(null);
    if (this.faceHighlights.bodyPicking) {
      const pick = this.pickSceneAt(clientX, clientY, false);
      const bodyId = pick?.kind === 'body' ? pick.id : null;
      if (bodyId === this.hoveredBodyId) return;
      this.hoveredBodyId = bodyId;
      this.hoveredFaceKey = null;
      this.canvas.style.cursor = bodyId ? 'pointer' : '';
      this.applyBodyMaterials();
      this.applyFaceHighlights();
      this.invalidate();
      return;
    }

    const pick = this.pickSceneAt(clientX, clientY, true, this.faceHighlights.bodyFacesOnly);
    const key =
      pick?.kind === 'face'
        ? `s:${pick.sketchId}#${pick.faceId}`
        : pick?.kind === 'body-face'
          ? `b:${pick.bodyId}#${pick.faceId}`
          : null;
    if (key === this.hoveredFaceKey && this.hoveredBodyId === null) return;
    this.hoveredBodyId = null;
    this.hoveredFaceKey = key;
    this.canvas.style.cursor = key ? 'pointer' : '';
    this.applyBodyMaterials();
    this.applyFaceHighlights();
    this.invalidate();
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
    const factor = Math.exp(event.deltaY * 0.0012);
    this.distance = clamp(this.distance * factor, 0.05, 10_000_000);
    this.updateCamera();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const bodyId = this.pickObjectIdAt(event.clientX, event.clientY);
    this.onBodyContextMenu?.(bodyId, event.clientX, event.clientY);
  };

  private onPointerLeave = (): void => {
    if (this.hoveredHandleId !== null) {
      this.hoveredHandleId = null;
      this.canvas.style.cursor = '';
      this.applyHandleStyles();
      this.callbacks.onHandleHover?.(null);
      this.invalidate();
    }
    this.hoverPoint = null;
    if (this.hoveredFaceKey === null && this.hoveredBodyId === null) return;
    this.hoveredFaceKey = null;
    this.hoveredBodyId = null;
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
