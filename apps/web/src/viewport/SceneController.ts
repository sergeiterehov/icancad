import type { TessellationResult } from '@icancad/kernel';
import type { SectionPlane, SketchEntity, SketchFrame } from '@icancad/model';
import {
  entityControlPoints,
  sketchPointToWorld,
  tessellateEntity,
  worldToSketchPoint,
  type Point2,
} from '@icancad/sketch';
import * as THREE from 'three';
import type { Theme } from '../stores/themeStore';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { SketchSnap } from '../sketch/snap';
import { CAMERA_FOV_DEGREES, easeInOut, fitDistance, shortestAngle } from './cameraFit';
import type { ScenePick, SceneSketch, SketchPick, ViewName, ViewportCamera } from './handle';
import { isPlanarFace } from './planarFace';

const HATCH_SPACING_PX = 6;

export interface SceneBody {
  id: string;
  kind: 'solid' | 'mesh';
  mesh: TessellationResult;
  color: string;
  visible: boolean;
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
function cameraBasis(
  azimuth: number,
  polar: number,
): { right: THREE.Vector3; up: THREE.Vector3 } {
  const offset = new THREE.Vector3(
    Math.sin(polar) * Math.cos(azimuth),
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
  );
  const upHint = Math.abs(Math.cos(polar)) > 0.999
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);
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
  /** Highlight surfaces for picked faces, keyed by `s:`/`b:` refs. */
  private readonly sketchFaceMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly bodyFaceOverlays = new Map<
    string,
    { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }
  >();
  private readonly faceOverlayGroup = new THREE.Group();
  private faceHighlights: {
    selected: Set<string>;
    invalid: Set<string>;
    picking: boolean;
    bodyPicking: boolean;
    bodyFacesOnly: boolean;
  } = {
    selected: new Set(),
    invalid: new Set(),
    picking: false,
    bodyPicking: false,
    bodyFacesOnly: false,
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

  private dragMode: 'orbit' | 'pan' | null = null;
  private lastX = 0;
  private lastY = 0;
  private pointerDown: { x: number; y: number } | null = null;
  private pointerMoved = false;
  private readonly raycaster = new THREE.Raycaster();
  private transition: {
    from: CameraPose;
    to: CameraPose;
    azimuthDelta: number;
    startedAt: number;
    duration: number;
  } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    private readonly onPick?: (pick: ScenePick | null, additive: boolean) => void,
    private readonly onBodyContextMenu?: (bodyId: string | null, x: number, y: number) => void,
    private readonly onCameraChange?: (azimuth: number, polar: number, distance: number) => void,
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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2f3a, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1, -1.5, 2);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x99aaff, 0.5);
    fillLight.position.set(-1, 1, 0.5);
    this.scene.add(fillLight);

    this.grid = this.createGrid();
    this.scene.add(this.grid);
    this.faceOverlayGroup.renderOrder = 6;
    this.scene.add(this.faceOverlayGroup);

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

      if (entry.group.visible !== body.visible) sectionChanged = true;
      entry.group.visible = body.visible;
      entry.kind = body.kind;
      entry.material.color.set(body.color);
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

  private applyBodyMaterials(): void {
    for (const [id, entry] of this.bodies) {
      const isError = this.bodyStyles.errored.has(id);
      const isSelected = !isError && this.bodyStyles.selected.has(id);
      const isHovered = !isError && !isSelected && this.hoveredBodyId === id;
      const isHighlighted = !isError && !isSelected && !isHovered && this.bodyStyles.highlighted.has(id);
      entry.material.emissive.setHex(
        isError
          ? 0x7a1a1a
          : isSelected || isHovered
            ? 0x2a4a8a
            : isHighlighted
              ? 0x24406e
              : 0x000000,
      );
      entry.material.emissiveIntensity = isError || isSelected || isHovered || isHighlighted ? 1 : 0;
    }
  }

  setFaceHighlights(state: FaceHighlightState): void {
    this.faceHighlights = {
      selected: new Set(state.selected),
      invalid: new Set(state.invalid),
      picking: state.picking,
      bodyPicking: state.bodyPicking,
      bodyFacesOnly: Boolean(state.bodyFacesOnly),
    };
    if (!state.picking) this.hoveredFaceKey = null;
    if (!state.bodyPicking && this.hoveredBodyId !== null) {
      this.hoveredBodyId = null;
      this.applyBodyMaterials();
    }
    this.applyFaceHighlights();
    this.invalidate();
  }

  setTheme(theme: Theme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.edgeColor = theme === 'dark' ? 0x0d1015 : 0x5f6876;

    for (const entry of this.bodies.values()) {
      if (entry.edges) {
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
      return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
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
    const sketchEntities =
      entities ?? this.sketchData.find((candidate) => candidate.id === active.id)?.entities ?? [];

    let pointSnap: SketchSnap['pointSnap'] = null;
    let bestPoint = limit;
    for (const entity of sketchEntities) {
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
      if (entity.type !== 'line') continue;
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
    return 0xff9f43;
  }

  private sketchConstructionColor(): number {
    return this.theme === 'dark' ? 0x7d8ea8 : 0x6d7a8d;
  }

  private sketchHighlightColor(): number {
    return this.theme === 'dark' ? 0xbb86fc : 0x7c3aed;
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
      group.renderOrder = 18;
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
      for (const entity of sketch.entities) {
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
          editingSketch && !sketch.active,
        );
      }
      this.addSketchFacePickers(group, sketch);
      this.scene.add(group);
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
      const geometry = faceGeometry(entry.meshRef, Number(faceId));
      if (!geometry) continue;
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
        clippingPlanes: this.sectionClipPlanes,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 7;
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
    const sketchEntities =
      entities ?? this.sketchData.find((candidate) => candidate.id === active.id)?.entities ?? [];
    let entityId: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const entity of sketchEntities) {
      let distance = Number.POSITIVE_INFINITY;
      if (entity.type === 'point') {
        distance = Math.hypot(point[0] - entity.x, point[1] - entity.y);
      } else {
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
      }
      const limit = unitsPerPixel * (entity.type === 'point' ? 4 : 3);
      if (distance <= limit && distance < best) {
        best = distance;
        entityId = entity.id;
      }
    }
    // Control points always win the hit test over curves, including points
    // that coincide with a curve. Pick the nearest point globally.
    let pointEntityId: string | null = null;
    let pointIndex: number | null = null;
    let bestPoint = unitsPerPixel * 4;
    for (const entity of sketchEntities) {
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
      lines.renderOrder = 19;
      group.add(lines);
    };
    makeLines(minor, this.theme === 'dark' ? 0x5c6575 : 0x9aa4b2, 0.18);
    makeLines(major, this.theme === 'dark' ? 0x8c97a8 : 0x6d7787, 0.38);
    const axes = [
      this.sketchWorld(frame, [-extent, 0], offset),
      this.sketchWorld(frame, [extent, 0], offset),
    ];
    const xGeometry = new THREE.BufferGeometry().setFromPoints(axes);
    const xLine = new THREE.Line(
      xGeometry,
      new THREE.LineBasicMaterial({ color: 0xd48282, depthTest: false, depthWrite: false }),
    );
    xLine.renderOrder = 19;
    group.add(xLine);
    const yAxes = [
      this.sketchWorld(frame, [0, -extent], offset),
      this.sketchWorld(frame, [0, extent], offset),
    ];
    const yGeometry = new THREE.BufferGeometry().setFromPoints(yAxes);
    const yLine = new THREE.Line(
      yGeometry,
      new THREE.LineBasicMaterial({ color: 0x82b482, depthTest: false, depthWrite: false }),
    );
    yLine.renderOrder = 19;
    group.add(yLine);
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
    background: boolean,
  ): void {
    const color = selected
      ? this.sketchSelectedColor()
      : highlighted
        ? this.sketchHighlightColor()
        : frozen
          ? this.sketchFrozenLineColor()
          : entity.construction
            ? this.sketchConstructionColor()
            : this.sketchColor();
    // Sketches that are not being edited are drawn thinner so they cannot be
    // mistaken for the sketch in progress.
    const width = selected ? 3 : highlighted ? 3 : background ? 1 : 2;
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
      const selectedPoint = selected || selectedPoints.has(index);
      const geometry = new THREE.BufferGeometry().setFromPoints([this.sketchWorld(frame, point)]);
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: selectedPoint
            ? this.sketchSelectedColor()
            : pointHighlighted
              ? this.sketchHighlightColor()
              : frozen
                ? this.sketchFrozenPointColor()
                : this.sketchPointColor(),
          map: this.pointTexture,
          alphaTest: 0.5,
          transparent: true,
          opacity: dimmed ? 0.25 : 1,
          size: selectedPoint || pointHighlighted ? 6 : 4,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      points.renderOrder = selectedPoint || pointHighlighted ? 31 : 30;
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
    line.renderOrder = 22;
    return line;
  }

  private rebuildSketchOverlay(): void {
    if (this.sketchOverlay) {
      this.scene.remove(this.sketchOverlay);
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
      draft.renderOrder = 23;
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
      phantom.renderOrder = 32;
      group.add(phantom);
    }
    if (group.children.length === 0) return;
    this.scene.add(group);
    this.sketchOverlay = group;
  }

  private disposeSketchEntries(): void {
    for (const entry of this.sketchEntries) {
      this.scene.remove(entry.group);
      this.disposeObject(entry.group);
    }
    this.sketchEntries = [];
    this.sketchLineMaterials = [];
    this.sketchFaceMaterials.clear();
    this.facePickMeshes.length = 0;
    if (this.sketchOverlay) {
      this.scene.remove(this.sketchOverlay);
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
      let bodyIndex = 0;
      for (const body of this.bodies.values()) {
        if (!body.group.visible) continue;
        bodyIndex += 1;

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
            uniform vec3 uFill;
            uniform vec3 uLine;
            void main() {
              #include <clipping_planes_fragment>
              float d = (gl_FragCoord.x + gl_FragCoord.y) * 0.70710678 / uPixelRatio;
              float cell = d / uSpacing;
              float distanceToLine = abs(fract(cell + 0.5) - 0.5) * uSpacing;
              float line = 1.0 - smoothstep(0.4, 0.9, distanceToLine);
              gl_FragColor = vec4(mix(uFill, uLine, line), 1.0);
            }
          `,
          side: THREE.DoubleSide,
          clipping: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -bodyIndex,
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
        backMesh.renderOrder = 0;
        frontMesh.renderOrder = 1;
        group.add(backMesh, frontMesh);

        const cap = new THREE.Mesh(this.capGeometry, capMaterial);
        cap.renderOrder = 2;
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

    for (const id of [...this.bodies.keys()]) this.removeEntry(id);
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
    grid.renderOrder = -1;
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

    return { group, kind: body.kind, mesh, geometry, material, edges, edgeGeometry, meshRef: body.mesh };
  }

  private removeEntry(id: string): void {
    const entry = this.bodies.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    entry.geometry.dispose();
    entry.material.dispose();
    entry.edgeGeometry?.dispose();
    if (entry.edges) (entry.edges.material as THREE.Material).dispose();
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
    this.updateCamera();
  }

  // LineMaterial measures dashes in world units multiplied by dashScale, so a
  // scale of pixels-per-unit makes an 8/8 dash pattern 8 screen pixels wide.
  private pixelsPerWorldUnit(): number {
    return this.height / Math.max(1e-6, this.camera.top - this.camera.bottom);
  }

  private updateCamera(): void {
    const aspect = this.width / this.height;
    const halfHeight = this.distance * Math.tan((FOV_DEGREES * Math.PI) / 180 / 2);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.near = Math.max(0.01, this.distance * 0.001);
    this.camera.far = this.distance * 100 + 10_000;

    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sinPolar * Math.cos(this.azimuth),
      this.target.y + this.distance * sinPolar * Math.sin(this.azimuth),
      this.target.z + this.distance * Math.cos(this.polar),
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
    if (this.pointerDown && !this.pointerMoved) {
      const movedX = event.clientX - this.pointerDown.x;
      const movedY = event.clientY - this.pointerDown.y;
      if (Math.hypot(movedX, movedY) > 4) this.pointerMoved = true;
    }
    if (!this.dragMode) {
      if (
        (this.faceHighlights.picking || this.faceHighlights.bodyPicking) &&
        event.buttons === 0
      ) {
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
        const pick = this.pickSceneAt(
          event.clientX,
          event.clientY,
          this.faceHighlights.picking,
          this.faceHighlights.bodyFacesOnly,
        );
        this.onPick?.(pick, event.metaKey || event.ctrlKey || event.shiftKey);
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
  ): ScenePick | null {
    const raycaster = this.pointerToRay(clientX, clientY);
    const bodyMeshes = [...this.bodies.values()]
      .filter((entry) => entry.group.visible)
      .map((entry) => entry.mesh);
    const faceHit =
      faces && !bodyFacesOnly
        ? raycaster.intersectObjects(this.facePickMeshes, false)[0]
        : undefined;
    const bodyHit = raycaster.intersectObjects(bodyMeshes, false)[0];
    // While faces are being picked they win over the solids they produced, so a
    // face stays clickable after it has been extruded.
    if (faces && faceHit) {
      const face = faceHit.object.userData.sketchFace as
        | { sketchId: string; faceId: string }
        | undefined;
      if (face) return { kind: 'face', sketchId: face.sketchId, faceId: face.faceId };
    }
    if (bodyHit) {
      const bodyId = bodyHit.object.userData.bodyId as string | undefined;
      if (bodyId && faces) {
        const entry = this.bodies.get(bodyId);
        const faceId = entry?.meshRef.faceIds[bodyHit.faceIndex ?? -1];
        if (entry && entry.kind === 'solid' && faceId !== undefined) {
          const normal = bodyHit.face?.normal;
          return {
            kind: 'body-face',
            bodyId,
            faceId: String(faceId),
            normal: normal ? [normal.x, normal.y, normal.z] : [0, 0, 1],
            origin: [bodyHit.point.x, bodyHit.point.y, bodyHit.point.z],
            planar: isPlanarFace(entry.meshRef, faceId),
          };
        }
      }
      if (bodyId) {
        const entry = this.bodies.get(bodyId);
        return entry?.kind === 'mesh'
          ? { kind: 'mesh', id: bodyId }
          : { kind: 'body', id: bodyId };
      }
    }
    if (faceHit) {
      const face = faceHit.object.userData.sketchFace as
        | { sketchId: string; faceId: string }
        | undefined;
      if (face) return { kind: 'face', sketchId: face.sketchId, faceId: face.faceId };
    }
    return null;
  }

  private pickBodyAt(clientX: number, clientY: number): string | null {
    const pick = this.pickSceneAt(clientX, clientY);
    return pick?.kind === 'body' ? pick.id : null;
  }

  private pickObjectIdAt(clientX: number, clientY: number): string | null {
    const pick = this.pickSceneAt(clientX, clientY);
    return pick?.kind === 'body' || pick?.kind === 'mesh' ? pick.id : null;
  }

  private scheduleHover(clientX: number, clientY: number): void {
    this.hoverPoint = { x: clientX, y: clientY };
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (
        !this.hoverPoint ||
        (!this.faceHighlights.picking && !this.faceHighlights.bodyPicking)
      ) {
        return;
      }
      this.updateHover(this.hoverPoint.x, this.hoverPoint.y);
    });
  }

  private updateHover(clientX: number, clientY: number): void {
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

    const pick = this.pickSceneAt(
      clientX,
      clientY,
      true,
      this.faceHighlights.bodyFacesOnly,
    );
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
      const shape = new THREE.Shape(face.outline.map((point) => new THREE.Vector2(point[0], point[1])));
      for (const hole of face.holes) {
        shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(point[0], point[1]))));
      }
      const material = new THREE.MeshBasicMaterial({
        color: this.sketchHighlightColor(),
        transparent: true,
        opacity: sketch.facesPicking ? 0.12 : 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(basis).setPosition(ox, oy, oz);
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

    if (this.sectionEntries.length > 0) {
      this.renderer.autoClear = false;
      for (const entry of this.sectionEntries) {
        for (const other of this.sectionEntries) other.group.visible = other === entry;
        this.renderer.clearStencil();
        this.renderer.render(this.sectionScene, this.camera);
      }
      for (const entry of this.sectionEntries) entry.group.visible = false;
      this.renderer.clearStencil();
      this.renderer.autoClear = true;
    }
  };
}
