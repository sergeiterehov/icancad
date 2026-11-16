# ADR 0032 — Folders in the operations strip

Status: accepted

## Context

The timeline is a flat list in build order, and a long model makes it hard to
read: a sketch, the extrudes it feeds and the treatments on their edges sit in
one row of thirty chips, and there is no way to put a part of the history aside.
The user asked for folders: select neighbouring operations, group them, and see
one folder instead of the run.

Two things must keep working untouched. The rebuild walks the operations in
order and every reference is a feature id, so the build order cannot become a
tree. And the cursor is a feature id — a position between operations — so a
folder cannot own a cursor of its own.

## Decisions

| Area              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Storage           | A folder is `{ id, name, parentId }` in `Model.groups`; an operation names its folder in `groupId`. Order is never stored: a folder sits at its first operation and covers the run between its first and its last member, which is derived by `packages/model/src/groups.ts`. The flat list stays the build order.                                                                                                                                                                                                                                     |
| Commands          | `group/create` wraps neighbouring entries of one level — operations or folders, which is what nests a folder in a folder — and refuses a gap, a single entry, or entries from different levels. `group/rename` edits the name. `group/dissolve` lifts the children one level, so "Ungroup" keeps their place. `feature/remove` drops a folder that lost every operation, and a parent that only held it.                                                                                                                                               |
| Validation        | `validateHistory` reports `UNKNOWN_GROUP`, `GROUP_CYCLE` and `GROUP_NOT_CONTIGUOUS`. These are history errors like the rest: an edit that introduces one is rejected, and a project that already carries one stays editable. Drawing is defensive — a missing folder reads as the top level — so a broken file still opens.                                                                                                                                                                                                                            |
| Selection         | Folders are selectable items next to operations (`SelectionItem.kind === 'group'`), so a click selects the folder, a Cmd or Ctrl click adds it and Shift ranges over a level that mixes both. A second click opens the folder instead of selecting: the strip then shows that level, and a fixed block at its left — outside the scroll — carries the way out and the folder's name.                                                                                                                                                                   |
| Grouping a run    | The menu offers _Group_ when the selected items of the current level form one uninterrupted stretch that includes the clicked one. The store names the folder "Group 2", "Group 3", … after the existing names, creates it and selects it, so the inspector opens on its contents at once.                                                                                                                                                                                                                                                             |
| Contents          | A selected folder shows an editable name and a read-only list of its own level. Double-clicking an operation there opens the folder and selects the operation; double-clicking a nested folder opens that folder.                                                                                                                                                                                                                                                                                                                                      |
| Deleting a folder | Deletes every operation inside, recursively, through `removeFeatures`, so the dependents dialog and the keep-dependents choice behave exactly as for a selection of those operations.                                                                                                                                                                                                                                                                                                                                                                  |
| The cursor        | The cursor is still a flat position. A level clamps it to its own edges: a cursor after the folder sits after it on the level above and simply at the end inside it, before the folder it sits before it, at the start inside. Inside a folder the cursor is drawn on the folder itself — accent background, the moving hatch while the rebuild runs, red at the error barrier — and no caret is drawn on that level. A folder whose operation is selected or edited from elsewhere is lit like a hovered chip; the strip does not open it on its own. |
| New operations    | An operation created while a folder is open joins it, including one added at the folder's end; elsewhere it joins the folder that surrounds the cursor. The flat order and the neighbouring rule can never be broken by an insertion.                                                                                                                                                                                                                                                                                                                  |
| Persistence       | `PROJECT_SCHEMA_VERSION` becomes 4. Version 3 documents read as version 4 with no folders; version 2 still migrates into one model. Folders saved without any operation are dropped on load.                                                                                                                                                                                                                                                                                                                                                           |
| State             | The open folder is view state in `uiStore`, not the document: no undo entry, not saved, and reset when the model or project changes. A folder that disappears under the user (an undone grouping) returns the strip to the top level.                                                                                                                                                                                                                                                                                                                  |
| Rebuild           | Folders are not a build step, so they never reach it: `useRebuildScene` compares the history without `groupId`, and the open folder is not a dependency at all. Grouping, ungrouping and moving between folders therefore schedule no rebuild, while any edit to an operation still does.                                                                                                                                                                                                                                                              |

## Consequences

- Grouping never changes what the model builds; it changes what the strip shows.
- The strip is a tree of at most the folder depth, while everything that consumes
  the history — rebuild, dependencies, arrays, the object tree — still reads the
  flat list.
- A folder is drawn only while it holds an operation, so no empty folder can be
  entered or deleted; removing the last operation removes the folder with it.
- An operation added at the end of an open folder belongs to that folder, so a
  folder cannot capture an operation the user meant to place after it: the way
  out has to be taken first.
- Selecting a folder does not change the 3D view; operations inside it are not
  visible on the level above, so the folder is lit instead.
- Organising the strip costs no kernel work: a folder is saved with the project
  and drawn from the flat list, and the geometry kernel never hears about it.
