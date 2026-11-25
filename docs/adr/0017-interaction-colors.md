# ADR 0017 — Interaction colours: purple selection, blue hover

Status: accepted

## Context

The sketch editor marked selected geometry orange, while a selected 3D edge was
purple. Nothing highlighted the geometry under the pointer, so it was hard to
tell what a click would take, and the two views disagreed about what the
selection accent is.

## Decisions

| Area                | Decision                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette             | One shared palette in `apps/web/src/viewport/interactionColors.ts`, used by the sketch overlay and the 3D scene.                                                                                                                                  |
| Selection           | Purple in both themes: `#bb86fc` on dark, `#7c3aed` on light. The same accent marks selected sketch geometry and points, the fundamental origin and axes, selected 3D edges, face tints and constraint glyphs.                                    |
| Hover               | A contrasting blue, one step brighter than the sketch's own blue: `#62b0ff` on dark, `#0a66ff` on light. It means "this is what a click would take".                                                                                              |
| Hover weight        | A hovered curve is drawn 1 px thicker and a hovered point 1 px larger than normal, so the preview reads without changing the meaning of the colours.                                                                                              |
| Priority            | Selection wins over hover, and hover wins over the magnet highlight. The magnet highlight keeps the selection purple: it points at existing geometry that will be referenced by a constraint, not at what the pointer would pick.                 |
| Where hover applies | Only while selecting in the sketch editor. A tool that creates geometry keeps its magnet feedback and shows no selection hover.                                                                                                                   |
| 3D edges            | Selected edges use the selection purple and hovered edges the hover blue, opaque, 1 px thicker than the body edge.                                                                                                                                |
| Edge hover depth    | Edges rank above faces only where they are visible. An edge hidden behind a face is never the hover, and a hovered edge is drawn depth-tested, lifted a few pixels towards the viewer so its own surface cannot notch the line.                   |
| Problem geometry    | Geometry of conflicting or redundant constraints is orange, the same warning family the constraint list uses. It takes the place of the ordinary sketch blue: selection, hover, magnet highlight, frozen and projected colours still win over it. |
| Projecting          | The projection tool is the one sketch tool that reaches into the 3D scene, so the pointer previews the body edge or face a click would project.                                                                                                   |
| Picking order       | Hover mirrors picking: stored sketch geometry is chosen before the axes or the origin lying under it.                                                                                                                                             |

## Consequences

- One accent means "selected" in both the sketch and 3D; another means "under the pointer".
- New interactive states (projected geometry, edge treatments, section picks) take their colours from the shared palette instead of defining their own.

## Amendments

- Every body surface takes a small positive depth bias, so its edge lines win a depth
  tie even on the body at the bottom of the object tree.
- The world grid and axes are opaque, draw before the model and write no depth. They
  therefore sit below every body even where a line and a face share the same depth;
  the grid stays the lowest layer. The sketch grid is below the sketch curves.

- The CSS palette carries the same two accents: `--pick` is the selection purple
  and `--hover` the pointer blue, so a DOM surface (a constraint chip, a row in
  the inspector) and a curve in the viewport never disagree about what is being
  pointed at.

## Amendments

- The segment being drawn turns to `--pick` only when it is about to be ruled
  horizontal or vertical. That colour is the promise of a constraint, so a snap
  to another curve is shown by the magnet's highlight and the cursor dot instead
  of painting the whole segment as though a rule were being added.
- While a tool previews what it would add, the geometry under the pointer keeps
  the hover blue and the preview itself is the selection purple: two nearby
  blues would read as one curve. The preview draws above every sketch layer, so
  what a click would add is never hidden by the curves it is copied from.
