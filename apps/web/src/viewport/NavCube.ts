import * as THREE from 'three';
import type { Theme } from '../stores/themeStore';
import type { ViewName } from './handle';

export type NavFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

interface NavTarget {
  faces: NavFace[];
  dir?: [number, number, number];
  view?: ViewName;
  azimuth?: number;
  polar?: number;
}

export interface NavCubeCallbacks {
  onView: (view: ViewName) => void;
  onOrientation: (azimuth: number, polar: number) => void;
  onOrbit: (deltaX: number, deltaY: number) => void;
  onContextMenu: (x: number, y: number) => void;
}

const CUBE_SIZE = 1.3;
const CUBE_PIXELS = 96;
const EDGE_BAND = 0.62;
const DRAG_THRESHOLD = 3;

const MATERIAL_ORDER: NavFace[] = ['right', 'left', 'back', 'front', 'top', 'bottom'];
const FACE_VIEWS: Record<NavFace, ViewName> = {
  right: 'right',
  left: 'left',
  back: 'back',
  front: 'front',
  top: 'top',
  bottom: 'bottom',
};
const AXIS_FACES: ReadonlyArray<readonly [NavFace, NavFace]> = [
  ['left', 'right'],
  ['front', 'back'],
  ['bottom', 'top'],
];

function faceOfAxis(axis: number, sign: number): NavFace {
  const pair = AXIS_FACES[axis]!;
  return sign >= 0 ? pair[1] : pair[0];
}

