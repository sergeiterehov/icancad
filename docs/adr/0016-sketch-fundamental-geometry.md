# ADR 0016 — Fundamental sketch geometry: origin and axes

Status: accepted

## Context

A sketch needs a frame of reference: an origin to measure from and two axes to
constrain against. Storing them as ordinary entities would give them a fresh id
in every sketch, so a constraint copied from one sketch to another would point
at nothing. Storing them also raises questions that have no good answer: can the
origin be deleted, moved, dragged or made construction?

The axes already existed as part of the sketch grid, but only as decoration:
nothing could be picked, snapped to or constrained against, and the origin was
not drawn at all.

## Decisions

| Area | Decision |
| --- | --- |
| A priori geometry | The origin point and the two axes exist in every sketch and are not stored in the document. They are not part of `SketchFeature.entities`, so they never enter undo history, serialization or region topology. |
| Identifiers | Fundamental geometry has the same ids in every sketch: `sketch:origin`, `sketch:x-axis`, `sketch:y-axis`. A constraint that references them keeps working when it is copied to another sketch. Stored entities use generated ids, so they can never shadow these. |
| Shape | Fundamental geometry is represented with the ordinary `SketchEntity` shape — a point at the origin and two lines through it — so constraints and the solver mapping handle it without a second code path. The lines are bounded only for hit testing; the solver treats them as infinite. Consumers build their lookup with `sketchEntityIndex` / `withFundamentalEntities` from `@icancad/sketch` instead of reading `feature.entities` directly. |
| Solver | The solver always receives the origin as a fixed point and the axes as fixed lines. Constraints to them therefore hold while user geometry is dragged, and the fundamental geometry can never move. `fix` constraints that name fundamental geometry are ignored. |
| Axis alignment | A point on an axis is solved as sharing that coordinate with the fixed origin (`horizontal_pp` for the X axis, `vertical_pp` for the Y axis) instead of as a point on the axis line. planegcs reports the line version as redundant, and a wrong DoF, as soon as the point is also joined to other geometry. |
| Snapping and selection | The origin is a snap target, so snapping to it produces a coincidence. The axes are not automatic snap targets: an unbounded line would catch ordinary clicks anywhere in the sketch, and drawing along an axis already adds a horizontal or vertical constraint. The axes are picked like stored lines and constrained explicitly — with a point selected they offer point-on-line, with a line parallel, perpendicular and angle, and with two points symmetry. The origin with a point offers coincidence, distance, horizontal/vertical distance and alignment. |
| Limits | The origin and the axes cannot be deleted, dragged, fixed, measured or made construction, and their control points are not grab targets. A `fix` action still applies to the stored geometry selected along with them. |
| Rendering | The axes and the origin are drawn with the grid of the sketch being edited, not with its entities. They take the selection and highlight colours, and they are hidden for sketches that are not being edited. |
| References | `SketchReference` measures stay limited to stored entities: the fundamental geometry needs no annotations of its own. |

## Consequences

- Constraints copied between sketches keep their anchor to the origin or an axis.
- Existing documents load unchanged; nothing new is serialized.
- Future projected geometry (ADR 0007 direction) can reuse the same stable-id scheme for external references.
