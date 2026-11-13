import type { TessellationResult } from '@icancad/kernel';
import { defaultRevolve } from '@icancad/model';
import type {
  EdgeTreatmentFeature,
  EdgeTreatmentKind,
  ExtrudeFeature,
  Project,
  Vec3,
} from '@icancad/model';
import { useDocumentStore } from '../stores/documentStore';
import { snapAngle, snapLength } from './handleDrag';
import {
  buildQuickEdgeTreatment,
  MIN_EDGE_TREATMENT,
  treatmentSizeForOffset,
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

/** Which angle of a revolve a handle turns. */
export type RevolveHandleAngle = 'start' | 'end';

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
        distance: snapLength(Math.abs(value)),
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
        secondDirection: { end: 'blind', distance: snapLength(value) },
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
 * One drag of a revolve angle handle. The handle reports the effective angle:
 * an inverted revolve shows its sweep mirrored, so the stored angle is negated
 * on the way back. The whole gesture is a single undo step.
 */
export class RevolveAngleDrag {
  private before: Project | null = null;
  private changed = false;
  private currentValue: number;

  constructor(
    private readonly featureId: string,
    private readonly which: RevolveHandleAngle,
    private readonly inverted: boolean,
    initialValue: number,
  ) {
    this.currentValue = initialValue;
  }

  get value(): number {
    return this.currentValue;
  }

  get op(): ExtrudeFeature['op'] | null {
    return null;
  }

  get kind(): EdgeTreatmentKind | null {
    return null;
  }

  /** The chip of an angle handle reads degrees, not millimetres. */
  get unit(): 'angle' {
    return 'angle';
  }

  start(): void {
    this.before = useDocumentStore.getState().project;
    this.changed = false;
  }

  update(value: number): void {
    if (!this.before) return;
    const state = useDocumentStore.getState();
    const feature = state.project.features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === this.featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const revolve = feature.revolve ?? defaultRevolve();
    const stored = snapAngle(this.inverted ? -value : value);
    const next =
      this.which === 'start' ? { ...revolve, start: stored } : { ...revolve, end: stored };
    this.currentValue = this.inverted ? -stored : stored;
    state.preview({ type: 'feature/replace', feature: { ...feature, revolve: next } });
    this.changed = true;
  }

  end(): void {
    if (this.changed && this.before) {
      useDocumentStore.getState().commitPreview(this.before);
    }
    this.before = null;
    this.changed = false;
  }

  cancel(): void {
    const state = useDocumentStore.getState();
    if (this.before && state.project.features.some((f) => f.id === this.featureId)) {
      const feature = this.before.features.find(
        (candidate): candidate is ExtrudeFeature =>
          candidate.id === this.featureId && candidate.type === 'extrude',
      );
      if (feature) state.preview({ type: 'feature/replace', feature });
    }
    this.before = null;
    this.changed = false;
  }
}

/**
 * One drag of the edge treatment arrow. The first drag creates the operation: a
 * plain grab cuts a chamfer, holding shift rounds the corner, and the kind is
 * locked when the pointer is released. Later drags only change the size. The
 * arrow length is the offset of the created face, which is what the pointer
 * follows; the operation stores the radius or the leg distance.
 */
export class QuickEdgeTreatmentDrag {
  private before: Project | null = null;
  private featureId: string | null = null;
  private originalFeature: EdgeTreatmentFeature | null = null;
  private created = false;
  private locked = false;
  private changed = false;
  private currentSize = 0;
  private currentKind: EdgeTreatmentKind | null = null;
  /** Kind of the operation being edited; a fresh grab picks it every move. */
  private originalKind: EdgeTreatmentKind | null = null;

  constructor(
    private readonly geometry: EdgeTreatmentGeometry,
    private readonly name: string,
    private readonly featureIdHint?: string,
  ) {}

  /** The radius or leg distance the operation has; the chip shows it. */
  get value(): number {
    return this.currentSize;
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
    // Only the handle of an open operation edits it; a track on a selection
    // always starts a new one.
    const bound = this.featureIdHint
      ? project.features.find(
          (feature): feature is EdgeTreatmentFeature =>
            feature.id === this.featureIdHint && feature.type === 'edge-treatment',
        )
      : undefined;
    if (bound) {
      this.featureId = bound.id;
      this.originalFeature = bound;
      this.locked = true;
      this.originalKind = bound.kind;
      this.currentKind = bound.kind;
      this.currentSize = bound.size;
      return;
    }
    this.featureId = null;
    this.originalFeature = null;
    this.locked = false;
    this.originalKind = null;
    this.currentKind = null;
    this.currentSize = 0;
  }

  update(offset: number, shift = false): void {
    if (!this.before) return;
    // The arrow only grows into the corner; pulling it back past the edge is a
    // drag below the threshold, not a negative treatment.
    if (offset < MIN_EDGE_TREATMENT) {
      this.restore();
      return;
    }
    // An operation keeps its kind; a grab that has not been released yet can
    // still follow shift.
    const kind: EdgeTreatmentKind = this.originalKind ?? (shift ? 'fillet' : 'chamfer');
    this.currentKind = kind;
    // The pointer moves the created face, so the size follows from where that
    // face lands. A handle cannot resolve better than a tenth of a millimetre,
    // and the operation reads better without a long float in its field.
    const size = Math.max(
      0.001,
      snapLength(treatmentSizeForOffset(kind, offset, this.geometry.wedge)),
    );
    this.currentSize = size;

    if (!this.featureId) {
      const feature = buildQuickEdgeTreatment(this.geometry.target, kind, size, this.name);
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
      feature: { ...feature, kind, size },
    });
    this.changed = true;
  }

  end(): void {
    if (!this.before) return;
    const featureId = this.featureId;
    const changed = this.changed;
    if (changed && featureId) {
      useDocumentStore.getState().commitPreview(this.before);
      // The kind is part of the operation from now on: the modifier that was
      // held during the first grab cannot change it any more.
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
      this.originalKind = null;
      this.currentSize = 0;
      this.currentKind = null;
    }
  }
}
