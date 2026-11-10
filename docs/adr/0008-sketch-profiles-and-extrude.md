# ADR 0008 — Sketch profiles and the extrude operation

Status: accepted (M2)

## Context

Sketch faces (ADR 0006) existed only as an inspector list: nothing turned them into geometry, and the kernel protocol could only create boxes. M2 requires a real solid from a sketch, cutting and adding material in several bodies at once, which needs three things: exact profile curves, kernel operations for prisms and booleans, and a rule for when an extrude owns a body.

## Decisions

| Area | Decision |
|---|---|
| Profiles | `sketchProfiles()` turns the faces of `sketchTopology()` into extrusion profiles: ordered contours with exact lines, arcs and circles, plus a `reversed` flag for contours walked against the natural curve direction. Holes are reversed copies of their loops, so the outer contour is always counter-clockwise. Contours that are not closed are dropped. |
| Approximations | Ellipses and beziers are still sent as polylines (32 segments for ellipses) because the protocol has no exact curve for them yet. This is the only lossy path and is recorded as a follow-up. |
| Kernel ops | Three new worker requests: `make-prism` (wire → face → prism, transformed onto the sketch plane, supporting blind, symmetric and two-sided extents), `boolean` (fuse, cut, common between two shapes) and `topology` (faces and edges of a shape). OCCT stays behind the worker boundary. |
| Holes | A region becomes its outer prism minus one prism per hole, using the boolean cut. Adding hole wires to a face depends on OCCT's wire orientation rules and produced broken tessellations; cutting is exact and orientation-free. |
| Body lifecycle | An extrude with `op: 'new'` creates the body `featureBodyId(featureId)`. Switching the operation to add/cut/intersect removes that body ref, switching back restores it with the same id; metadata (name, colour, visibility) is never touched. Deterministic ids keep the object identity stable across these switches (ADR 0007). |
| Scope | `scope: 'all'` applies the operation to every body that exists at that point in the timeline; `scope: 'selected'` uses `bodyIds`. Selecting individual sketch faces to drive `regions` is the next step; until then a new extrude always uses the whole sketch. |
| Through all | The app computes a distance that covers the current model bounds along the sketch normal plus a margin, because the kernel does not know about the other bodies. |
| Errors | A missing sketch, a sketch without a closed contour and an operation without a target body are reported as feature errors on the timeline chip, with localized text. |
| Placement | The new operation is inserted at the timeline cursor like every other feature (ADR 0002), and rebuilding a later position drops the body it created. |

## Consequences

- The timeline is now able to produce solids that other operations can consume, which unblocks shell, hole and rib in M3.
- Rendering a body no longer requires it to come from a primitive: the rebuild pipeline keeps a body-id → shape-id map and tessellates the final shape of each body.
- Booleans between an extrude and an imported mesh body are not possible (a mesh has no B-rep); those targets are skipped until mesh → solid conversion lands in M3.
- Exact ellipses and beziers in profiles remain a follow-up; until then extruded ellipses have faceted walls.
