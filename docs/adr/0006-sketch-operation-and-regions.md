# ADR 0006 — Sketch operation vs sketch entity, and region selection

Status: accepted (M2 review)

## Context

The word "sketch" was used for two different things: the timeline operation that stores sketch data, and the geometric result that later operations consume. That ambiguity leaks into the UI (selecting a sketch in the tree and selecting a face created by that sketch look like the same action) and into the model (an extrude references `sketchId` plus a list of region ids without anyone defining where regions come from). Downstream features must pick either the whole sketch or specific faces it forms, so the boundary has to be fixed before extrusion is implemented.

## Decisions

| Area | Decision |
|---|---|
| Two entities | The **sketch operation** is a timeline step (`feature/sketch`): it holds the plane, the constraint-solved entities and the undo history. The **sketch entity** is the derived result of that step: points, edges and planar faces. Only the operation lives in the timeline; the entity is rebuilt from it after every edit. |
| Sketch entity contents | Points and edges carry stable ids derived from their source sketch entities (an edge is the entity id, a point is the entity id plus its control-point index), so an unchanged sketch always rebuilds the same elements. Faces (regions) are the closed planar areas bounded by edges, with holes nested inside their outer contour. Construction geometry never produces edges or faces. |
| Region identity | A region id is a deterministic hash of the ids of the edges on its contours and of its role (outer or hole). The id therefore survives undo/redo, reordering and unrelated edits, and changes only when the contour itself changes. A downstream feature whose region id disappears is reported as a broken reference on the feature in the timeline instead of silently rebuilding with different geometry. |
| Selection of a sketch | The Model tree and the timeline select the **sketch operation** (rename, delete, edit, visibility); for a downstream feature that selection means "the whole sketch", that is, every region it forms. The 3D viewport selects the **sketch entity**: a click selects an edge or a point, a click inside a closed area selects that face. Selecting the whole sketch and selecting all of its faces are the same thing for downstream operations. |
| Consuming a sketch | Extrude, cut, rib and similar operations accept either the whole sketch (all closed regions, holes preserved) or a subset of its faces. `ExtrudeFeature.regions` holds the chosen region ids and `scope: 'all'` means "every region of the sketch", so an operation survives a later edit that adds another region. |
| Editing after use | Editing a sketch rebuilds its entity; downstream features re-resolve their region ids on rebuild. New regions are not picked up by features that reference explicit faces — that is the point of selecting faces. |
| Object properties | Names, colours and visibility of sketch objects are metadata keyed by the object id, not fields of the sketch operation (ADR 0007). |
| Inspector | Selecting the sketch object shows its geometry: name, visibility, the faces, edges and points it is made of, and its extent. The tree keeps one row per sketch; derived elements are listed in the inspector, not expanded in the object tree. Selecting the sketch operation (timeline chip, and while the sketch is open) shows the recipe: name, the operation that created it, the placement (plane and offset), the composition and the constraints. Finishing the sketch hands the inspector back to the object |
| Naming in the UI | The timeline chip and the tree row keep the operation name (for example "Sketch"). Faces are named by their region, not by the operation, and are never listed as timeline entries. |

## Consequences

- The region builder (planar arrangement over tessellated curves) becomes part of the sketch package and runs before any operation that consumes a sketch.
- Selection needs a sketch-entity kind (`sketch` with `featureId`, plus optional `regionId`/`edgeId`/`pointId`), separate from the existing feature selection used by the timeline.
- Features that reference regions can be broken by sketch edits; the timeline must show that state rather than producing different geometry.
- Profiles and regions are computed in the sketch worker and cached per sketch revision, so extrusion does not re-tessellate on every rebuild.