function createLabelTexture(label: string, theme: Theme, sideways: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = theme === 'dark' ? '#343b48' : '#525b6a';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = theme === 'dark' ? '#5a6476' : '#3c4452';
    context.lineWidth = 10;
    context.strokeRect(0, 0, size, size);
    context.fillStyle = theme === 'dark' ? '#eef2f8' : '#f4f7fb';
    const fontSize = label.length > 4 ? 36 : 46;
    context.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.save();
    context.translate(size / 2, size / 2);
    if (sideways) context.rotate(-Math.PI / 2);
    context.fillText(label.toUpperCase(), 0, 0, size - 36);
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class NavCube {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly mesh: THREE.Mesh;
  private readonly edges: THREE.LineSegments;
  private readonly highlight: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private materials: THREE.MeshBasicMaterial[] = [];
  private azimuth = -Math.PI / 4;
  private polar = Math.PI / 3;
  private hovered: string = '';
  private drag: { x: number; y: number; moved: boolean; target: NavTarget | null } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private labels: Record<NavFace, string>,
    private theme: Theme,
    private readonly callbacks: NavCubeCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.OrthographicCamera(-1.18, 1.18, 1.18, -1.18, 0.1, 20);

    const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    this.mesh = new THREE.Mesh(geometry, this.buildMaterials());
    this.scene.add(this.mesh);

    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: this.theme === 'dark' ? 0x0f1319 : 0x3c4452 }),
    );
    this.scene.add(this.edges);

    this.highlight = new THREE.Mesh(
      new THREE.BoxGeometry(CUBE_SIZE * 1.004, CUBE_SIZE * 1.004, CUBE_SIZE * 1.004),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uDir: { value: new THREE.Vector3(0, 0, 1) },
          uColor: { value: new THREE.Color(0x7fa4ff) },
          uStrength: { value: 0.55 },
          uMode: { value: 0 },
        },
        vertexShader: `
          varying vec3 vPos;
          varying vec3 vNormal;
          void main() {
            vPos = position;
            vNormal = normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uDir;
          uniform vec3 uColor;
          uniform float uStrength;
          uniform float uMode;
          varying vec3 vPos;
          varying vec3 vNormal;
          void main() {
            float facing = clamp(dot(normalize(vPos), normalize(uDir)), 0.0, 1.0);
            float gradient = pow(facing, 2.0);
            float solid = clamp(dot(normalize(vNormal), normalize(uDir)), 0.0, 1.0);
            float alpha = uMode > 0.5 ? solid * uStrength : gradient * uStrength;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    this.resize();
    this.sync(this.azimuth, this.polar);
  }

  sync(azimuth: number, polar: number): void {
    this.azimuth = azimuth;
    this.polar = polar;
    const sinPolar = Math.sin(polar);
    const radius = 4;
    this.camera.position.set(
      radius * sinPolar * Math.cos(azimuth),
      radius * sinPolar * Math.sin(azimuth),
      radius * Math.cos(polar),
    );
    this.camera.up.set(0, 0, 1);
    if (Math.abs(Math.cos(polar)) > 0.999) this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  setTheme(theme: Theme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    (this.edges.material as THREE.LineBasicMaterial).color.setHex(
      theme === 'dark' ? 0x0f1319 : 0x3c4452,
    );
    this.mesh.material = this.buildMaterials();
    this.hovered = '';
    this.sync(this.azimuth, this.polar);
  }

  setLabels(labels: Record<NavFace, string>): void {
    this.labels = labels;
    this.mesh.material = this.buildMaterials();
    this.hovered = '';
    this.sync(this.azimuth, this.polar);
  }

  resize(): void {
    const size = this.canvas.clientWidth || CUBE_PIXELS;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(size, size, false);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.disposeMaterials();
    this.mesh.geometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.edges.geometry.dispose();
    (this.edges.material as THREE.Material).dispose();
    this.renderer.dispose();
  }

  private buildMaterials(): THREE.Material[] {
    this.disposeMaterials();
    this.materials = MATERIAL_ORDER.map((face) => {
      const texture = createLabelTexture(
        this.labels[face],
        this.theme,
        face === 'left' || face === 'right',
      );
      return new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        toneMapped: false,
      });
    });
    return this.materials;
  }

  private disposeMaterials(): void {
    for (const material of this.materials) {
      material.map?.dispose();
      material.dispose();
    }
    this.materials = [];
  }

  private targetAt(event: PointerEvent): NavTarget | null {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.face) return null;

    const normal = hit.face.normal;
    const axis = Math.abs(normal.x) > 0.5 ? 0 : Math.abs(normal.y) > 0.5 ? 1 : 2;
    const sign = normal.getComponent(axis) >= 0 ? 1 : -1;
    const normalFace = faceOfAxis(axis, sign);
    const otherAxes = [0, 1, 2].filter((candidate) => candidate !== axis);
    const half = CUBE_SIZE / 2;
    const coordinates = otherAxes.map((candidate) => hit.point.getComponent(candidate) / half);
    const edgeFlags = coordinates.map((value) => Math.abs(value) > EDGE_BAND);

    if (edgeFlags[0] && edgeFlags[1]) {
      const direction = [0, 0, 0];
      direction[axis] = sign;
      direction[otherAxes[0]!] = Math.sign(coordinates[0]!);
      direction[otherAxes[1]!] = Math.sign(coordinates[1]!);
      const length = Math.sqrt(3);
      return {
        faces: [
          normalFace,
          faceOfAxis(otherAxes[0]!, Math.sign(coordinates[0]!)),
          faceOfAxis(otherAxes[1]!, Math.sign(coordinates[1]!)),
        ],
        dir: [direction[0]!, direction[1]!, direction[2]!],
        azimuth: Math.atan2(direction[1]!, direction[0]!),
        polar: Math.acos(direction[2]! / length),
      };
    }

    if (edgeFlags[0] || edgeFlags[1]) {
      const index = edgeFlags[0] ? 0 : 1;
      const direction = [0, 0, 0];
      direction[axis] = sign;
      direction[otherAxes[index]!] = Math.sign(coordinates[index]!);
      return {
        faces: [normalFace, faceOfAxis(otherAxes[index]!, Math.sign(coordinates[index]!))],
        dir: [direction[0]!, direction[1]!, direction[2]!],
        azimuth: Math.atan2(direction[1]!, direction[0]!),
        polar: Math.PI / 2,
      };
    }

    return {
      faces: [normalFace],
      dir: [normal.x, normal.y, normal.z],
      view: FACE_VIEWS[normalFace],
    };
  }

  private applyHover(target: NavTarget | null): void {
    const key = target ? target.faces.join(',') : '';
    if (key === this.hovered) return;
    this.hovered = key;

    this.materials.forEach((material) => material.color.setHex(0xffffff));

    if (target?.dir) {
      this.highlight.visible = true;
      (this.highlight.material.uniforms.uDir?.value as THREE.Vector3)
        .set(target.dir[0], target.dir[1], target.dir[2])
        .normalize();
      this.highlight.material.uniforms.uMode!.value = target.view ? 1 : 0;
    } else {
      this.highlight.visible = false;
    }

    this.canvas.style.cursor = target ? 'pointer' : 'default';
    this.renderer.render(this.scene, this.camera);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const target = this.targetAt(event);
    this.drag = { x: event.clientX, y: event.clientY, moved: false, target };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.drag) {
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this.drag.moved = true;
        this.applyHover(null);
        this.canvas.style.cursor = 'grabbing';
      }
      if (this.drag.moved) {
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.callbacks.onOrbit(dx, dy);
      }
      return;
    }
    this.applyHover(this.targetAt(event));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (!drag.moved && drag.target) {
      const target = drag.target;
      if (target.view) {
        this.callbacks.onView(target.view);
      } else if (target.azimuth !== undefined && target.polar !== undefined) {
        this.callbacks.onOrientation(target.azimuth, target.polar);
      }
    }
    this.canvas.style.cursor = this.targetAt(event) ? 'pointer' : 'default';
  };

  private onPointerLeave = (): void => {
    if (this.drag) return;
    this.applyHover(null);
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.drag = null;
    this.callbacks.onContextMenu(event.clientX, event.clientY);
  };
}
