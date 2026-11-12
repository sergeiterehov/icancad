import type { TessellationResult } from '@icancad/kernel';
import type {
  EdgeTreatmentFeature,
  EdgeTreatmentKind,
  ExtrudeFeature,
  Project,
  Vec3,
} from '@icancad/model';
import { useDocumentStore } from '../stores/documentStore';
import {
  buildQuickEdgeTreatment,
  findBoundEdgeTreatment,
  MIN_EDGE_TREATMENT,
  type EdgeTreatmentGeometry,
} from './edgeTreatment';
import { predictBodyFaceOp, predictSketchOp } from './predict';
import { buildQuickExtrude, findBoundExtrude } from './target';
import type {
  ExtrudePrediction,
  PredictedExtrudeOp,
  QuickTargetGeometry,
} from './types';

/** Below this the operation is treated as a click, not a drag. */
const MIN_DISTANCE = 0.05;

/** Which extent of the extrusion a handle edits. */
export type ExtrudeHandleAxis = 'primary' | 'second';

export interface QuickBodySource {
  id: string;
  mesh: TessellationResult;
}

/**
 * One handle drag. It owns the difference between the document before the drag
 * and the operation it creates or edits, so the whole gesture is a single undo
 * step. The method is predicted while the operation is new and is never changed
 * by later drags of the same operation.
 */
export class QuickExtrudeDrag {
  private before: Project | null = null;
  private featureId: string | null = null;
  private originalFeature: ExtrudeFeature | null = null;
  private created = false;
  private locked = false;
  private changed = false;
  private currentValue = 0;
  private currentOp: PredictedExtrudeOp | null = null;

  constructor(
    private readonly geometry: QuickTargetGeometry,
    private readonly bodies: readonly QuickBodySource[],
    private readonly name: string,
    /** Operation the handle belongs to; absent for a prospective one. */
    private readonly featureIdHint?: string,
    /** The primary extent or the opposite, second direction. */
    private readonly axis: ExtrudeHandleAxis = 'primary',
  ) {}

  get value(): number {
    return this.currentValue;
  }

  /** True when this drag edits an operation that already existed. */
  get isLocked(): boolean {
    return this.locked;
  }

  /** Method the live operation currently has. */
  get op(): PredictedExtrudeOp | null {
    return this.currentOp;
  }

  /** Edge treatments report their kind instead of an extrude method. */
  get kind(): EdgeTreatmentKind | null {
    return null;
  }

  start(): void {
    const project = useDocumentStore.getState().project;
    this.before = project;
    this.created = false;
    this.changed = false;
    const bound = this.featureIdHint
      ? project.features.find(
          (feature): feature is ExtrudeFeature =>
            feature.id === this.featureIdHint && feature.type === 'extrude',
        )
      : findBoundExtrude(project, this.geometry.target);
    if (bound) {
      this.featureId = bound.id;
      this.originalFeature = bound;
      this.locked = true;
      this.currentValue =
        this.axis === 'second'
          ? (bound.secondDirection?.distance ?? 0)
          : bound.reversed
            ? -bound.distance
            : bound.distance;
      this.currentOp = bound.op;
      return;
    }
    this.featureId = null;
    this.originalFeature = null;
    this.locked = false;
    this.currentValue = 0;
    this.currentOp = null;
  }

