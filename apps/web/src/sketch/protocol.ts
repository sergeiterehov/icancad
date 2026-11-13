import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';

/**
 * A point held by the solver. Without an axis both coordinates are held; with
 * one, the point may still slide along that axis, which is what dragging a
 * point that is constrained to a line or a circle needs.
 */
export interface SolverPin extends SketchConstraintRef {
  axis?: 'x' | 'y';
}

export interface SketchSolveRequest {
  id: number;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  pinned?: SolverPin[];
  /** Derived entity ids (projections) held fixed while solving. */
  derived?: string[];
  diagnose?: boolean;
}

export interface SketchSolveResult {
  entities: SketchEntity[];
  status: 'success' | 'converged' | 'failed' | 'invalid';
  conflicting: string[];
  redundant: string[];
  dof: number;
  frozenEntityIds: string[];
}

export type SketchSolveResponse =
  { id: number; ok: true; result: SketchSolveResult } | { id: number; ok: false; error: string };
