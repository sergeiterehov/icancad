# ADR 0005 — Automatic constraints and construction geometry

Status: accepted (M2)

## Context

Sketch creation should feel direct: new points should attach to nearby geometry, nearly axial lines should become horizontal or vertical, and users need a way to mark helper curves without turning them into profile geometry. The earlier Shift-based opt-out was replaced by an explicit magnet tool.

## Decisions

| Area | Decision |
|---|---|
| Magnet | A magnet toggle in the sketch rail controls snapping and automatic constraints. It is enabled by default and persisted in local storage. |
| Snap radius | Points and curves are snapped within 10 screen pixels. Control points always win over curves during hit testing. |
| Snap targets | A snap is only applied when it can produce a constraint. Point targets (endpoints, arc and ellipse control points, circle centers, circle rim handles) create coincident constraints; segment midpoints create point symmetry so the new point becomes the midpoint; line, circle/arc and ellipse targets create point-on-line, point-on-circle and point-on-ellipse constraints. |
| Snap modes | A step reads the magnet according to what it can constrain. A free point takes every target. A circle radius and an arc start take control points for coincidence and curves for tangency. An ellipse corner has no control point of its own, so it does not snap. A step with no sensible constraint snaps to nothing. |
| Live snap and orientation | With the magnet on, the point under the pointer is resolved in one place: the magnet wins, then a line within 5 degrees of an axis is made exactly horizontal or vertical, and only a free point is rounded to the half-millimetre grid. The preview, the click and a stretch all use the same result, so a line that looks vertical is vertical before it is committed. |
| Duplicate constraints | Every expanded constraint is checked against the sketch before it is created, including each pair of a group and each automatic constraint. A constraint the sketch already has is not offered and is not added a second time. |
| Deletion | Removing sketch geometry also removes every constraint that references the removed entities. |
| Axial lines | A new line within 5° of horizontal or vertical receives a horizontal/vertical constraint. |
| Apply policy | Geometry is inserted synchronously so subsequent snaps and picks always see it, then automatic constraints are solved and appended in the same history entry. The whole solved geometry is merged back, because satisfying a new coincidence can move previously created curves. If the full set conflicts, the orientation constraint is dropped first; if snapping still conflicts, the geometry stays without automatic constraints. |
| Visual feedback | Geometry and target points/curves involved in an automatic constraint are purple, including the live preview. A snapped segment midpoint is shown as a phantom purple point so the implicit midpoint is visible before it is created. Once the pointer moves on, the highlight follows the next candidate. |
| Problem constraints | Conflicting or redundant constraints reported by the solver are stored in UI state. They are listed in orange with a warning bullet, and the Constraints header shows an orange warning icon whose tooltip explains the problem. Clicking the icon filters the list to problem constraints only; the icon disappears and the filter resets when no problems remain. |
| Construction geometry | The line-style tool toggles the existing `construction` flag for selected entities. Construction curves are drawn muted with an 8 px dash and 8 px gap in screen space, so zoom does not change the pattern, and remain valid solver geometry. The constraints tool uses a ruler icon. |

## Consequences

- Automatic constraints are opt-out through a persistent tool state rather than a transient modifier key.
- A failed automatic constraint never prevents geometry creation.
- Profiles generated in the next milestone must ignore construction entities when building regions.
