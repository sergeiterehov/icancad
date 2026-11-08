import type { TessellationResult } from '@icancad/kernel';
import type { SectionPlane, SketchEntity, SketchFrame } from '@icancad/model';
import {
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
import type { SceneSketch, SketchPick, ViewName, ViewportCamera } from './handle';

const HATCH_SPACING_PX = 6;

export interface SceneBody {
  id: string;
  mesh: TessellationResult;
  color: string;
  visible: boolean;
}

interface BodyEntry {
  group: THREE.Group;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  edges: THREE.LineSegments | null;
  edgeGeometry: THREE.BufferGeometry | null;
  meshRef: TessellationResult;
}

const FOV_DEGREES = 35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  private sketchOverlay: THREE.Group | null = null;
  private sketchLineMaterials: LineMaterial[] = [];
  private readonly pointTexture = createCircleTexture();
  private sketchOverlayState: {
    preview: SketchEntity | null;
    draftPoints: Point2[];
  } = { preview: null, draftPoints: [] };

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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    private readonly onPick?: (bodyId: string | null, additive: boolean) => void,
    private readonly onBodyContextMenu?: (bodyId: string | null, x: number, y: number) => void,
    private readonly onCameraChange?: (azimuth: number, polar: number) => void,
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
  ): void {
    const seen = new Set<string>();
    const selected = new Set(selectedBodyIds);
    const highlighted = new Set(highlightedBodyIds);
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
      entry.material.color.set(body.color);
      const isSelected = selected.has(body.id);
      const isHighlighted = !isSelected && highlighted.has(body.id);
      entry.material.emissive.setHex(isSelected ? 0x2a4a8a : isHighlighted ? 0x3a4a63 : 0x000000);
      entry.material.emissiveIntensity = isSelected || isHighlighted ? 1 : 0;
    }

    for (const id of [...this.bodies.keys()]) {
      if (!seen.has(id)) {
        this.removeEntry(id);
        sectionChanged = true;
      }
    }

    this.applyClipping();
    if (sectionChanged && this.sectionPlanes.length > 0) this.rebuildSection();
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
      this.target.set(0, 0, 0);
      this.distance = 200;
      this.updateCamera();
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.001, size.length() / 2);
    this.target.copy(center);
    this.distance = (radius * 1.35) / Math.tan((FOV_DEGREES * Math.PI) / 180 / 2);
    this.updateCamera();
  }

  setView(name: ViewName): void {
    switch (name) {
      case 'front':
        this.azimuth = -Math.PI / 2;
        this.polar = Math.PI / 2;
        break;
      case 'back':
        this.azimuth = Math.PI / 2;
        this.polar = Math.PI / 2;
        break;
      case 'right':
        this.azimuth = 0;
        this.polar = Math.PI / 2;
        break;
      case 'left':
        this.azimuth = Math.PI;
        this.polar = Math.PI / 2;
        break;
      case 'top':
        this.azimuth = -Math.PI / 2;
        this.polar = 0.001;
        break;
      case 'bottom':
        this.azimuth = -Math.PI / 2;
        this.polar = Math.PI - 0.001;
        break;
      case 'iso':
        this.azimuth = -Math.PI / 4;
        this.polar = Math.PI / 3;
        break;
    }
    this.updateCamera();
  }

  getOrientation(): { azimuth: number; polar: number } {
    return { azimuth: this.azimuth, polar: this.polar };
  }

  setOrientation(azimuth: number, polar: number): void {
    this.azimuth = azimuth;
    this.polar = clamp(polar, 0.001, Math.PI - 0.001);
    this.updateCamera();
  }

  orbitBy(deltaX: number, deltaY: number): void {
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

  private sketchColor(): number {
    return this.theme === 'dark' ? 0x8fb4ff : 0x2f5fc4;
  }

  private sketchPointColor(): number {
    return this.theme === 'dark' ? 0xffffff : 0x000000;
  }

  private sketchSelectedColor(): number {
    return 0xff9f43;
  }

  setSketches(sketches: SceneSketch[]): void {
    this.sketchData = sketches;
    this.disposeSketchEntries();
    for (const sketch of sketches) {
      const group = new THREE.Group();
      group.renderOrder = 18;
      if (sketch.active) this.addSketchGrid(group, sketch.frame);
      const selected = new Set(sketch.selectionKeys.filter((key) => !key.includes('#')));
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
        );
      }
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
    this.invalidate();
  }

  setSketchOverlay(preview: SketchEntity | null, draftPoints: Point2[]): void {
    this.sketchOverlayState = { preview, draftPoints };
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
    this.target.set(...state.target);
    this.distance = state.distance;
    this.azimuth = state.azimuth;
    this.polar = state.polar;
    this.updateCamera();
  }

  alignSketch(frame: SketchFrame): void {
    this.target.set(...frame.origin);
    const [nx, ny, nz] = frame.normal;
    if (Math.abs(nz) >= Math.abs(nx) && Math.abs(nz) >= Math.abs(ny)) {
      this.azimuth = -Math.PI / 2;
      this.polar = 0.001;
    } else if (Math.abs(ny) >= Math.abs(nx)) {
      this.azimuth = -Math.PI / 2;
      this.polar = Math.PI / 2;
    } else {
      this.azimuth = 0;
      this.polar = Math.PI / 2;
    }
    this.updateCamera();
  }

  pickSketch(clientX: number, clientY: number): SketchPick | null {
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
    const sketch = this.sketchData.find((candidate) => candidate.id === active.id);
    let entityId: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const entity of sketch?.entities ?? []) {
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
    let pointIndex: number | null = null;
    for (const entity of sketch?.entities ?? []) {
      if (entity.type === 'point') continue;
      let bestPoint = unitsPerPixel * 4;
      this.sketchControlPoints(entity).forEach((candidate, index) => {
        const distance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
        if (distance <= bestPoint) {
          bestPoint = distance;
          entityId = entity.id;
          pointIndex = index;
        }
      });
    }
    return { point, entityId, pointIndex };
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
  ): void {
    const color = selected ? this.sketchSelectedColor() : this.sketchColor();
    const width = selected ? 3 : 2;
    if (entity.type !== 'point') {
      const line = this.createSketchLine(entity, frame, color, width, 1);
      if (line) {
        line.userData.entityId = entity.id;
        group.add(line);
      }
    }
    const controlPoints = this.sketchControlPoints(entity);
    controlPoints.forEach((point, index) => {
      const highlighted = selected || selectedPoints.has(index);
      const geometry = new THREE.BufferGeometry().setFromPoints([
        this.sketchWorld(frame, point),
      ]);
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: highlighted ? this.sketchSelectedColor() : this.sketchPointColor(),
          map: this.pointTexture,
          alphaTest: 0.5,
          transparent: true,
          size: highlighted ? 6 : 4,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      points.renderOrder = 23;
      points.userData.entityId = entity.id;
      points.userData.pointIndex = index;
      group.add(points);
    });
  }

  private sketchControlPoints(entity: SketchEntity): Point2[] {
    switch (entity.type) {
      case 'point':
        return [[entity.x, entity.y]];
      case 'line':
        return [
          [entity.x1, entity.y1],
          [entity.x2, entity.y2],
        ];
      case 'circle':
        return [
          [entity.cx, entity.cy],
          [entity.cx + entity.r, entity.cy],
        ];
      case 'arc':
        return [
          [entity.cx, entity.cy],
          [
            entity.cx + Math.cos(entity.startAngle) * entity.r,
            entity.cy + Math.sin(entity.startAngle) * entity.r,
          ],
          [
            entity.cx + Math.cos(entity.endAngle) * entity.r,
            entity.cy + Math.sin(entity.endAngle) * entity.r,
          ],
        ];
      case 'ellipse':
        return [
          [entity.cx, entity.cy],
          [entity.cx + entity.rx, entity.cy],
          [entity.cx, entity.cy + entity.ry],
        ];
      case 'bezier':
        return entity.points;
    }
  }

  private createSketchLine(
    entity: SketchEntity,
    frame: SketchFrame,
    color: number,
    width: number,
    opacity: number,
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
    });
    this.sketchLineMaterials.push(material);
    const line = new Line2(geometry, material);
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
    const { preview, draftPoints } = this.sketchOverlayState;
    if (preview) {
      const line = this.createSketchLine(preview, active.frame, this.sketchColor(), 2, 0.75);
      if (line) group.add(line);
    }
    if (draftPoints.length > 0) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        draftPoints.map((point) => this.sketchWorld(active.frame, point)),
      );
      const draft = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: this.sketchPointColor(),
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
    this.resizeObserver.disconnect();
    this.unbindEvents();

    for (const id of [...this.bodies.keys()]) this.removeEntry(id);
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

    return { group, mesh, geometry, material, edges, edgeGeometry, meshRef: body.mesh };
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
    this.onCameraChange?.(this.azimuth, this.polar);
    this.invalidate();
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onPointerDown = (event: PointerEvent): void => {
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
    if (!this.dragMode) return;
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
        const bodyId = this.pickBodyAt(event.clientX, event.clientY);
        this.onPick?.(bodyId, event.metaKey || event.ctrlKey || event.shiftKey);
      }
    }
  };

  private pickBodyAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const meshes = [...this.bodies.values()]
      .filter((entry) => entry.group.visible)
      .map((entry) => entry.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? ((hit.object.userData.bodyId as string | undefined) ?? null) : null;
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0012);
    this.distance = clamp(this.distance * factor, 0.05, 10_000_000);
    this.updateCamera();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const bodyId = this.pickBodyAt(event.clientX, event.clientY);
    this.onBodyContextMenu?.(bodyId, event.clientX, event.clientY);
  };

  private invalidate(): void {
    this.needsRender = true;
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
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
