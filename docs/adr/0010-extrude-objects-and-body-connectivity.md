# ADR 0010 — Extrude objects, direction controls and connected new bodies

Status: accepted (M2)

## Context

The first face-picking pass only knew sketch faces, the inspector showed every
option even when the current operation could not use it, and "New body" could
contain several disconnected solids while the operation still looked like one
body. The second direction also offered "Through all" for operations that cannot
pass through material.

## Decisions

| Area | Decision |
|---|---|
| Body faces | An extrude object can be a planar face of any solid body. The kernel sweeps that exact face along its normal (`make-face-prism`), so arcs and holes keep their geometry. The face is identified by the OCCT traversal index and stores the normal and a point captured at pick time. |
| Planar faces only | A curved side cannot be swept into a closed prism. Picking checks that all triangles of the face share one normal and refuses the click with a toast; the kernel independently checks the OCCT surface type and returns `FACE_NOT_PLANAR` if a curved face reaches it. |
| Face highlighting | Selected objects are tinted in 3D. While picking, the face or body under the cursor is tinted too. Invalid body targets are red both in the list and on the body itself; the red state wins over the blue selected state. |
| Picking modes | Each list has a pencil button that starts picking and becomes a check mark. Faces and target bodies are picked in the 3D view; the two modes are mutually exclusive. Outside picking both lists are read-only, including their remove actions. |
| Central selection | While a picker is active, `documentStore.select` routes every selection event instead of replacing the selection: sketch faces feed a face picker, bodies feed a body picker, and everything else is ignored. This applies to the 3D view, the model tree and the sketch face list, so no source can close the picker by accident. |
| Target bodies | The list shows only explicitly chosen bodies. With none chosen it shows a single sentence: the operation applies to every body the extrusion intersects. Bodies that failed are still listed so their error is visible. |
| List shell | One `PickableSection` renders both lists: a section header with the pick action, rows with customizable icon/name/meta, optional error badge and optional remove action. |
| Error presentation | The operation's error is one red-tinted section directly above the target bodies, using the same rhythm as "Direction" rather than a rounded box. Body and face errors stay compact: a red row background and an exclamation icon whose tooltip carries the message. The icon is appended to the row, so the row's name and metadata are never replaced. |
| Failed timeline | Rebuild stops at the first failing operation, so later features are not built and their bodies are removed. The failed chip is red (no separate badge) and its tooltip explains the error. Only the cursor immediately after the failure is red; cursors beyond it are disabled without hover highlight. Positions up to the failed feature remain selectable, which lets the user inspect the model just before the failure. |
| Selection order | Objects are stored in `objectOrder` as `s:<sketchId>#<regionId>` or `b:<bodyId>#<faceId>` and listed top to bottom in the order the user picked them. Their visible face number is their position in that list, not a topological id. |
| Reverse direction | A toggle button sits at the end of the distance row and flips the primary direction. It is absent for symmetric extrusions, which already go both ways. |
| Second direction | The switch is the action of its own inspector section; the extent tabs and distance appear inside when it is on. |
| Hidden options | Controls that cannot apply are removed, not disabled: "Through all" is absent for new body / add, and the second direction offers exactly the same extents as the primary one. Changing the operation falls back to a blind extent instead of leaving an invisible through-all behind. |
| New body | Picked sketch regions are grouped by shared edges: one body per connected group, so a new body operation may still produce several bodies. A picked body face is always its own body. |
| Add connectivity | An add (fuse) that raises the number of solids in a target body would leave an independent solid inside it. For an explicitly chosen target that body is an error (`DISJOINT_UNION`) and keeps its previous shape. With "all bodies" the operation skips bodies the extrusion does not touch; only when nothing can be applied does the operation report `NO_TARGET_BODY`. |
| Per-face add errors | With explicit targets, a picked face that affects none of them would form an independent body. It is reported on its own Faces row with `DISJOINT_UNION`, even when other faces were applied successfully; the operation is also marked failed. |
| Loop containment | A closed loop is a hole only when every point of it lies inside the outer contour. Testing one vertex turned an overlapping circle into a hole, producing a crescent with a cutout instead of a full disk. |
| Planar faces | Curves are split at their crossings and the half-edge traversal yields every even-odd region. Two intersecting circles therefore give three faces (two crescents and the lens), all at depth 0, instead of two overlapping disks. |
| Face ids | Faces bounded by the same entities (the three intersecting-circle regions) still need distinct ids. Such faces are numbered by area and by their centroid relative to their own bounding box, so moving the sketch does not renumber them, while a single-boundary face keeps its entity-based id. |
| Shared edges | Each loop run carries a stable edge key (entity, endpoints, length), and adjacent faces that share a key are grouped. A new-body extrude sends one `make-prism` with all regions of a group, so all three intersecting-circle faces make one body, the two outer crescents alone make two, and the whole sketch makes one. |
| Exact partial curves | A run cut by an intersection is rebuilt as the exact arc between its ends instead of a chain of chords. The extruded side of a circle stays one cylindrical face, and crossing points come from exact circle/circle and line/circle solutions so the arcs join exactly. |
| Unified fuse | After fusing regions or adding material, `ShapeUpgrade_UnifySameDomain` merges coplanar and same-surface faces. A union of three regions has one top and one bottom face, so the result can be picked again as a single face. |
| Face labels | The Faces list keeps selection order, but every row shows the face's real index in the sketch topology (or the body face index), not the row position. Two different circles therefore show different face numbers. |
| New body identity | New bodies use stable slots (`body-0`, `body-1`, …) in selection order. Replacing the first picked face keeps that body's name and colour instead of creating a new identity. |
| Cut and intersect | These may split a body into several solids; the body container is allowed to hold them (ADR 0001). |
| Body identity | A new body per object keeps the id derived from its region or face, so metadata stays stable while the object is unchanged. |

## Consequences

- Two disjoint sketch regions still become two bodies, while regions that touch along an edge fuse into one (ADR 0009).
- Body face IDs are traversal indexes, so merging coplanar faces after a fuse changes the indexes of the resulting body. Downstream body-face references are re-picked rather than persisted.
- Adding material is checked with one extra topology query per target body. A
  disjoint result is rejected before it replaces the body, so the model never
  gains a hidden second solid through "Add".
- Implicit "all bodies" follows the inspector hint: only intersecting bodies
  participate. A body face can therefore be extruded without first adding its
  own body to the target list.
- Per-face errors need the tool parts to stay separate until the target loop;
  fusing them first would blame the whole operation for one unrelated part.
- Loop containment is deliberately conservative: touching or crossing loops are
  never holes, which keeps overlapping closed profiles usable as full faces.
- The operation error section explains the first failing body; every failing body
  keeps its own icon so several targets can be diagnosed at once.
- Because picking is modal, the inspector never mutates a list from an accidental
  click: entering the list's edit mode is an explicit action.
- Stopping at the first failure means the timeline cursor never represents a
  state that contains geometry the kernel could not build.
- Body face ids remain traversal indexes until persistent topological naming
  lands in M5; an earlier operation that changes face order can invalidate a
  body-face reference. Sketch face ids are derived from geometry and stay
  stable when unrelated entities are added or the sketch is translated.
- The pick-time planarity test is a tessellation heuristic, so the kernel check
  stays authoritative. A curved face that slips through is still rejected, and
  the user sees the same explanation.
