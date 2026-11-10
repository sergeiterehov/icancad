# ADR 0009 — Extrude inputs, face picking and plane geometry

Status: accepted (M2); extended by ADR 0010

## Context

The first extrude rebuild only worked for sketches on XY, an operation could only be created when a sketch or a face was already selected, and the inspector listed "Sketch · 1 face" instead of the faces themselves. Users also asked to pick objects for an operation directly in the 3D view, and the extrude panel had to become readable: icons for the operation and the extent, a second direction without a nested block.

Investigating the XY-only bug showed that prisms were built in the XY plane and then moved with a `gp_Trsf` rotation; OCCT produced faces for those rotated shapes whose triangulation came back empty, so the body could not be meshed. Sketch faces were also unreachable in the 3D view, because picking only knew about bodies.

## Decisions

| Area | Decision |
|---|---|
| Plane geometry | `make-prism` builds wires, faces and the prism vector directly in the sketch plane (origin, xAxis, yAxis), so nothing is transformed after the prism is created. Circles get a `gp_Ax2` with the plane normal and the plane x-axis, which keeps sketch angles unchanged. |
| Handed frames | `datumFrame()` returns a right-handed frame for every datum plane: `normal = xAxis × yAxis`. The XZ normal is therefore `-Y`, which is also the direction the sketch is viewed from, so a positive extrusion always goes "into" the screen direction the user drew from. |
| Contour chaining | `sketchProfiles()` orients every contour by walking it and matching curve endpoints, then stretches line endpoints onto the neighbouring curve. OCCT only joins edges within 1e-7, and a gap below that produced a silently broken wire. Runs split by an intersection are emitted as exact arcs between their ends, so a partial circle stays curved instead of becoming a fan of flat strips. |
| Empty operations | `ExtrudeFeature.sketchId` is optional. The extrude tool is always enabled: without a selection it creates an operation with no objects, which builds nothing and reports no error. Objects are added afterwards. |
| Body ownership | An extrude owns a body only while it creates one (`op: 'new'`) **and** has objects. Picking the first object adds the body ref with the same deterministic id, clearing the objects removes it. |
| Body targets | `scope` describes the extruded regions only. Bodies to combine with come from `feature.bodyIds` when set, otherwise from every other body, so adding material works for face-driven extrudes too. |
| Face picking in 3D | Every visible sketch publishes its faces (`outline` plus hole outlines) to the scene, which adds invisible `ShapeGeometry` meshes. A click resolves to `{ kind: 'face', sketchId, faceId }` and selects `sketchId#faceId`, the same id the tree uses. While an operation is picking, face hits win over bodies so a face stays clickable after it has been extruded. |
| Bodies per region | An extrude that creates bodies groups selected regions that share an edge and sends one `make-prism` per group, registering one body per group with a stable `body-<slot>` id. Two circles that do not touch are two bodies, concentric circles and intersecting-circle regions are one connected group, and the inner face of a ring stays a hole of its outer region. Keeping the slot in the id means the body keeps its metadata when regions come and go. |
| Derived body refs | The kernel reports the bodies it produced and `syncCreatedBodies()` reconciles `project.bodies` with that list — adding missing refs and removing stale ones. This reconciliation is not an undoable edit: bodies are derived objects, so only the operation that produces them is. Existing metadata is kept when a body comes back. |
| Body names and colours | Body numbers come from `metadata.bodyIndex`, which is stored with every body ever created, so the next body continues the project sequence ("Body 3") instead of restarting per operation. Colours cycle through `BODY_COLORS` by the number of bodies in the project at creation time, exactly like the box primitive, so two bodies made in one rebuild get different colours. |
| Panel layout | Operation and method options are segmented tabs in a single row, with an icon and a label inside each tab: four tabs for the operation (new body, add, cut, intersect) and three for the method (blind, symmetric, through all). The control reuses the look of the sketch plane selector (`Segmented`/`SegmentedTab` in `Controls.tsx`, 26 px tall, inset on `panel-2`, active tab on `panel-3`), so the inspector has one switch style instead of one per panel. Labels never wrap: tabs share one line and truncate with an ellipsis only if the panel is dragged narrower than the labels. The second direction is a switch row followed by its own two-tab extent row; vertical rhythm comes from one stack container and the distance field uses the same border and height. |
| Body statistics | Stats are recorded per body and summed per operation, so selecting an operation with several bodies reports their total faces, edges, triangles and a merged bounding box. |
| Picking flow | The Objects panel has a pencil button that starts picking (it becomes a check mark). Clicks in the view toggle faces of the operation: a face already in the list is removed, a new one is added, and a face from another sketch switches the sketch. Rows in the list can also be removed individually. |
| Extent icons | Blind is an up arrow, symmetric is an up-down arrow, through all is an infinity sign and intersect is drawn as the overlap of two circles. The second direction is a switch row above its extent icons instead of a nested block. |

## Consequences

- Extruding on XZ and YZ produces the same body quality as on XY; the kernel test suite extrudes one region in all three planes.
- A face-driven extrude no longer fails when other bodies already exist, because body targets no longer depend on the region scope.
- Sketch faces are now first-class in the viewport: selecting them, extruding them and removing them from an operation all use the same `sketchId#faceId` ids, so metadata and future operations can rely on them.
- An operation without objects stays in the timeline with no geometry; later operations that depend on the missing body report their own errors.