  update(value: number): void {
    if (!this.before) return;
    this.currentValue = value;
    if (this.axis === 'second') {
      this.updateSecondDirection(value);
      return;
    }
    if (Math.abs(value) < MIN_DISTANCE) {
      this.restore();
      return;
    }

    if (!this.featureId) {
      const prediction = this.predict(value);
      const feature = buildQuickExtrude(this.geometry, prediction, value, this.name);
      if (!useDocumentStore.getState().previewAddFeature(feature)) return;
      this.featureId = feature.id;
      this.created = true;
      this.changed = true;
      this.currentOp = prediction.op;
      // The grab only starts the operation. Once it exists the gesture drives
      // the handle of the opened operation, so its settings are visible and
      // later drags can no longer change the predicted method.
      useDocumentStore.getState().select({ kind: 'feature', id: feature.id });
      return;
    }

    const state = useDocumentStore.getState();
    const feature = state.project.features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === this.featureId && candidate.type === 'extrude',
    );
    if (!feature) {
      this.featureId = null;
      this.originalFeature = null;
      return;
    }
    const prediction = this.locked ? null : this.predict(value);
    if (prediction) this.currentOp = prediction.op;
    state.preview({
      type: 'feature/replace',
      feature: {
        ...feature,
        distance: Math.abs(value),
        reversed: value < 0,
        ...(prediction ? { op: prediction.op, bodyIds: prediction.bodyIds } : {}),
      },
    });
    this.changed = true;
  }

  /**
   * The second direction always grows away from the primary one, so its handle
   * only ever changes its length; the operation and method stay as they are.
   */
  private updateSecondDirection(value: number): void {
    if (!this.featureId) return;
    if (value < MIN_DISTANCE) {
      this.restore();
      return;
    }
    const state = useDocumentStore.getState();
    const feature = state.project.features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === this.featureId && candidate.type === 'extrude',
    );
    if (!feature) {
      this.featureId = null;
      this.originalFeature = null;
      return;
    }
    state.preview({
      type: 'feature/replace',
      feature: {
        ...feature,
        secondDirection: { end: 'blind', distance: value },
      },
    });
    this.changed = true;
  }

  end(): void {
    if (!this.before) return;
    const featureId = this.featureId;
    const changed = this.changed;
    if (changed && featureId) {
      useDocumentStore.getState().commitPreview(this.before);
    }
    this.reset();
    // A quick gesture is not a silent model edit: it creates or finds an
    // operation and focuses it, so its parameters and handle are right there.
    if (changed && featureId) {
      useDocumentStore.getState().select({ kind: 'feature', id: featureId });
    }
  }

  cancel(): void {
    if (!this.before) return;
    this.restore();
    this.reset();
  }

  private predict(value: number): ExtrudePrediction {
    if (this.geometry.target.kind === 'body-face') {
      return predictBodyFaceOp(value, this.geometry.target.bodyId);
    }
    const sign = value < 0 ? -1 : 1;
    const direction: Vec3 = [
      this.geometry.direction[0] * sign,
      this.geometry.direction[1] * sign,
      this.geometry.direction[2] * sign,
    ];
    return predictSketchOp({
      bodies: this.bodies,
      samples: this.geometry.samples,
      direction,
      sign,
      ...(this.geometry.preferredBodyId
        ? { preferredBodyId: this.geometry.preferredBodyId }
        : {}),
    });
  }

  /** Returns the document to its state before this drag without a history step. */
  private restore(): void {
    const state = useDocumentStore.getState();
    if (this.created && this.featureId) {
      state.preview({ type: 'feature/remove', featureId: this.featureId });
      this.featureId = null;
    } else if (this.originalFeature) {
      state.preview({ type: 'feature/replace', feature: this.originalFeature });
    }
    if (this.before && state.project.historyEnd !== this.before.historyEnd) {
      state.preview({ type: 'history/set-end', featureId: this.before.historyEnd });
    }
    this.created = false;
    this.changed = false;
  }

  private reset(): void {
    this.before = null;
    this.featureId = null;
    this.originalFeature = null;
    this.created = false;
    this.locked = false;
    this.changed = false;
    this.currentValue = 0;
    this.currentOp = null;
  }
}

/**
 * One track drag on an edge treatment. The first drag creates the operation:
 * the side the track is pulled to says whether the corners get rounded or cut,
 * and the kind is locked when the pointer is released. Later drags of the same
 * operation only change the size.
 */
export class QuickEdgeTreatmentDrag {
  private before: Project | null = null;
  private featureId: string | null = null;
  private originalFeature: EdgeTreatmentFeature | null = null;
  private created = false;
  private locked = false;
  private changed = false;
  private currentValue = 0;
  private currentKind: EdgeTreatmentKind | null = null;

  constructor(
    private readonly geometry: EdgeTreatmentGeometry,
    private readonly name: string,
    private readonly featureIdHint?: string,
  ) {}

