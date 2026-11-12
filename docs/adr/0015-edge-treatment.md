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
| One tool | "Edge treatment" / «Кромка» in the tool rail, with a `stroke-linejoin="miter"` corner. The history uses `bevel` for a chamfer and `round` for a fillet, so the join of the stroke is the operation. |
| Inputs | The operation stores the picked faces and edges with the pose they had at pick time: face refs as before, edge refs with start, middle, end and the bisector. A picked face contributes its rim — the edges shared with faces that are not picked. |
| Several bodies | Inputs may belong to different bodies; the rebuild groups them, treats each body in its own kernel call and reports a failure per body. |
| Track | The quick operation is a radial track rather than an arrow: a short arc around the anchor with a knob. Pulling it to the right rounds the corners, to the left it cuts them. The arc saturates at the maximum size, the number does not: the operation keeps what the user asked for and the kernel applies what fits. Every handle value is snapped — a tenth of a millimetre for lengths, a whole degree for angles — so a drag never leaves a long float behind. |
| Leader | On an edge the track sits a fixed distance away along the outward bisector and a dashed leader connects it to the edge; there is no arrow, because an edge has no single direction to extrude along. |
| Availability | Any selected edge disables extrusion. A selected face offers both the extrude arrow and the track, anchored at the same point: the arc is the smaller target, so it wins the grab unless the pointer is clearly further up the arrow. |
| Colour | Handles are blue in both themes; selection stays purple. A handle is an affordance, not a selection. |
| Direction | The outward direction of an edge is the sum of the two adjacent face normals, which points into free space for a convex and for a concave edge alike. Positive is therefore always "round it" and negative always "cut it", and the face normal does the same job for a face. |
| Locking | The first drag picks the kind from the side it was pulled to and may still flip while the pointer is down. The kind is stored when the drag ends; later drags of the operation's own handle change only the size, and the inspector changes the kind explicitly. |
| Always a new operation | The track that hangs off a selection never edits: it always starts a new operation, whatever the selection already belongs to. A second drag on the same edges therefore stacks a second operation instead of silently adopting the first. Editing goes through the operation itself — its handle while it is focused, or a double click on a face it created in the viewport. |
| Size limit | The web estimates a ceiling from the mesh: how far each adjacent face reaches away from the edge, split between the parallel picked edges of that face. The rebuild sends `min(requested, estimate)` so the common case builds once. |
| Oversized size | The kernel never fails just because the size is too large: it builds, checks the result, and bisects down until a valid solid appears, reporting `applied`. The inspector shows a yellow mark next to the size field saying which maximum will be used. |
| Feature identity | A treatment keeps the body it modifies: the body id, name, colour and owner stay, and only the shape changes. Every face the treatment merely trims keeps the operation that made it; only the surfaces it creates belong to the treatment. The kernel reports this through `Modified`: a trimmed face is a new B-rep face, so `IsSame` alone would hand the whole body to the last treatment. |
| Preview style | A treatment does not restyle its body. Unlike a boolean, the result is the body the user already has, so it is drawn opaque in its own colour instead of as a translucent ghost, and the tree does not mark it as changed. What the operation does is shown on the faces it creates: red where it cut material away, green where it added material, opaque and lit like the model so a rounded surface still reads as curved. The body mark stays silent — it only keeps picking on the input shape, so a stored edge ref resolves against the same mesh it was picked from. |
| Face anchor | A face is treated along its rim, so its track sits on the first rim edge and points out of the corner, at half the angle between that face and its neighbour — the same bisector an edge uses. The stored face normal is the fallback once the operation has rebuilt the face. |

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

## Consequences

- Simple work stays in the viewport: select an edge, pull the track, the
  operation is there and focused.
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
  topology) is still an error of the operation and blocks the timeline, as any
  other failing operation does. The handle is not offered when the estimate says
  there is no room for a visible treatment.
- A curved face has no rim rule of its own: its boundary edges are treated like
  any other, but a face whose tessellation has no edges yields no treatment.
- Persistent naming (M5) still applies: an edge ref resolves by its pose, so it
  survives renumbering, but a face the operation itself rebuilds cannot keep its
  identity.
