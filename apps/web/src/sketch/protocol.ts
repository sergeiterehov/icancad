import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';

export interface SketchSolveRequest {
  id: number;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  pinned?: SketchConstraintRef[];
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
