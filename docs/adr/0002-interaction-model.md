# ADR 0002 — Interaction model, selection and settings

Status: accepted (M0 review)

## Context

The first working shell exposed conceptual ambiguity: the left panel and the bottom timeline both listed features, "history" was unclear relative to undo/redo, rollback had no explained meaning, program settings were mixed with project properties, and selection only worked from the tree. Native tooltips and selectable UI text also broke the intended Figma-like feel.

## Decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| Source of truth | The feature timeline is the single ordered list of operations | One mental model (Fusion/Onshape) instead of two competing lists |
| Left panel | Shows document objects only: bodies and assets | Operations live in the timeline; the tree is for navigation, not for history |
| Undo/redo | Edit-history stack over document commands | Standard editing semantics: undo reverts a change to the document |
| Rollback | Caret strip between operations (including before the first and after the last); hover reveals it, tooltip names the target position, click moves the marker; later operations stay in the document but are not rebuilt | Works like a text cursor and makes the insertion point obvious |
| Selection entry points | Tree and 3D viewport are equivalent and synchronized | Either path is a first-class navigation tool |
| Empty click | Clears selection; inspector falls back to project properties | Predictable way out of a selection |
| Selection granularity | Single click selects face/edge, double click selects body; tree selection selects body | Direct manipulation of faces/edges is the common CAD flow; body-level edits stay one gesture away |
| Multi-selection | Selection is a list of body/feature items; Cmd/Ctrl/Shift toggles items in the tree, timeline and 3D | Multi-body workflows are a first-class requirement |
| Selection feedback | Selecting an operation gives it a background highlight (never an icon recolor) and does not dim other operations; selecting a body dims unrelated operations while its own operation stays normal. The bodies tree is never dimmed | The timeline and the model must read as one structure without competing selection colors |
| Timeline strip | One row of icon-only buttons at fixed height (button plus padding), no panel header, no button background, horizontal scroll, name in a tooltip | Matches Fusion's construction bar and avoids scale-dependent padding |
| Multi-selection inspector | Lists selected objects and aggregate statistics (triangles, union bounds); editing only for a single object | Bulk editing needs a different UI that does not exist yet |
| Dimensions | Three compact X/Y/Z fields in one row with tooltips, Figma-style | Fits three values into a narrow inspector |
| Object actions | Hide/show, delete and rollback live in context menus on tree rows, timeline chips and 3D bodies | The inspector is for properties; one-off actions belong to the object under the cursor |
| Adding bodies | Single entry point: `+` in the Bodies header, later a body-type menu; the header shows no body count | Three duplicate buttons were confusing, and the count adds no value |
| Top bar | Brand and project left, tools centered, undo/redo separated from open/export on the right | Tools are the primary mode switch; file actions stay together |
| View controls | Navigation cube in the viewport: faces set orthographic views, edges between two faces give edge-on views, corners give isometric views; drag rotates the camera; hovering tints the whole face or draws a gradient from the targeted edge/corner, both in the same accent color, so the direction stays readable; right-click opens a view menu with fit and all standard views, labeled in normal case with muted axis hints (+Z, −Y, …); there is no separate fit button | View state belongs to the viewport, not to the app chrome |
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
