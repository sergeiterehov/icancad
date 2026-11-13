# ADR 0014 — Drill-down selection and quick operation handles

Status: accepted (M2)

## Context

Selecting geometry in the 3D view used to stop at the object: a click on a body
selected the body, its faces were only reachable by starting an operation that
asks for faces, and edges could not be selected at all. Creating even a simple
extrusion therefore meant leaving the model, opening a tool and filling a panel.

The model also needs a place for the coming chamfer and fillet tools. Those
tools need edges, a way to decide whether an edge can be treated, and a way to
show that decision in 3D before the user commits to a gesture.

## Decisions

| Area | Decision |
| --- | --- |
| Selection depth | The first click selects the object, the next click inside that object selects the face or edge under the cursor. A click on another object starts at object level again. The rule is derived from the current selection; there is no separate drill mode. |
| Detail elements | `body-face` and `edge` are first-class selection kinds next to bodies, meshes, sketches, sketch faces and operations. Their ids are `bodyId#faceId` and `bodyId#edgeId`. |
| Edges | Edges are B-rep edges collected during tessellation (`BodyEdge`): a polyline, the two adjacent face indices and a deterministic id. Seams inside a single face are filtered out. |
| Handles | A handle is a 3D affordance offered by an operation, not a viewport mode. The operation returns `OperationHandle` descriptors (kind, origin, direction, value, enabled, tooltip, `beginDrag`). The viewport only draws, hit-tests and reports drag values. An extrude offers an arrow; an edge treatment offers a radial track (ADR 0015). |
| Prospective operations | A selected face or sketch offers the operation that could be created from it. Dragging its handle creates the operation and focuses it as soon as the drag starts: the operation is selected, its panel opens and the rest of the gesture drives the operation's own handle. |
| Focused operations | An operation offers its handles from its stored inputs (`faceRefs` or `sketchId` + regions). Dragging a focused handle edits that operation instead of creating another one. |
| Handle extents | A blind extrusion offers one handle per free extent: the primary direction and, when enabled, the second direction opposite to it. A `through-all` extent has no free distance, so that handle is not drawn. |
| What is available | A selected face offers the extrude arrow and, at the same point, the track of the edge treatment; the arc is the smaller target, so it wins the grab unless the pointer is clearly further along the arrow. Any selected edge offers the track only: an edge has no direction to extrude along, so extrusion is unavailable while one is picked. The sketch and its faces offer the arrow alone. |
| Handle colour | Handles are blue in both themes, hovered handles turn white. Selection keeps the purple accent, so an affordance never reads as a selected element. The whole arrow — line, cone and anchor dot — wears a one-pixel hairline of the space colour, drawn under it: the first body is blue as well, and a bare arrow on it almost disappears. |
| Method prediction | The method is predicted while an operation is new: a body face dragged along its outward normal joins the body, against the normal it cuts; a sketch cuts when material lies ahead of the profile, joins when the profile sits on a surface, and otherwise creates a new body. Cut wins over join when both have evidence. |
| Method locking | The method is stored in the feature when the drag ends. Later drags of the same operation change only the distance and the sign (`reversed`); the method never changes from a handle. The inspector remains the place to change it explicitly. |
| Direction | The handle value is signed along the outward normal. Passing through zero flips `reversed` and keeps the method. The drag axis is always the positive normal, even while the arrow is drawn on the opposite side, so the arrow keeps following the pointer after the flip. |
| Editing | A handle drag uses the document preview commands and commits the whole gesture with one history step. Escape and `pointercancel` restore the pre-drag state. |
| Preview of a join | A join draws the body exactly as it was before the operation. Only the material it adds is shown, as a green translucent ghost: the tool minus the base body. A cut keeps showing the removed volume. |
| Feedback | While dragging, a chip names the method (or the edge treatment side) and the size. Hovering a handle shows a tooltip that names what the handle changes. |

## Selection algorithm

`resolveSelectionHit` receives the richest hit the viewport found and the current
selection:

- A sketch face wins over the body it lies on when that sketch is selected.
- A body that is already in the selection is open: an edge within 6 px wins over
  its face, and the face wins over the object.
- A body that is not in the selection is selected as an object, even if another
  body is open.
- A visible sketch line selects the sketch object; a hidden sketch cannot be
  picked because the hit is compared with the front-most body.
- Empty space clears the selection.
- Cmd/Ctrl/Shift toggles the item at the level the rule above selected.

Double-click is unchanged: it opens the operation that produced the face. The
drill-down click is deliberately the single click after the double-click window.

## Radial track

An edge treatment is sized by one number on a known side, so its handle is a
radial track: a short arc in the plane the camera sees, with a knob that slides
along it. Pulling to the right rounds the corners, to the left it cuts them; the
side the first drag takes becomes the kind of the operation and no later drag
changes it. On an edge the track sits away from the edge and a dashed leader
connects them, because an edge has no arrow of its own.

## Handle lifecycle

1. The selection resolves to an operation handle or a prospective one.
2. Pointer down on the handle starts a drag before orbit, pan or selection.
3. The viewport reports the signed screen displacement along the projected axis
   (orthographic camera). A handle pointing at the camera is amplified rather
   than divided by zero.
4. The operation's drag object updates its inputs through the document preview.
   A prospective drag creates the operation on its first move and focuses it
   immediately, so the remainder of the gesture already edits the open
   operation; the first drag is still allowed to predict the method.
5. On release the drag commits and the viewport asks the operation for its
   handles again.

Opposite handles of one extrusion can lie on the same screen line. The hit test
then prefers the handle whose tip is closer to the pointer, so a reversed
primary handle does not steal a grab meant for the second direction.

## Sketch on the selected face

"Select face" in the sketch tool uses the single selected planar body face as
the sketch plane when there is one, and opens the sketch editor directly.
Otherwise it falls back to picking the face in the viewport. The plane keeps the
face reference (`bodyId`, `topoId`) and the pose it had when it was used.

The viewport never writes geometry: it owns hit-testing and the gesture, the
operation owns predictions, inputs and history.

## Edges and the coming chamfer and fillet tools

Edge polylines are produced by the kernel because the current OCCT build exposes
`BRep_Tool.PolygonOnTriangulation`, `BRepAdaptor_Curve`, `GCPnts_*`,
`BRepFilletAPI_MakeFillet` and `BRepFilletAPI_MakeChamfer`. Edge ids follow the
deterministic face/edge traversal of a shape, which is the same order a future
fillet or chamfer must use to address the edge; they are stable for as long as
the body rebuilds the same way, just like face ids (persistent naming is M5).

A chamfer or fillet will be another `OperationHandle` provider:

- it can hide its handle until a kernel feasibility query says the edge is
  usable, which is why `OperationHandle` has an `enabled` flag and an
  asynchronous-capable context;
- its method and size stay in the feature, so the same locking and preview rules
  apply;
- an oversized value will be clamped by the kernel and reported as the applied
  value; the handle reads the feature as the source of truth.

## Consequences

- Simple modelling stays in the viewport: select, drag, the operation is there.
- Operations are the single source of handle state, undo and persistence.
- Face ids are renumbered by booleans. A handle of a focused operation is built
  from its stored `faceRefs`, so the handle stays correct; reselecting a
  renumbered face can lead to a new operation. This is the known M5 limitation.
- Curved body faces still cannot be extruded, so they offer no handle; the
  inspector explains why.
- The preview of a join needs one extra boolean per previewed add (tool minus
  base) to show only the added material. It runs only while the operation is
  being edited.
