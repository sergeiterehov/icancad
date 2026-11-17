# ADR 0025 — Project models

## Context

Everything the app edited lived directly in the project: one feature history, one
body list, one metadata map, one timeline cursor and one section-plane set. A
project could hold exactly one part, and the tree above it had no place for a
second one or for a future assembly.

The next aggregation level is the **super-object**. A model is the first kind:
the thing that is edited in 3D and listed in the object tree. An assembly will
join it later, holding other super-objects instead of features.

## Decision

| Area           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data           | `Project` holds `superObjects: SuperObject[]` and `activeSuperObjectId`. `SuperObject` is a discriminated union by `type`; today it is only `Model`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Model          | A model owns its `features`, `bodies`, `metadata`, `view` (camera and section planes) and `historyEnd`. Models are independent spaces: the same project can hold unrelated parts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Commands       | Feature, body, metadata and history commands keep their shape but apply to the active model. Project commands cover `project/rename` and `model/add`, `model/activate`, `model/rename`, `model/remove`. A project always keeps at least one model.                                                                                                                                                                                                                                                                                                                                                                                                                |
| History        | Undo/redo stays project-wide. Snapshots include every model, while the active model is preserved across a restore when it still exists. Switching models is not an undo step. Adding, renaming and deleting a model are.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Kernel         | Only the active model is rebuilt and shown. Switching clears the scene, closes the sketch editor and picking, drops the selection and operation edit state, then rebuilds the new model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| UI             | Above the object tree, `ModelSwitcher` is an accordion. Only the header text changes when it toggles: collapsed it names the active model, expanded it reads "Project structure" (Структура проекта). The header never borrows the layout of a list row. The plus opens the menu of super-object kinds (only Model today); adding one expands the list and immediately starts renaming it in place. The row context menu also renames and deletes; its delete item uses the danger colour like every other delete. The active row uses the hover background, not the selection colour. Object rows keep their own `.tree-row` class; model rows use `.model-row`. |
| Project header | The project name moves next to the logo. The corner shows the `IC` mark, the product name and the editable project name; the model dock no longer carries a project strip. The model header takes the `Boxes` icon that used to mark the project.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Inspector      | With nothing selected, the inspector header names the active model and the body stacks its properties: name, variables and counts. A project context header below opens the project's name, units and variables. Sections, when enabled, sit above the model header as another property context.                                                                                                                                                                                                                                                                                                                                                                  |
| Schema         | `PROJECT_SCHEMA_VERSION` becomes 3. `parseProject` migrates a version 2 document by wrapping its flat history in one model named after the localised default ("Модель" or "Model"); the UI passes the name, while the schema falls back to "Model". Unknown and newer versions are still rejected.                                                                                                                                                                                                                                                                                                                                                                |
| Files          | `.icad` export includes every model. STL export, kernel statistics and the timeline act on the active model only. Imported assets are scanned across all models when a project is deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Consequences

- Existing projects and `.icad` files keep opening through the v2 migration; the
  first save writes v3.
- The object tree, timeline, inspector, viewport and selection helpers now read
  the active model through `activeModel(project)` / `useViewModel()` instead of
  reading the project directly.
- Model names are unique within a project. A new model takes the next free
  number after the localised default name ("Модель 2", "Model 2").
- A model with objects asks for confirmation before deletion. Deleting the last
  model is refused; the command reports `LAST_MODEL`.
- Imported meshes of a deleted model stay in storage, because the deletion is
  undoable. Project deletion still removes the assets no remaining model uses.
- Kernel rebuild snapshots are kept per model. Returning to a model reuses the
  operations it already computed instead of rebuilding from the first feature,
  and the shapes of cached snapshots stay alive until their model is deleted.
- Section planes and the camera belong to a model, so switching never moves the
  view of the previous model onto unrelated geometry. The viewport does not
  refit the first bodies of a newly opened model or project either: the camera
  stays where the user left it instead of flying to the new geometry.
- The project name placement from ADR 0024 ("the project name input lives in the
  model dock") is superseded by the corner header described above.
