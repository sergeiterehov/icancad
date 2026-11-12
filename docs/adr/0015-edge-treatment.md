# ADR 0015 — Edge treatment: chamfer and fillet

Status: accepted (M3)

## Context

Chamfers and fillets are the two ways to break a sharp edge, and they differ only
in the shape they leave: a flat cut or a rounded corner. Both take the same
input (edges, or faces whose rim is treated), both are sized by a single number,
and both have to cope with a size the geometry cannot take.

The model already carried unused `fillet` and `chamfer` feature types with a
separate `EntityRef` edge list. Nothing ever created them: there was no kernel
operation, no rebuild step and no way to pick an edge.

## Decisions

| Area | Decision |
| --- | --- |
| One operation | Chamfer and fillet are one feature type, `edge-treatment`, with a `kind` field. The kind is part of the operation, so the history and the inspector tell them apart while the tool stays one button. |
| One tool | "Edge treatment" / «Кромка» in the tool rail, drawn as scissors — one tool that makes both kinds. The kind has an icon of its own, `square-arrow-down-right-enter` for a chamfer and `circle-arrow-down-right-exit` for a fillet — the corner with the material leaving it, or staying rounded; the inspector tabs, which choose the kind, and the history, which names the concrete operation, both use it. |
| Inputs | The operation stores the picked faces and edges with the pose they had at pick time: face refs as before, edge refs with start, middle, end, the bisector and the corner angle. A picked face contributes its rim — the edges shared with faces that are not picked — and carries the arrow pose measured on its first rim edge. |
| Several bodies | Inputs may belong to different bodies; the rebuild groups them, treats each body in its own kernel call and reports a failure per body. |
| Arrow | The quick operation is an arrow, drawn and dragged like the extrude one: a shaft from a point on the treated edge with a cone at its tip. It stands on the first treated edge — for a face, on its first rim edge — and grows into the corner. |
| Arrow length | The arrow is as long as the distance from the edge to the face the operation creates, so the tip sits on that face and follows the pointer. The operation stores the size a workshop would use instead: the corner radius of a fillet or the leg distance of a chamfer, converted with `s·cos(wedge/2)` and `s(1 − sin(wedge/2))/sin(wedge/2)`. Every value is snapped — a tenth of a millimetre for lengths, a whole degree for angles — so a drag never leaves a long float behind. |
| Availability | Any selected edge disables extrusion. A selected face offers both the extrude arrow and the treatment arrow; the treatment one stands on the rim, so the two do not compete for the same grab. |
| Colour | Handles are blue in both themes; selection stays purple. A handle is an affordance, not a selection. |
| Hover | What the pointer is over highlights while a tool is picking it and while a selection shows its handles: the edge when the pointer is on its line, otherwise the face. Over a handle the handle speaks for itself. The same tint therefore says what the treatment picker would take and what selecting next to an arrow would add. |
| Direction | The arrow points at the face the operation creates: into the material on the edge of a body, out into the notch on a concave edge, where a fillet adds its material. The bisector of the two face normals always points into free space, so it cannot tell the two apart; the corner is read from the triangles next to the edge — their smooth normals and which side of one face the other leaves from. Whole-face normals are not enough: the side of a cylinder has no single normal. The corner is stored on the reference when the edge is picked; the mesh of the finished operation no longer holds that edge, so a reference that carries no corner — a document saved before it was stored — is read against the input of the operation instead. |
| Locking | A plain grab cuts a chamfer; holding shift rounds the corner. The kind follows shift while the pointer is down and is stored when the drag ends; later drags of the operation's own handle change only the size, and the inspector changes the kind explicitly. Shift therefore grabs a handle instead of panning the camera, which is only true while the pointer is on the handle. |
| Always a new operation | The arrow that hangs off a selection never edits: it always starts a new operation, whatever the selection already belongs to. A second drag on the same edges therefore stacks a second operation instead of silently adopting the first. Editing goes through the operation itself — its handle while it is focused, or a double click on a face it created in the viewport. |
| Size limit | The web estimates a ceiling from the mesh: how far each adjacent face reaches away from the edge, split between the parallel picked edges of that face. The rebuild sends `min(requested, estimate)` so the common case builds once. |
| Oversized size | The kernel never fails just because the size is too large: it builds, checks the result, and bisects down until a valid solid appears, reporting `applied`. The inspector shows a yellow mark next to the size field saying which maximum will be used. |
| Feature identity | A treatment keeps the body it modifies: the body id, name, colour and owner stay, and only the shape changes. Every face the treatment merely trims keeps the operation that made it; only the surfaces it creates belong to the treatment. The kernel reports this through `Modified`: a trimmed face is a new B-rep face, so `IsSame` alone would hand the whole body to the last treatment. |
| Preview style | Red where the operation took material away, green where it added it, decided per created face: a face whose centre lies in the body before the operation took material, and one whose centre lies outside it added material. A face that runs round a hole — a chamfer on the rim of a bore — has its centre over the hole, so such a face is decided by where most of it lies. A treatment does not restyle its body. Unlike a boolean, the result is the body the user already has, so it is drawn opaque in its own colour instead of as a translucent ghost, and the tree does not mark it as changed. The coloured faces are opaque and lit like the model, so a rounded surface still reads as curved. The body mark stays silent — it only keeps picking on the input shape, so a stored edge ref resolves against the same mesh it was picked from. |
| Face anchor | A face is treated along its rim, so its arrow stands on the first rim edge and uses the same corner rule as an edge. The pose is measured when the face is picked and stored, so the handle does not depend on the face being resolvable again once the operation has rebuilt it. |

