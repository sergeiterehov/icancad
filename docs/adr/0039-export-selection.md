# ADR 0039 — Export from the selection

Status: accepted

## Context

Export lived only in the project menu. It quietly chose its own scope: the
selected bodies when there was a selection, otherwise every visible body. That
is fine when the selection is the thing to write, but the menu item did not say
so, and there was no way to export a single object from the place the object is
actually handled — its context menu. File names also said only
`project - model`, even when the file contained one body.

The MEMO asks for an export entry in the object context menu, a clear
selected-or-whole-model question in the project menu, and a name that carries
the body when there is only one.

## Decisions

| Area | Decision |
| --- | --- |
| Context menu | Bodies and meshes offer `Export → STL, STEP`. STL can write both solids and meshes; STEP appears only when the picked objects include a solid body. Sketches do not offer export. The menu still acts on the clicked object, or on the whole selection when it includes that object. |
| Project menu | When a body selection exists, STL and STEP first ask **What to export? — Selected (N) / Whole model**. Without a body selection they keep their old, immediate behaviour. |
| Scope | **Selected** writes exactly the picked bodies, hidden ones included. **Whole model** writes every body of the model, hidden ones included. The no-selection path still writes the visible bodies, as before. |
| Naming | A selection with one object adds its name: `project - model - object.ext`. A multi-object selection, the whole-model scope and the no-selection path keep `project - model.ext` even when the model happens to contain one body, so only the explicit "this object" exports change the name. The object part is the tree name, slugified like the other parts. |
| Flow | The export flow moved into `stores/exportStore.ts`: scope question, STL quality request, STEP request, and the toasts. `ui/ExportDialogs.tsx` renders both dialogs once, so the project menu and object menus share one flow instead of duplicating it. |
| STL | The quality dialog still appears after the scope is known; its body list is fixed when the request is made, so a selection change while it is open cannot mix what the file contains. |
| STEP | No extra dialog: AP214 is written from the B-rep as it is. Meshes in a mixed selection are skipped with the existing warning; a mesh-only request reports that STEP needs solids. |
| Downloads | The byte-to-download step moved to `io/download.ts`, shared by the project archive and both CAD exports. |

## Consequences

- A body can be exported from the place it is picked, without going to the
  project menu first, and a one-body file says which body it is.
- The project menu now makes its scope explicit whenever a selection exists;
  "whole model" deliberately includes hidden bodies, while the no-selection
  path keeps the old visible-only behaviour.
- Both menus use one export store, so the two entry points cannot drift into
  different naming, quality or error behaviour.
- STEP remains export-only; import is the follow-up recorded in ADR 0038.
