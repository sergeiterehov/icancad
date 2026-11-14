# ADR 0024 — Floating shell and project switching

## Context

The workspace was a fixed three-column layout: a top bar with the project name, tools,
undo/redo and import/export; two resizable side panels; a timeline strip under the 3D view;
and a status bar with the kernel state, language and theme. The 3D view was therefore a
small rectangle between chrome, and every new placement tool competed for space in the top
bar.

Projects were equally fixed: IndexedDB stored every project, but only `lastProjectId` was
ever read. Starting a second part meant exporting the first one first, and a project had no
in-app list.

## Decision

| Area             | Decision                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace        | `workspace` is the whole window and the 3D view fills it (`position: absolute; inset: 0`). The shell has no top bar and no status bar.                                                                                                                                                                                                                                                      |
| Side panels | Model and inspector are floating docks with a margin, rounded corners and a shadow. They overlay the 3D view. The model dock has no header of its own: a project strip with a boxes icon above the tree carries the project name. |
| Auto-hide | A dock slides out of the screen one second after pointer and focus leave it — and a second after it appears on start, so the model is visible at once. It leaves a 16 px tab at the screen edge. The whole screen edge is a hover and click target, as if the tab spanned the full height, so a panel comes back from anywhere along its side. Automated UI tests (`navigator.webdriver`) keep both docks open. |
| Shared insets    | Dock state lives in `uiStore`; `App` writes `data-left-dock` / `data-right-dock` on the workspace. CSS variables `--dock-left` and `--dock-right` expose the occupied width to the tool dock, the operations panel, the nav cube and the toast.                                                                                                                                             |
| Tool dock | `ToolRail` and `SketchToolRail` float as one pill centred in the window. A side dock that would cover the pill pushes it just as far as it has to, and only when no room is left does the pill shrink and scroll; a dock that stays clear of it changes nothing. `useFloatingBarShift` measures the overlap into `--bar-shift`. The contextual switch stays: one rail is on screen at a time. |
| Operations panel | The timeline floats at the bottom, `width: max-content` and centred in the window, and follows the same rule as the pill: a dock moves it only when it would cover it, and it shrinks and scrolls inside only when the free space is gone. So it grows with its operations up to the docks; collapsing a dock widens the limit without moving the panel. A new operation is followed: once it stops being edited, the strip scrolls so the cursor sits in the middle instead of running out of the panel. |
| Orientation cube | The cube owns the bottom-right corner. An operations panel that reaches it lifts the cube above itself (`useNavCubeLift`), and the right screen edge stops short of the corner, so reaching for the cube never opens the dock and never moves the cube out from under the pointer. Both positions are read from layout, never from a half-run animation. Its menu opens with "fit" and "iso + fit" (a home icon) behind a divider from the six axis views. |
| Pinned inspector | Selecting an operation pins the inspector open: it opens at once, ignores auto-hide and stays in place while the operation is selected or edited, because its parameters live there. Clearing the selection unpins it and resumes the normal auto-hide. |
| Project switcher | The logo is a permanent floating button in the top-left corner — the `IC` mark with the product name spelled out beside it, because the mark alone does not introduce the product yet. Clicking it opens the project menu (new, open, mesh import, local projects with delete, export, undo/redo, theme, language). It also carries the autosave indicator as a dot on the corner of the mark, hanging a few pixels over its edge, and the save text as a tooltip. Theme and language items keep the menu and their submenu open, so a choice can be flipped back at once; the items are rebuilt in place with new labels and checks. |
| Project list     | `listProjects()` feeds a submenu sorted by `updatedAt`; the open project is checked. Deleting asks for confirmation, removes imported assets no other project references, and opens the next project (or a new document) when the open one was deleted.                                                                                                                                     |
| Switching        | `switchToProject` writes the open project through the save queue before hydrating the next one, so switching cannot lose the edits still waiting in the autosave debounce.                                                                                                                                                                                                                  |
| Kernel state     | The kernel state and the task queue icon are pinned to the right of the operations panel behind a divider, so they do not scroll with the operations. A check means everything is calculated, a spinner means a rebuild is running, a red triangle means the kernel failed. The spinner takes the same 16 px slot as the icons, so the row does not change size as the state changes. The tooltip reports the kernel load time or the running rebuild time; clicking still opens the details popover. |
| Kernel boot      | While the OCCT wasm streams in, the 3D area shows the caption the skeleton already used, and under it a progress bar driven by the download ratio rather than an indeterminate spinner: the wait has a measurable end. Work without a ratio keeps the caption alone. |

## Consequences

- `TopBar`, `StatusBar` and `react-resizable-panels` are gone; the panels are fixed width and
  the viewport no longer shrinks when they open.
- The toast sits above the operations panel and the nav cube moved to the bottom-right corner
  so the floating docks do not cover either of them.
- The project menu is the only entry point for settings, so a collapsed model panel cannot
  hide the project switcher: the logo is not part of the dock.
- The project name input lives in the model dock (`--dock-left` width), next to the model
  tree it names.
- E2E specs scope the tool buttons to `.tool-dock` instead of `.topbar`, open the project
  menu for undo/redo and export, and use `data-testid="left"`/`"right"` on the docks;
  auto-hide is off under automation so that panel slots remain stable between synthetic
  clicks. Specs that click the canvas by pixel offset need recalibration: the canvas now
  covers the whole window instead of the old centre column, so its height and aspect
  changed.
