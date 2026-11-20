# ADR 0035 — Extrude up to a face of a body

Status: accepted (M4)

## Context

An extrusion could stop at a free distance, at a symmetric pair of distances or
at nothing at all ("through all"). Users need the third thing CAD calls "up to
surface": pull a profile until it meets another part and end exactly on that
part's surface, with a gap in front of it or with material left on it.

Which of a body's two faces ends the sweep matters: the one that looks at the
profile, or the one on the far side. A pocket leaves the far side as a wall, a
boss or a tube ends on the near side. The extrusion therefore has two extents —
"front face" and "back face" — instead of one "up to body".

The first sketches of the feature asked for a picked _face_. Two facts made a
face the wrong target:

- a face is one surface, while a profile usually spans several of them — a stepped
  part, a filleted edge, a boss on a curved wall;
- a kernel has no primitive for "the half space on this side of a surface". The
  only operations available are prisms and booleans between solids.

A body, on the other hand, can be used directly in a boolean, and the boolean
follows every surface it has: curved, slanted, stepped, or all at once.

The offset is the second half of the problem. Moving the body along the sweep
looks like an offset on a flat wall, but a distance measured along the sweep
shrinks to nothing where the surface runs along it — at the silhouette of a
sphere, the end of the extrusion touches the body instead of standing clear of
it. What the extent needs is the body's surface moved along its own normals,
which the kernel now offers as `offset-shape`.

## Decisions

| Area                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extent              | `toBody.kind` is `first` (the face that looks at the profile) or `last` (the far face). Both sweep from the profile plane, so the result is always the column between the profile and the face it ends on.                                                                                                                                                                                                                                                                    |
| Target              | The body is optional. Without one, the sweep probes the profile against every body and takes the nearest for `first` and the farthest for `last`; a picked body is used as it is, which is how a user ignores a body on the way.                                                                                                                                                                                                                                              |
| Probes              | The contour of the profile plus a grid inside it are cast along the sweep against the tessellation of every body. The contour is where a face is usually met; the grid finds a body met under the middle of the profile, the far wall of a hole for instance.                                                                                                                                                                                                                 |
| Front face          | `prism − body`, where the body's surface has been moved out by the offset: the boolean follows that surface, so the tool ends on it however the profile meets it.                                                                                                                                                                                                                                                                                                           |
| Closing             | A prism that passes the body keeps what lies behind it as its own solid, cut off from the part in front by the body's material. Only the solids that reach the profile plane are kept, so that sliver never joins the result — on a flat face either, where a single prism reach would have left a shaving behind the wall.                                                                                                                                                   |
| Back face           | The front part plus the material of the body: `(prism − body) ∪ (prism ∩ body)`. For one wall this is the solid column from the profile to the far face, which is what "extrude to the back face" means.                                                                                                                                                                                                                                                                    |
| Profile in material | When the profile itself sits inside the body the region before the face is material, so `cut` becomes `common`. The probe points decide that once per extent.                                                                                                                                                                                                                                                                                                                 |
| Offset              | `toBodyOffset` moves the surface along its normals: the tool ends that distance from the body everywhere, on a wall as on a sphere. A gap stops short of the face the sweep ends on; a shell is the part up to the face minus the part up to the body moved out by that thickness, which is a skin and not a flat-ended cap. `toBody.mode` says which, and `toBodyOffset` is then a size; a document written before the modes existed still carries the way in the sign, which is what `signedToBodyOffset` reads. |
| Reach               | The prism reaches one millimetre past the body as the offset leaves it, so the body is cut out over the whole column and the sliver behind it is always separated from the tool. The single reach serves every operand of one extent, so a layer's two parts cancel exactly.                                                                                                                                                                                                   |
| Union               | `op: 'add'` passes the face by `UNION_EMBED`, the same hair a blind added extrusion shares with the body, because a tool that only touches a face does not fuse.                                                                                                                                                                                                                                                                                                              |
| Errors              | A sweep that misses every body, or a picked body that is gone, reports `TO_BODY_MISSING`; a boolean that leaves nothing reports `TO_BODY_EMPTY`.                                                                                                                                                                                                                                                                                                                              |
| Controls            | The extent is a fifth tab. Under it: "To side" — front face and back face, stretched up to the invert button, which only flips the sweep — then "Mode", solid/gap/shell, where a gap or a shell opens a size field of its own with the matching heading. The body is picked further down, in "Intersection search", because it narrows what the sweep may meet rather than how it ends. The free distance, the second direction and the distance handle do not apply and are hidden. |
| Files               | `extrudeToBody.ts` holds the probes, the crossing search, the body choice and the reach; `rebuild.ts` offsets the body, runs the booleans and drops the solids that do not reach the profile plane; `engine.ts` offsets a surface with `BRepOffsetAPI_MakeThickSolid`.                                                                                                                                                                                                          |

## Consequences

- A curved target needs no planar special case, and picking several coplanar
  faces is no longer a case at all: the body is one target.
- "Front face" is exact as long as the column in front of the body is air, and
  "back face" as long as what lies between the two faces is the body's material.
  A body with an overhang — a cap wider than its column — leaves the air under
  the overhang in a front extent, because "everything that is not the body" is
  what the boolean can express.
- A back extent fuses the front part with the material of the body, so a target
  the profile crosses more than once gives the body's material plus the space in
  front of it; a gap between two walls of the same body is not filled in.
- A profile inside the material flips the booleans, so "front face" cuts the
  material out up to that face instead of building a solid in the air.
- The profile has to be covered by the target: where it reaches past the body
  the prism meets nothing, and that part of the column is built to the extent's
  full reach instead of ending on a face.
- The offset is a real surface offset taken from the kernel. It is one OCCT
  operation per extent, and a body the offset maker cannot handle reports the
  extent as empty rather than building something else.
- Offsetting also fills the creases of the target: a boss standing on a wall no
  longer leaves a fin of the new body in the valley between the two, because the
  grown body spans it.
- The operation costs one offset, up to four booleans and no body copies. A
  split into solids happens only when the prism keeps a piece behind the body,
  which is the case the closing removes.