## Closed edges

A rim, such as the top edge of a round boss, is one closed polyline: its start
and end are the same point, so a pose taken from those two points has no
direction and could not be matched after a rebuild. An edge ref is therefore
matched by its start and its middle vertex, and the direction falls back to the
chord between them. Closed rims then resolve like any other edge.

## Kernel

`edge-treatment` takes the source shape, the kind, face ids, edge ids and a size,
and returns the result shape, its stats, `applied`, `limit`, the source face of
every result face and the number of treated edges.

Tessellation already collects the B-rep edges of a body, so the engine keeps them
per shape: `Add(размер, ребро)` needs the real `TopoDS_Edge`, and the ids the
viewport shows address exactly those. A shape that was never tessellated is
tessellated on demand.

`BRepFilletAPI_MakeFillet(shape, ChFi3d_FilletShape)` and
`BRepFilletAPI_MakeChamfer(shape)` share `Add_2(size, edge)` in the current
`opencascade.js` build. Two facts matter:

- `IsDone()` can be true while the result is self-intersecting, so every attempt
  is validated with `BRepCheck_Analyzer`; without that check an 8 mm fillet on a
  10 mm cube would be "successful".
- A rejected size throws a C++ failure that the published build turns into a
  broken JS object (`___cxa_can_catch is not defined`, sometimes a raw pointer).
  It is catchable and the module stays usable, but it carries no message, so the
  drag must not reach it: the mesh estimate keeps requests inside the envelope
  and the bisection only runs when the estimate was too optimistic.

All picked edges go into one maker, so adjacent faces get chamfers that meet at
the corner instead of two independent cuts.

One maker is not always enough. A set that mixes a concave corner with the
convex ones that end on it cannot be blended in one go: a fillet is rejected
outright at every size, and a chamfer comes back as a body with the chamfer
folded across it — which `BRepCheck_Analyzer` still calls valid, so the result
has to be avoided rather than detected. Every edge carries the corner it sits
in, read from the triangles of the two faces next to it when the body is
tessellated, and a set with both kinds of corner is built in two passes: the
concave edges first, then the rest, found on the intermediate shape by the
polyline each edge had. Concave first is what keeps the size the user asked
for — a convex round first eats the concave edge it ends on. The pass order is
remembered, along with the largest size that worked and the smallest that was
rejected, so a drag past the limit does not search again on every frame.

A body built in passes went through two shapes, so where each of its faces came
from is read through both maps: the second names a face of the intermediate
shape, and the first names the face of the source that face came from.

## Consequences

- Simple work stays in the viewport: select an edge, pull the arrow, the
  operation is there and focused. What a click would take is visible before the
  click, whether a picker or a handle owns the pointer.
- A handle is part of the operation, not a shortcut around it: the grab creates
  the operation and focuses it, and every later change happens inside that
  operation, so the history stays honest.
- The kind is a property of the operation, so changing it keeps the inputs and
  the size; the history still shows two different operations.
- A face input survives an edge renumbering because the face ref is stored, and
  the rim is derived again on every rebuild.
- The size a user typed is never silently replaced: it stays in the operation
  and the applied maximum is reported beside it.
- An edge that the kernel cannot treat at any size (a seam, a degenerate
  topology, a round that has nowhere to end) is still an error of the operation
  and blocks the timeline, as any other failing operation does. The handle is not offered when the estimate says
  there is no room for a visible treatment.
- A curved face has no rim rule of its own: its boundary edges are treated like
  any other, but a face whose tessellation has no edges yields no treatment.
- Persistent naming (M5) still applies: an edge ref resolves by its pose, so it
  survives renumbering, but a face the operation itself rebuilds cannot keep its
  identity.