  /** Signed size along the track: positive rounds, negative cuts. */
  get value(): number {
    return this.currentValue;
  }

  get op(): PredictedExtrudeOp | null {
    return null;
  }

  get kind(): EdgeTreatmentKind | null {
    return this.currentKind;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  start(): void {
    const project = useDocumentStore.getState().project;
    this.before = project;
    this.created = false;
    this.changed = false;
    const target = this.geometry.target;
    const bound = this.featureIdHint
      ? project.features.find(
          (feature): feature is EdgeTreatmentFeature =>
            feature.id === this.featureIdHint && feature.type === 'edge-treatment',
        )
      : findBoundEdgeTreatment(project, target);
    if (bound) {
      this.featureId = bound.id;
      this.originalFeature = bound;
      this.locked = true;
      this.currentKind = bound.kind;
      // A chamfer sits on the negative side, so its arrow points into the
      // corner and pulling further that way still grows it.
      this.currentValue = bound.kind === 'fillet' ? bound.size : -bound.size;
      return;
    }
    this.featureId = null;
    this.originalFeature = null;
    this.locked = false;
    this.currentKind = null;
    this.currentValue = 0;
  }

  update(value: number): void {
    if (!this.before) return;
    this.currentValue = value;
    if (Math.abs(value) < MIN_EDGE_TREATMENT) {
      this.restore();
      return;
    }
    const kind: EdgeTreatmentKind = this.locked
      ? (this.currentKind ?? (value < 0 ? 'chamfer' : 'fillet'))
      : value < 0
        ? 'chamfer'
        : 'fillet';
    this.currentKind = kind;
    // A handle cannot resolve better than a hundredth of a millimetre, and the
    // operation reads better without a long float in its field.
    const size = Math.round(Math.abs(value) * 100) / 100;

    if (!this.featureId) {
      const feature = buildQuickEdgeTreatment(
        this.geometry.target,
        kind,
        size,
        this.name,
      );
      if (!useDocumentStore.getState().previewAddFeature(feature)) return;
      this.featureId = feature.id;
      this.created = true;
      this.changed = true;
      useDocumentStore.getState().select({ kind: 'feature', id: feature.id });
      return;
    }

    const state = useDocumentStore.getState();
    const feature = state.project.features.find(
      (candidate): candidate is EdgeTreatmentFeature =>
        candidate.id === this.featureId && candidate.type === 'edge-treatment',
    );
    if (!feature) {
      this.featureId = null;
      this.originalFeature = null;
      return;
    }
    state.preview({
      type: 'feature/replace',
      feature: {
        ...feature,
        kind: this.locked ? feature.kind : kind,
        size: Math.max(0.001, size),
      },
    });
    this.changed = true;
  }

  end(): void {
    if (!this.before) return;
    const featureId = this.featureId;
    const changed = this.changed;
    if (changed && featureId) {
      useDocumentStore.getState().commitPreview(this.before);
      // The kind is part of the operation from now on: the side the user pulled
      // to cannot change it any more.
      this.locked = true;
    }
    this.reset(false);
    if (changed && featureId) {
      useDocumentStore.getState().select({ kind: 'feature', id: featureId });
    }
  }

  cancel(): void {
    if (!this.before) return;
    this.restore();
    this.reset(true);
  }

  private restore(): void {
    const state = useDocumentStore.getState();
    if (this.created && this.featureId) {
      state.preview({ type: 'feature/remove', featureId: this.featureId });
      this.featureId = null;
    } else if (this.originalFeature) {
      state.preview({ type: 'feature/replace', feature: this.originalFeature });
    }
    if (this.before && state.project.historyEnd !== this.before.historyEnd) {
      state.preview({ type: 'history/set-end', featureId: this.before.historyEnd });
    }
    this.created = false;
    this.changed = false;
  }

  private reset(clearKind: boolean): void {
    this.before = null;
    this.featureId = null;
    this.originalFeature = null;
    this.created = false;
    this.changed = false;
    if (clearKind) {
      this.locked = false;
      this.currentValue = 0;
      this.currentKind = null;
    }
  }
}
