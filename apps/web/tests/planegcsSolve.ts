import { createRequire } from 'node:module';
import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { Algorithm, GcsWrapper, init_planegcs_module, type ModuleStatic } from '@salusoft89/planegcs';
import { applySolverSolution, buildSolverPrimitives } from '../src/sketch/mapping';
import type { SketchSolveResult, SolverPin } from '../src/sketch/protocol';

/**
 * The solver the drag code talks to, backed by the real planegcs module instead
 * of a worker. Tests mock `src/sketch/client` with this module.
 */

let wrapper: GcsWrapper | null = null;

async function getWrapper(): Promise<GcsWrapper> {
  if (wrapper) return wrapper;
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm');
  const mod = (await init_planegcs_module({ locateFile: () => wasm })) as ModuleStatic;
  wrapper = new GcsWrapper(new mod.GcsSystem(), mod);
  wrapper.set_max_iterations(200);
  return wrapper;
}

export async function solveSketch(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  pinned: SolverPin[] = [],
  options: { diagnose?: boolean; derived?: readonly string[] } = {},
): Promise<SketchSolveResult> {
  const gcs = await getWrapper();
  gcs.clear_data();
  const { primitives } = buildSolverPrimitives(
    entities,
    constraints,
    pinned,
    options.derived ?? [],
  );
  gcs.push_primitives_and_params(primitives);
  const status = gcs.solve(Algorithm.DogLeg);
  if (status === 2) throw new Error('SOLVE_FAILED');
  if (status === 3) throw new Error('SOLVE_INVALID');
  gcs.apply_solution();
  return {
    entities: applySolverSolution(entities, gcs.sketch_index.get_primitives()),
    status: status === 0 ? 'success' : 'converged',
    conflicting: gcs.get_gcs_conflicting_constraints(),
    redundant: gcs.get_gcs_redundant_constraints(),
    dof: gcs.gcs.dof(),
    frozenEntityIds: [],
  };
}
