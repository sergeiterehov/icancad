# ADR 0003 — Sketch constraints and drag solving

Status: accepted (M2)

## Context

The sketch editor needs parametric constraints without blocking the UI. The solver must also support dragging control points, expose remaining degrees of freedom, and keep one user action as one history entry.

## Decisions

| Area | Decision |
|---|---|
| Solver runtime | planegcs compiled to WebAssembly, running in a dedicated module worker. The UI never calls the solver synchronously. |
| Constraint references | A constraint references sketch entities and optional control-point indices: `{ entityId, pointIndex? }`. This makes point-to-point constraints independent from primitive order. |
| Absolute fixation | `fix` stores the captured `x`/`y` anchor on the constraint. Rebuilding the solver from edited geometry cannot silently move a fixed point. |
| Solve policy | Solve on explicit constraint creation/editing and while dragging handles. Ordinary geometry edits do not trigger an implicit solve. Entering a sketch re-solves it once and silently repairs geometry that violated its own constraints (for example files produced before solutions were merged back). |
| Drag solving | Dragged points are passed as temporary fixed primitives. Dragging a whole curve is attempted with all of its control points pinned, then with only the grabbed point, and finally without pins, so a closed profile never turns into a false over-constrained error. Redundant results are accepted; only genuine conflicts revert the drag. Geometry is previewed without history while moving; pointer release commits a single undoable feature replacement. |
| Horizontal/vertical distance | planegcs has no point-to-point horizontal/vertical delta constraint. The mapping inserts an auxiliary point plus alignment constraints and a `p2p_distance`, then discards the auxiliary point when results are applied. |
| Angles | Constraint values are stored in degrees for the UI and converted to radians in the planegcs mapping. |
| Diagnostics | The solve result returns conflicting/redundant constraint ids and the remaining global degrees of freedom. A zero-DoF sketch marks every entity green. Otherwise each entity is probed in the solver worker: its control points are perturbed, the sketch is re-solved, and the moved state is validated by a second free solve. An entity with any feasible changed state remains blue; pinned infeasible states are rejected. This avoids false positives from locally rigid parts of an assembly that can still translate or rotate as a whole. |
| Symmetry | Two points plus a line use `p2p_symmetric_ppl`. Three points use `p2p_symmetric_ppp`, with the last selected point as the symmetry center, which makes it possible to constrain a point to the midpoint of two others. |
| Units | All sketch geometry and constraint values are in millimetres; angular dimensions are the exception and use degrees. |

## Consequences

- The document model stays serializable and independent from planegcs types.
- Auxiliary solver primitives never leak into the document or undo history.
- Future auto-constraints and dimension annotations should reuse the same constraint model and solver worker.
