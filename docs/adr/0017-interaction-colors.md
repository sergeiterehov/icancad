# ADR 0017 — Interaction colours: purple selection, blue hover

Status: accepted

## Context

The sketch editor marked selected geometry orange, while a selected 3D edge was
purple. Nothing highlighted the geometry under the pointer, so it was hard to
tell what a click would take, and the two views disagreed about what the
selection accent is.

## Decisions

| Area                | Decision                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette             | One shared palette in `apps/web/src/viewport/interactionColors.ts`, used by the sketch overlay and the 3D scene.                                                                                                                  |
| Selection           | Purple in both themes: `#bb86fc` on dark, `#7c3aed` on light. The same accent marks selected sketch geometry and points, the fundamental origin and axes, selected 3D edges, face tints and constraint glyphs.                    |
| Hover               | A contrasting blue, one step brighter than the sketch's own blue: `#62b0ff` on dark, `#0a66ff` on light. It means "this is what a click would take".                                                                              |
| Hover weight        | A hovered curve is drawn 1 px thicker and a hovered point 1 px larger than normal, so the preview reads without changing the meaning of the colours.                                                                              |
| Priority            | Selection wins over hover, and hover wins over the magnet highlight. The magnet highlight keeps the selection purple: it points at existing geometry that will be referenced by a constraint, not at what the pointer would pick. |
| Where hover applies | Only while selecting in the sketch editor. A tool that creates geometry keeps its magnet feedback and shows no selection hover.                                                                                                   |
| 3D edges            | Selected edges use the selection purple and hovered edges the hover blue, opaque, 1 px thicker than the body edge.                                                                                                                |
| Edge hover depth    | Edges rank above faces only where they are visible. An edge hidden behind a face is never the hover, and a hovered edge is drawn depth-tested, lifted a few pixels towards the viewer so its own surface cannot notch the line.   |
| Picking order       | Hover mirrors picking: stored sketch geometry is chosen before the axes or the origin lying under it.                                                                                                                             |

## Consequences

- One accent means "selected" in both the sketch and 3D; another means "under the pointer".
- New interactive states (projected geometry, edge treatments, section picks) take their colours from the shared palette instead of defining their own.
