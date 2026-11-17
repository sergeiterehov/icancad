import {
  Algorithm,
  GcsWrapper,
  init_planegcs_module,
  type ModuleStatic,
} from '@salusoft89/planegcs';
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { diagnoseFrozenEntities } from './diagnostics';
import { applySolverSolution, buildSolverPrimitives } from './mapping';
import type { SketchSolveRequest, SketchSolveResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<SketchSolveRequest>) => void) | null;
  postMessage: (message: SketchSolveResponse) => void;
}

const scope = self as unknown as WorkerScope;
let wrapper: GcsWrapper | null = null;

async function getWrapper(): Promise<GcsWrapper> {
  if (wrapper) return wrapper;
  const module = (await init_planegcs_module({
    locateFile: () => wasmUrl,
  })) as ModuleStatic;
  wrapper = new GcsWrapper(new module.GcsSystem(), module);
  wrapper.set_max_iterations(200);
  return wrapper;
}

scope.onmessage = (event) => {
  const request = event.data;
  void (async () => {
    try {
      const gcs = await getWrapper();
      const solveWith = (algorithm: Algorithm) => {
        gcs.clear_data();
        const { primitives } = buildSolverPrimitives(
          request.entities,
          request.constraints,
          request.pinned,
          request.derived,
        );
        gcs.push_primitives_and_params(primitives);
        return gcs.solve(algorithm);
      };
      // DogLeg is the usual choice, but a solver that fails on it may still
      // find a solution with another method. A failed attempt leaves the
      // parameters mutated, so every attempt starts from a fresh system.
      let status = solveWith(Algorithm.DogLeg);
      if (status === 2 || status === 3) status = solveWith(Algorithm.LevenbergMarquardt);
      if (status === 2 || status === 3) status = solveWith(Algorithm.BFGS);
      if (status === 2 || status === 3) {
        scope.postMessage({
          id: request.id,
          ok: false,
          error: status === 2 ? 'SOLVE_FAILED' : 'SOLVE_INVALID',
        });
        return;
      }
      gcs.apply_solution();
      const solved = gcs.sketch_index.get_primitives();
      const entities = applySolverSolution(request.entities, solved);
      // Auxiliary primitives carry the id of the authored constraint they
      // serve; the UI knows constraints, so report the authored id.
      const normalize = (ids: string[]) => [
        ...new Set(
          ids.map((id) => request.constraints.find((c) => id.startsWith(`${c.id}~`))?.id ?? id),
        ),
      ];
      const conflicting = normalize(gcs.get_gcs_conflicting_constraints());
      const redundant = normalize(gcs.get_gcs_redundant_constraints());
      const dof = gcs.gcs.dof();
      const frozen = request.diagnose
        ? diagnoseFrozenEntities(gcs, entities, request.constraints, dof, request.derived)
        : [];
      scope.postMessage({
        id: request.id,
        ok: true,
        result: {
          entities,
          status: status === 0 ? 'success' : 'converged',
          conflicting,
          redundant,
          dof,
          frozenEntityIds: frozen,
        },
      });
    } catch (error) {
      scope.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
