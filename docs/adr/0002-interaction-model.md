# ADR 0002 — Interaction model, selection and settings

Status: accepted (M0 review)

## Context

The first working shell exposed conceptual ambiguity: the left panel and the bottom timeline both listed features, "history" was unclear relative to undo/redo, rollback had no explained meaning, program settings were mixed with project properties, and selection only worked from the tree. Native tooltips and selectable UI text also broke the intended Figma-like feel.

## Decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| Source of truth | The feature timeline is the single ordered list of operations | One mental model (Fusion/Onshape) instead of two competing lists |
| Left panel | A single object tree under Model: bodies and future object types, with no section headers or counters. An imported STL becomes a body directly; there is no separate asset row | The tree is for navigation, not for history, and must scale to new object types without exposing storage details |
| Undo/redo | Edit-history stack over document commands | Standard editing semantics: undo reverts a change to the document |
| Rollback | Caret strip between operations (including before the first and after the last); hover reveals it, tooltip names the target position, click moves the marker; later operations stay in the document but are not rebuilt and the bodies they create disappear from the model tree. Selection is sanitized when it leaves the active history. New operations are inserted at the cursor, not appended: the new operation takes the cursor position and later operations stay rolled back until the user moves forward again | Works like a text cursor, makes the insertion point obvious and keeps the tree consistent with the rendered model |
| Editing in the timeline | Entering sketch editing moves the history cursor to that sketch and keeps it there while the sketch is open. Rollback carets and the rollback context action are disabled until the sketch is finished (or cancelled), after which the previous cursor position is restored. Sketch editing is opened by a double click, both on the Model tree row and on the sketch chip in the timeline; double clicks on other operations do nothing for now. | An edit belongs to its own timeline position: a sketch may project geometry, and only geometry that existed at that moment may be referenced |
| Selection entry points | Tree and 3D viewport are equivalent and synchronized | Either path is a first-class navigation tool |
| Empty click | Clears selection; inspector falls back to project properties | Predictable way out of a selection |
| Selection granularity | Single click selects face/edge, double click selects body; tree selection selects body. Sketches follow the same split: the tree and timeline select the sketch operation, while the viewport selects sketch points, edges and faces (regions). A feature consumes either the whole sketch or the selected faces, see ADR 0006 | Direct manipulation of faces/edges is the common CAD flow; body-level edits stay one gesture away |
| Multi-selection | Selection is a list of body/feature items; Cmd/Ctrl/Shift toggles items in the tree, timeline and 3D | Multi-body workflows are a first-class requirement |
| Selection feedback | Selecting an operation gives it a background highlight (never an icon recolor) and does not dim other operations; selecting a body dims unrelated operations while its own operation stays normal. Imported mesh operations and their mesh objects are linked in both directions. The bodies tree is never dimmed | The timeline and the model must read as one structure without competing selection colors |
| Timeline strip | One row of icon-only buttons at fixed height (button plus padding), no panel header, no button background, horizontal scroll, name in a tooltip | Matches Fusion's construction bar and avoids scale-dependent padding |
| Rebuild selection lock | While the model is recalculating, a geometry pick inside any active picker is refused with a message that selection will be available after the rebuild. Entering the picker is still allowed, and nothing is selected. | Picking against a model that is about to change produces stale references. |
| Rebuild progress | The history caret immediately after the operation currently being rebuilt becomes a 3 px / 3 px dashed line moving upwards at 10 px/s. It advances to the next caret as the rebuild moves through the history. It keeps the caret colour: blue when active, red at the error barrier, and muted when the caret would otherwise be invisible. | The timeline already shows where the model is evaluated, so progress belongs there rather than in a separate spinner. |
| Multi-selection inspector | Lists selected objects and aggregate statistics (triangles, union bounds); editing only for a single object | Bulk editing needs a different UI that does not exist yet |
| Dimensions | Three compact X/Y/Z fields in one row with tooltips, Figma-style | Fits three values into a narrow inspector |
| Object actions | Hide/show, delete and rollback live in context menus on tree rows, timeline chips and 3D bodies | The inspector is for properties; one-off actions belong to the object under the cursor |
| Adding objects | `+` in the Model header opens a menu with Import and Box; import restricts the file picker to supported formats | One entry point for every object type, with formats enforced up front |
| Top bar | Brand and project left, tools centered, undo/redo separated from open and a combined export menu on the right. The export menu offers Project, then STL or STL with the selected body count | Tools are the primary mode switch; file actions stay together, and STL export follows the selection |
| View controls | Navigation cube in the viewport: faces set orthographic views, edges between two faces give edge-on views, corners give isometric views; drag rotates the camera; hovering tints the whole face or draws a gradient from the targeted edge/corner, both in the same accent color, so the direction stays readable; right-click opens a view menu with fit and all standard views, labeled in normal case with muted axis hints (+Z, −Y, …); there is no separate fit button | View state belongs to the viewport, not to the app chrome |
| Camera moves | Every programmatic camera change (fit, navigation-cube faces, edges and corners, entering and leaving a sketch) is animated for 500 ms with ease in/out; zoom interpolates geometrically and rotation takes the shorter arc. Direct manipulation (orbit, pan, wheel zoom, click) cancels a running animation. Entering a sketch frames the sketch content with a 50 px margin on every side, so switching between sketches always refits instead of keeping the previous framing; the view from before the first sketch is remembered and restored, animated, when editing ends. An empty sketch keeps the current zoom and only centres on its plane | A jump cut hides where the camera went, while a fixed framing makes every sketch readable at its own scale |
| Section view | Lives in `view.sectionPlanes` (no history entries). Any number of planes with X/Y/Z orientation, offset and visibility, laid out in one compact row; clip planes intersect; stencil caps are hatched in the color of the body they cut. Hatch spacing and direction are fixed screen-space values (6 px / 45°), so the user only positions the section. The section tool enables the section view: when it is off, the inspector block is hidden and no section is rendered, but each plane keeps its own visibility state so turning the tool back on restores exactly the previous view. The tool on/off state is stored with the browser settings and survives reloads. While a sketch is being edited the sketch plane joins the section set as a fixed first entry: it turns on with the section view, can only be hidden or shown, and cannot be rotated, offset or deleted, because its position is the sketch plane itself. The sketch plane cuts the model on the far side of the camera so the section face at the sketch plane stays visible; it is never written to the project. | A section is a way to look at the model, not a modeling operation; screen-space hatching stays readable at any zoom, and per-body color shows which body a cut belongs to. Tool state must not overwrite the user's per-plane choices |
| Icons | Section view uses the layers icon, bodies use a cube icon tinted with the body color, the import operation uses the import icon | The symbol should describe the thing or action, while body color stays the identifying cue |
| Startup | The splash keeps the brand mark and spinner, with a line below explaining that the project and operation history are loading | A black screen without context looks like a hang |
| Sketch entry | The Sketch tool opens a datum-plane menu (XY/XZ/YZ). A sketch is a document feature, appears in the model tree with its own visibility eye and in the timeline, and double-clicking its tree row opens the editor. Editing happens in the main 3D viewport: the camera aligns to the plane normal, the sketch grid and entities are rendered in the 3D scene, and clicks are projected onto the sketch plane. Finished sketches remain visible in 3D. A floating toolbar switches entity tools. The inspector lists the sketch composition and, while editing, the constraints block | Sketching is a mode of the same viewport, not a separate drawing app; sketches stay spatially anchored to their datum plane and to the surrounding model, and remain part of the object tree |
| Sketch entities | Point, line, circle, arc, ellipse and Bezier are drawn with click sequences. Curves are 2 px screen-space lines with a 2 px pick halo; control points are 4 px circles, black in the light theme and white in the dark theme. Primitive control points are selectable independently from their curve. Selection changes color and line width instead of adding an outline; Cmd/Ctrl/Shift toggles multi-selection, and Delete lives in the floating toolbar, disabled when nothing is selected. Dimensions and constraints arrive with the solver | Covers the required base geometry with constant screen-space weight and a selection model consistent with the rest of the app |
| Language control | Globe icon in the status bar opening a menu, styled like the theme toggle | Avoid a native select and its chevron |
| Status bar | Save state on the left; the kernel progress is a button showing only the load time (or the running task). Hover gives a short hint, click opens a popover with version, counts and the task queue, including cancel | Keeps the bar quiet while preserving detail on demand, and makes the queue actionable |
| Program settings | Language and theme live in the status bar and browser storage | They describe the user, not the project; `.icad` stays portable |
| Status bar | Kernel info as a tooltip, save state, language, theme | Program-level surface with no project noise |
| Inspector | Only properties of the selected object, or project properties when nothing is selected | The panel must answer "what can I edit now?" |
| Tooltips | Custom portal tooltip only; 1.5 s delay; mandatory for icon buttons, including disabled ones | Native titles are slow and unstyled; icon-only controls need self-documentation |
| Help content | Added only when a real question appears, not preemptively | Avoids speculative, stale documentation |
| Text selection | Disabled globally; enabled for inputs and values | CAD UI must not feel like a web page; numbers still need copying |
| Long operations | Kernel work runs through a serialized task queue; repeated rebuilds coalesce into the latest one; navigation stays live | Keeps the UI responsive without freezing the document |
| Queue failures | A failed task cancels every queued task behind it | Later tasks would build on a broken state |
| Queue visibility | Status bar shows the running task and the queue size; the tooltip lists the queue | Long operations must never look like a freeze |
| Cancel | Cancel rejects queued tasks and restarts the kernel worker, then rebuilds from the document | OCCT calls cannot be interrupted cooperatively inside one worker |
| Block headers | Contrasting text, not only uppercase | Faster scanning of dense panels |

