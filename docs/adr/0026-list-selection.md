# ADR 0026 — One click contract for every list

Status: accepted

## Context

Every list in the app handled selection on its own. Most read the modifiers
inline as `event.metaKey || event.ctrlKey || event.shiftKey` and passed the
result to whichever store owned the rows, so Shift toggled one row like Cmd and
Ctrl did, and there was no way to take a range. The lists also disagreed on
details: the constraint list closed its value editor on a second click, the
sketch geometry list silently dropped point picks when an entity was clicked,
and every new panel copy-pasted the same condition.

## Decisions

| Area           | Decision                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules          | One pure module, `apps/web/src/ui/listSelection.ts`, decides what a click means. No component reads modifier keys for a list itself.                                                                                                      |
| Modes          | A plain click replaces the selection with the clicked row, Cmd or Ctrl toggles that one row, Shift selects everything from the anchor to the clicked row. Shift wins over Cmd and Ctrl.                                                    |
| Anchor         | The anchor is the row the last click in this list landed on. It survives the Cmd or Ctrl click that takes it out of the selection, and it stays put through a range, so repeated Shift clicks drag the same end. It ends when the list stops showing that row. |
| Range          | A range covers the rows the list shows, in the order it shows them, and runs in either direction. A filtered list ranges over what is visible, not over hidden rows.                                                                       |
| Fallback       | A list without an anchor ranges from the last selected row it shows. That covers a selection made in the 3D view before the first click in the panel.                                                                                      |
| Memory         | `useListSelection` keeps the anchor per list, so two lists never share one. The component writes the result back through `selectMany`, which replaces the selection and lets the document reconcile the operation being edited.             |
| Repeat click   | A list may ask for `repeatClears`: a plain click on the row that is already alone in the selection clears it. Only the constraint list asks, because there the selection opens the value editor.                                            |
| Pickers        | While an operation waits for geometry, a picker owns clicks: it takes the clicked row and toggles that one pick. A range is not offered, because a picker is a set, not a selection.                                                       |
| 3D and sketch  | Picks in the 3D view and on the sketch canvas have no order to range over, so there every modifier adds the one element under the pointer (`isAdditiveClick`).                                                                             |
| Lists that follow | Object tree, timeline, sketch geometry composition, sketch faces, sketch edges, sketch constraints. Read-only lists (multi-object summary, points) and the project switcher keep their own single-row meaning.                          |

## Consequences

- Shift means the same thing in every list, and Cmd or Ctrl means the same thing everywhere else.
- A new list gets range selection by passing its rows to `useListSelection`; it does not re-implement modifiers.
- The rules are covered by `apps/web/tests/listSelection.test.ts`, so the contract can change in one place.
