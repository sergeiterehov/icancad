# ADR 0021 — Deleting operations with and without their links

## Context

An operation is rarely alone in the history: a sketch feeds an extrude, an extrude feeds a
boolean or an edge treatment. Deleting one of them silently used to take everything that
depended on it, so a user who only wanted to remove a sketch lost the body built from it
without seeing why. Nothing in the UI offered the other outcome — keeping the dependents and
letting the user repair them.

The document, however, treats a reference to a missing feature or body as an error, and
`applyCommands` rejects every edit that leaves one behind. Dropping the check outright would
let any edit produce a broken history; leaving it in place makes the second outcome
impossible.

## Decision

| Area | Decision |
| --- | --- |
| Selection | The timeline menu deletes the whole operation selection: right-clicking a chip that is part of a multi-selection deletes every selected chip in one undoable step. The label counts the operations. |
| Dependents | The confirmation dialog lists the operations that would break, without those that are deleted anyway. It explains the fork in a smaller footnote above the buttons and offers three actions: `Cancel` and `Delete without links` (red text) on the left, `Delete with links` (blue) at the right. The listed operations are shown with their timeline icons. |
| Colour | `Delete without links` is the red one. It is the destructive choice: the surviving operations lose their input, so their parameters and their output are no longer reproduced. `Delete with links` removes the whole chain and leaves nothing broken. Only the safe choice is filled blue; the destructive one is a quiet text button, so the two never compete for attention. |
| Without links | `feature/remove` carries `keepDependents`. Such a removal may leave references to the removed operation. The dependents stay in the history, fail to build and show the timeline error state with its tooltip until the user points them at new input or deletes them. |
| Validation | `applyCommands` compares the history issues of the result with those of the input and rejects only newly introduced ones. A project that already carries broken references therefore stays editable, and every other edit keeps its old guarantees. |
| Naming | The buttons name the links, not the dependents: the question the dialog asks is what happens to the operations that use the deleted one. |

## Consequences

- Deleting a sketch without links keeps the extrude in the timeline marked with `MISSING_SKETCH`;
  the body it built disappears until the extrude is given a new profile.
- The dialog's list is the set `dependentFeaturesOf` reports for the deleted set, so a chain
  that only survives one of the removed operations is listed once.
- A saved project can contain broken references after this choice. `parseProject` accepts them,
  and the rebuild reports the failure per operation instead of refusing the file.
- The red/blue pair follows the intent, not the count of removed objects: removing more
  operations is safe, keeping them in a broken state is not.
