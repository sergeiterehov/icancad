# ADR 0007 — Objects are derived from operations; properties live in a metadata sidecar

Status: accepted (M2 review)

## Context

The document still mixes three different things: the history of operations, the objects the model is made of, and the per-object properties shown in the inspector. Object records (bodies, sketches) carry their own name, colour and visibility, so editing an object property looks like editing the operation, and a rebuild that recreates an object has nowhere to keep what the user set for it. The same confusion shows up when walking the timeline: rolled-back objects are excluded from the view, but the document still stores them as if they existed.

## Decisions

| Area | Decision |
|---|---|
| Three data types | The document has exactly three kinds of data: **operations** (the ordered history, `project.features`), **objects** (what the model is made of at the current cursor), and **metadata** (properties of objects). They are stored separately and reference each other only by id. |
| Objects are derived | The object tree is the fold of the operations up to the timeline cursor. Nothing in the object list is authored by hand: bodies come from primitive/import/extrude operations, and a sketch object comes from a sketch operation (its faces, edges and points come from the sketch geometry). Moving the cursor back makes later objects **not exist**, not "hide": they leave the tree, the viewport and the kernel input. Moving forward applies the operations again in order and the objects come back. |
| Idempotent ids | Object ids are deterministic functions of the operations that produce them, and the inputs of that function are stored in the operations themselves (a primitive stores the body id it creates, a sketch stores the ids of its entities). Replaying the same operation sequence therefore always yields the same ids, so metadata and downstream references never lose their target. Content-derived ids (sketch faces, edges, points) are hashes of their defining geometry for the same reason. |
| Element ids | The same rule applies inside an object. A sketch turns into faces, edges and points whose ids are derived from the sketch entities: an edge uses the id of its sketch entity, a point uses the id of the entity plus the control-point index that defines it (the lexicographically smallest of the coincident references), and a face uses a hash of the edge ids on its contours. Rebuilding an unchanged sketch therefore produces exactly the same element ids, so selections, metadata and downstream references survive rebuilds, undo and redo. The ids change only when the defining geometry changes. |
| Metadata | `project.metadata` maps an object id to `{ name?, color?, visible? }`, the third data type. Metadata is never stored inside an operation and never inside an object record; it only references the object id. Reading a property is a lookup with defaults, so an object without metadata still renders. A sketch object does not use the metadata name: its name is the name of the sketch operation, so there is exactly one editable name per sketch. |
| Metadata lifetime | Editing a property is a metadata command, not a feature edit: it creates an undo step but never dirties the model. Rebuild, rollback, undo and redo leave metadata untouched, including entries for objects that currently do not exist — so rolling forward restores the user's names and visibility. Deleting an operation removes its objects and leaves their metadata orphaned; the file keeps it until the user purges it. |
| Sketch object vs sketch operation | The sketch operation owns the recipe (`plane`, `entities`, `constraints`) and the name. The sketch object is derived from it and shares that name; its metadata carries only visibility (and future non-name properties) keyed by the sketch object id. The timeline chip, object tree row and inspector all show and edit the same operation name. |
| Caching | Out of scope here: object and B-rep caches keyed by object id plus an operation-parameter hash are a later optimization. The architecture only requires that derived data is a pure function of the operations, which is what makes caching safe. |

## Consequences

- Implemented as a clean break: `project.metadata` is part of schema version 2 and there is no migration from version 1, because the product is not released yet. Old local projects are dropped on load and the app starts a new document.

- `BodyMeta` became `BodyRef` (`{ id, createdBy }`); names, colours and visibility live in `project.metadata`.
- `SketchFeature.visible` moves to metadata of the sketch object.
- A sketch object has no independent name: renaming it in the object inspector edits `SketchFeature.name`, exactly like renaming the operation in the timeline.
- The project file carries the metadata map next to the operations and object refs.
- Any future object type (faces, axes, images) follows the same pattern: an id produced by an operation, properties in metadata.
- A "purge orphan metadata" action is needed eventually so deleted objects do not accumulate.
