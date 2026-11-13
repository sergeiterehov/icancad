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
      gcs.clear_data();
      const { primitives } = buildSolverPrimitives(
        request.entities,
        request.constraints,
        request.pinned,
        request.derived,
      );
      gcs.push_primitives_and_params(primitives);
      const status = gcs.solve(Algorithm.DogLeg);
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
      const conflicting = gcs.get_gcs_conflicting_constraints();
      const redundant = gcs.get_gcs_redundant_constraints();
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
