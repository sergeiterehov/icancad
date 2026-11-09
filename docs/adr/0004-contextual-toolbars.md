# ADR 0004 — Contextual toolbars and sketch annotations

Status: accepted (M2)

## Context

The first sketch editor duplicated tools in a floating viewport toolbar while the main top bar kept a non-functional Select button. Constraints were created from the inspector, and their relation to geometry was hard to see. Dimension values also lived only in the inspector, detached from the 3D sketch.

## Decisions

| Area                  | Decision                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Toolbar modes         | The top bar hosts exactly one contextual tool set. Outside a sketch it shows modelling tools; during sketch editing it switches to sketch tools.                                                             |
| Floating tools        | No primary tool palette floats over the viewport. The sketch hint remains as a non-interactive overlay.                                                                                                      |
| Standard mode         | The standard rail has no Select button. Section is separated from modelling tools and is available in every mode.                                                                                            |
| Sketch mode           | The sketch rail contains Select, creation tools, Constraints, Delete, Finish sketch and Section. Sketch mode ends only through Finish sketch.                                                                |
| Constraint creation   | Constraints are created from the sketch rail's Constraints menu using the current selection. The inspector never creates constraints.                                                                        |
| Inspector             | The inspector lists constraints, shows numeric values and allows deletion. Non-numeric constraints are inspected and deleted only there.                                                                     |
| Selection state       | `sketchSelectionIds` (geometry) and `sketchConstraintId` are mutually exclusive. 3D picking, the composition list and annotation chips all update the same state.                                            |
| Dimming               | Selecting geometry dims unrelated constraints. Selecting a constraint dims unrelated geometry in both the inspector and 3D.                                                                                  |
| Dimension annotations | Numeric constraints are rendered as screen-space chips anchored to projected 3D sketch points, with a dashed leader. Double-click edits the value; the solver applies it through the same constraint worker. |
| Section in sketch     | Section planes remain available while editing a sketch.                                                                                                                                                      |

## Consequences

- Toolbar behaviour is predictable and context-driven rather than split between unrelated surfaces.
- Constraint geometry and constraint list share one selection state, so highlighting is consistent everywhere.
- Dimension chips are HTML overlays for reliable text rendering and text input, but their positions are projected from 3D every frame.
