# ADR 0005 — Automatic constraints and construction geometry

Status: accepted (M2)

## Context

Sketch creation should feel direct: new points should attach to nearby geometry, nearly axial lines should become horizontal or vertical, and users need a way to mark helper curves without turning them into profile geometry. The earlier Shift-based opt-out was replaced by an explicit magnet tool.

## Decisions

| Area | Decision |
|---|---|
| Magnet | A magnet toggle in the sketch rail controls snapping and automatic constraints. It is enabled by default and persisted in local storage. |
| Snap radius | Points and curves are snapped within 10 screen pixels. Control points always win over curves during hit testing. |
| Snap targets | Point targets (including endpoints and curve control points) create coincident constraints. Line, circle/arc and ellipse targets create point-on-line, point-on-circle and point-on-ellipse constraints. |
| Axial lines | A new line within 5° of horizontal or vertical receives a horizontal/vertical constraint. |
| Apply policy | New geometry and its automatic constraints are written as one history operation. If the full set conflicts, the orientation constraint is dropped first; if snapping still conflicts, the raw snapped geometry is kept without automatic constraints. |
| Visual feedback | Geometry and target points/curves involved in an automatic constraint are purple, including the live preview. Once the pointer moves on, the highlight follows the next candidate. |
| Construction geometry | The ruler tool toggles the existing `construction` flag for selected entities. Construction curves are drawn dashed and muted, and remain valid solver geometry. The constraints tool uses a lock icon. |

## Consequences

- Automatic constraints are opt-out through a persistent tool state rather than a transient modifier key.
- A failed automatic constraint never prevents geometry creation.
- Profiles generated in the next milestone must ignore construction entities when building regions.
