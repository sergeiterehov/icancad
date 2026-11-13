# ADR 0003 — Sketch constraints and drag solving

Status: accepted (M2)

## Context

The sketch editor needs parametric constraints without blocking the UI. The solver must also support dragging control points, expose remaining degrees of freedom, and keep one user action as one history entry.

## Decisions

| Area | Decision |
|---|---|
| Solver runtime | planegcs compiled to WebAssembly, running in a dedicated module worker. The UI never calls the solver synchronously. |
| Constraint references | A constraint references sketch entities and optional control-point indices: `{ entityId, pointIndex? }`. This makes point-to-point constraints independent from primitive order. Fundamental geometry (origin and axes) uses the ids it has in every sketch, so a copied constraint keeps its anchor (ADR 0016). |
| Absolute fixation | `fix` stores the captured `x`/`y` anchor on the constraint. Rebuilding the solver from edited geometry cannot silently move a fixed point. |
| Solve policy | Solve on explicit constraint creation/editing and while dragging handles. Ordinary geometry edits do not trigger an implicit solve. Entering a sketch re-solves it once and silently repairs geometry that violated its own constraints (for example files produced before solutions were merged back). |
| Drag solving | Dragged points are passed as temporary fixed primitives. Dragging a whole curve is attempted with all of its control points pinned, then with only the grabbed point, and finally without pins, so a closed profile never turns into a false over-constrained error. A single dragged point whose exact position conflicts (the pointer is almost never exactly on a line or a circle) is also tried held on one coordinate only, so it slides along the constraints instead of undoing the drag. Redundant results are accepted; only genuine conflicts revert the drag. Geometry is previewed without history while moving; pointer release commits a single undoable feature replacement. |
| Horizontal/vertical distance | planegcs has no point-to-point horizontal/vertical delta constraint. The mapping inserts an auxiliary point plus alignment constraints and a `p2p_distance`, then discards the auxiliary point when results are applied. |
| Angles | Constraint values are stored in degrees for the UI and converted to radians in the planegcs mapping. An arc endpoint angle recomputed from the solved point is unwrapped to the representation closest to the stored angle: `atan2` jumps by 2π at the branch cut, which would otherwise reverse the arc's sweep and turn it inside out. |
| Diagnostics | The solve result returns conflicting/redundant constraint ids and the remaining global degrees of freedom. A zero-DoF sketch marks every entity green. Otherwise each entity is probed in the solver worker: its control points are perturbed along each coordinate in turn, held on that coordinate, and the sketch is re-solved. The moved state is validated by a second free solve, so an entity with any feasible changed state remains blue while pinned infeasible states are rejected. Probing one coordinate at a time is what keeps coupled geometry blue: a point whose motion requires other primitives to move may be projected straight back when both coordinates are held, hiding the motion. |
| Symmetry | Two points plus a line use `p2p_symmetric_ppl`. Three points use `p2p_symmetric_ppp`, with the last selected point as the symmetry center, which makes it possible to constrain a point to the midpoint of two others. |
| Multi-selection | Constraints that relate geometry apply to the whole selection: the first selected element is the reference and is constrained against every following one (equal, coincident, parallel, perpendicular, tangent, point alignment). Constraints whose target is a single curve or line (radius, diameter, angle, distance) stay pair- or single-target only. A constraint is offered only when it can consume every selected element, so a selection mixing roles (for example two lines and a circle) hides the constraints that would silently ignore part of it. The planegcs mapping still receives pairwise primitives; the group is expanded into a chain when the action is applied, in one undoable step. |
| Cross-selection | The constraint menu selects the geometry a constraint refers to, and the geometry menu selects every constraint that refers to the selected geometry. The same menu opens on a dimension chip in the editor, so a value can be traced back to its geometry or deleted without leaving the canvas. Both actions work on the whole multi-selection when the right-clicked item belongs to it, so a group of constraints and the geometry behind it can be inspected together. Constraint selection is kept as a set (additive click with a modifier); selecting constraints clears the geometry selection and vice versa. Opening a context menu never changes the selection, so a menu action on an already selected item covers the whole selected group. The geometry menu also deletes the selection, which drops the constraints and references that pointed at the removed geometry; fundamental geometry is never deleted. |
| Shortcuts | The tool rail and the constraint menu show their keys. Drawing tools take a bare letter (P, L, C, A, E, B), constraints take Shift plus a letter defined in `ui/constraintCatalog.tsx` (Shift+F fix, Shift+C coincident, Shift+L distance, …). A shortcut applies only when the current selection offers that constraint. Physical key codes are matched first, so the shortcuts keep working on a non-Latin keyboard layout. |
| Units | All sketch geometry and constraint values are in millimetres; angular dimensions are the exception and use degrees. |

## Consequences

- The document model stays serializable and independent from planegcs types.
- Auxiliary solver primitives never leak into the document or undo history.
- Future auto-constraints and dimension annotations should reuse the same constraint model and solver worker.
