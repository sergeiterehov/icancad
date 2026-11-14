# ADR 0023 — Shell and cavity

Status: accepted (M3)

## Context

A hollow part is one of the first things a body needs after it is extruded: a
wall has a thickness, and the material inside or outside it is gone. The model
had carried a `ShellFeature` placeholder since the foundation, but nothing ever
created it: there was no kernel operation, no rebuild step and no UI.

The operation has to answer two different questions:

- picking a body means "hollow this body and keep its outside";
- picking a face means "open this face and hollow behind it".

The direction of the wall is the third question: the wall can be cut out of the
body (a cavity) or grown around it (a shell). A grown shell is an object of its
own, so the original body must stay. Its distance from the input also differs
from the wall thickness: the shell can stand off the body by a gap.

## Decisions

| Area | Decision |
| --- | --- |
| One operation | `shell` keeps both directions. `direction: 'inward'` is a cavity cut out of the body in place; `direction: 'outward'` creates a new body around the input and leaves the original untouched. |
| Inputs | `bodyIds` are whole-body targets. `removeFaces` are the faces that stay open. A picked face also adds its body to `bodyIds`, so the inspector always shows what the operation will change. Removing a body drops its open faces with it. |
| Face refs | Open faces are stored as `BodyFaceRef` with the pose they had at pick time, exactly like an extrude face. A rebuild after an operation that renumbered the faces still finds them. A closed curved face (a full cylinder, a sphere) has no single normal, so it is stored with a pose taken from one of its triangles and is resolved by its traversal index; that is the one case where an earlier renumbering can lose the link. |
| Two distances | `thickness` is the wall. `offset` is the gap between the input surface and an outward shell; it is 0 for a cavity and is edited only in the outward tab. |
| New bodies | An outward shell keeps one new body per input body, with the stable id `shellBodyId(featureId, sourceBodyId)`. The body is registered like an extruded body, so it gets a name, a colour and a row in the tree. A cavity changes the input body in place: its id, name and colour stay. |
| Kernel | `shell` runs `BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin`. The signed distance is `-thickness` inward and `+(offset + thickness)` outward. The closing faces are the open faces, so OCCT leaves exactly those faces out. `GeomAbs_Intersection` is tried first so outward corners stay sharp as a CAD shell expects, with `GeomAbs_Arc` as the fallback. |
| Closed cavity | Without open faces the maker returns the offset solid, not a wall. The kernel subtracts it from the body (`source − inner`) to get the wall and its closed void. An outward shell subtracts the inner offset solid from the outer one, so the gap is a real gap. |
| Open wall | With open faces the thick solid already is the wall; an outward gap subtracts the inner offset solid so the opening reaches the input surface. |
| Loose shells | The maker sometimes returns a closed shell instead of a solid (a body with a through hole does this). A lone shell is wrapped with `BRepBuilderAPI_MakeSolid` before any boolean work. |
| Invalid thickness | A thickness the geometry does not take is reduced, never failed: the kernel bisects down to the largest valid size and returns `applied`. The rebuild reports the smallest applied value across bodies and the inspector shows a yellow maximum next to the field. Holes whose size was never reduced keep the value the user typed. |
| Closed voids | A wall may enclose several voids, and a thin wall may split a void into pieces. That is the point of a thin-walled body; the result is accepted as long as it is a valid solid with a positive volume and the operation actually changed the body. |
| Preview | A cavity result is the modified input body, drawn opaque so the removed material reads as a hole. An outward shell is a normal "added" preview body, drawn as a translucent phantom over the input. |
| Failure | A body the kernel cannot shell keeps its per-body error badge and blocks the timeline, like any other failing operation. A face ref that no longer resolves is reported on its body row rather than being silently ignored. |
| Availability | The tool rail offers Shell next to Extrude and Edge treatment. With a selection of bodies or body faces the operation starts with those inputs; otherwise it opens the body picker. |

## Kernel sequence

1. Resolve the opening face ids to `TopoDS_Face` on the input shape.
2. Build the thick solid for the requested thickness with the closing faces.
3. Flip a negative-volume result and convert a lone shell to a solid.
4. For a closed result, subtract the offset solid from the body (inward) or the
   inner offset solid from the outer one (outward).
5. Reject an empty or invalid result, or an inward result that did not remove
   material; the bisection then tries smaller thicknesses.

The last good/bad thickness pair is cached per input shape, direction and face
set, so dragging the thickness past the limit does not rerun the search.

## Consequences

- A wall thickness that is too large for the part is clamped and shown, not an
  error; the user can read the real maximum from the inspector.
- A cavity with no open faces leaves one body with an internal void, which is
  the exact geometry of a hollow part; several internal voids are valid too.
- An outward shell is a separate object and the input stays, so the two can be
  compared, exported or deleted independently.
- The gap belongs to the shell direction; switching back to a cavity keeps the
  stored value but ignores it.
- `BRepOffsetAPI_MakeThickSolid` is fragile on some fused compounds; a body it
  cannot offset at any thickness stays an error of the operation, as with a
  treatment whose edge set cannot be built.
- Persistent naming (M5) still applies: a face with one stable normal survives
  renumbering by its pose, a closed curved face only by its index, and a face
  the shell itself rebuilds cannot keep its identity.
