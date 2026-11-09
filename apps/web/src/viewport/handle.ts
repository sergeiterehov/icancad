import type { SketchEntity, SketchFrame } from '@icancad/model';
import type { Point2 } from '@icancad/sketch';
import type { SketchSnap } from '../sketch/snap';

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

export interface SceneSketch {
  id: string;
  frame: SketchFrame;
  entities: SketchEntity[];
  selectionKeys: string[];
  dimmedEntityIds: string[];
  frozenEntityIds: string[];
  highlightIds: string[];
  active: boolean;
}

export interface ViewportCamera {
  target: [number, number, number];
  distance: number;
  azimuth: number;
  polar: number;
}

export interface SketchPick {
  point: Point2;
  entityId: string | null;
  pointIndex: number | null;
}

export interface ViewportHandle {
  fit: () => void;
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
