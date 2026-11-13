# ADR 0022 — Revolving a profile around an edge

## Context

Extrusion was the only way to sweep a profile: the sketch face travelled along its plane
normal for a distance or through the whole model. Many parts are turned instead of pulled —
a flange, a shaft with a step, a bearing ring — and the user asked for a revolve as another
extent of the same operation, chosen in the same row of tabs as blind, symmetric and through
all.

A revolve needs one thing an extrusion does not: a line to turn around. The line can be a
world axis, an edge of a solid body, or a line drawn in a sketch; the sketch case matters
because the profile and its axis are usually drawn together. The sweep also has two ends
instead of one length, so both ends must be editable and grabbable in 3D.

## Decisions

| Area | Decision |
| --- | --- |
| Model | A revolve is not a new feature type. `ExtrudeFeature.method` is `extrude` or `revolve`, and `revolve` holds the axis and the two angles; every other field (operation, bodies, faces) keeps its meaning. Files saved before this change load as `method: 'extrude'` through a zod default. |
| Axis | `RevolveAxis` is a discriminated union: `world` (X, Y or Z through the origin), `body-edge` (body id, edge id and the pose captured at pick time) and `sketch-edge` (sketch id and line id). A body edge resolves against the mesh of the operation's input first and falls back to the stored pose when the body was rebuilt; a sketch edge follows the line, so editing the sketch moves the axis. |
| Only lines | A revolve axis must be straight. A body edge is resolved through its polyline and rejected when it bends; a sketch axis must be a `line` entity. The picker refuses a curved edge with `REVOLVE_EDGE_NOT_STRAIGHT` instead of silently turning the profile around a chord. |
| Angles | `start` and `end` are degrees, stored as the user typed them. `inverted` negates both, which mirrors the sweep without moving either control; the two angle fields and the invert button share one row, exactly like distance and its reverse button. |
| Kernel | `make-revolve` and `make-face-revolve` build the profile face as a prism does, rotate it to the lower angle with a `gp_Trsf`, then sweep it with `BRepPrimAPI_MakeRevol` through the positive difference. The kernel therefore never sees a negative or reversed angle, a sweep past a full turn is clamped to it, and a zero sweep is an error. |
| Picking | The axis picker is its own tool state (`pickingRevolveAxis`). While it runs, the viewport reports sketch lines as `sketch-edge` picks next to body edges, so one click selects either. Sketch faces, which the face picker offers, are ignored. |
| Handles | The operation offers two angular handles, one per angle. Each is a grip on the circle the farthest profile point traces around the axis, drawn with an arc from the profile to the grip. The grip is dragged by the pointer's angle around the axis: the ray is intersected with the plane through the arc centre, so the grip follows the pointer instead of a straight tangent. An edge-on arc has no readable angle, so it cannot be grabbed. |
| Drag commit | The whole drag is one undo step: `RevolveAngleDrag` previews the operation while the grip moves and commits it on release, like the distance arrow. The chip reads degrees, not millimetres. |

## Consequences

- Extrude, revolve and the second direction share the "Direction" panel: the four extents sit
  in one row and the panel below follows the choice, so there is no nested mode switch.
- A revolve of a face or a region that crosses its axis produces self-intersecting geometry;
  OCCT reports the failure and the operation keeps its error badge, as with any other kernel
  refusal.
- The axis is resolved against the bodies and sketches as they exist before the operation, so
  an operation can turn around an edge of a body it does not modify itself.
- A new revolve starts as a full turn around world Z. The user changes the axis with the X,
  Y, Z and edge tabs, and the tab remembers an edge between visits.