## Consequences

- The selection store holds a list, so every consumer (tree, timeline, viewport, inspector) must work with sets instead of a single object.
- Multi-selection renders a summary, not editable fields; bulk editing is a later feature.
- Context menus must be reachable from every place an object is visible (tree, timeline, 3D), otherwise hiding objects becomes undiscoverable.
- The navigation cube is a second small WebGL context; it must stay in sync with the main camera and rebuild label textures on theme/language change.

- Feature lists appear exactly once (timeline); adding a "features" section to the left panel is a regression.
- Rollback and undo/redo must be documented in the UI (timeline tooltip) because they are orthogonal.
- Face/edge picking needs a stable face id from the kernel; until M1 ships it, single click selects the body and double click is unused.
- The queue lives in the app layer (`kernel/scheduler`), so M5 can swap the single worker for a pool without changing the UI contract.
- Cancel restarts the worker, which costs one OCCT boot (browser-cached); M5 should replace it with cooperative cancellation and a worker pool.
- Rebuilds are coalesced by task key, so rapid parameter edits do not build a long backlog.
- New UI strings for tooltips/help go through i18n; no hard-coded English.

## Resolved in review

- Single click selects face/edge, double click selects body; tree selection stays body-level. Face/edge picking arrives in M1.
- Rollback stays a timeline marker, no separate mode.
- Long operations use a failure-cancels-the-queue policy with visible queue and cancel.

## Open

- Whether queued rebuilds should be listed per feature instead of one coalesced "Rebuilding model" entry.
- Whether Shift+click should add to the selection or perform range selection in the tree/timeline.
- Whether bulk editing (rename, visibility, delete) is needed for multi-selection.
