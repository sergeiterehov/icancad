# ADR 0036 — Boolean operations with two body lists

Status: accepted

## Context

The model already carried a `boolean` operation, but it was only a shell: no
inspector, no tool-rail entry, and the rebuild reported it as `NOT_IMPLEMENTED`.
Add, cut and intersect existed only as an extrude mode, one tool against the
bodies it touches.

A standalone boolean tool is needed for parts made of several primitives or
extrudes: the user picks which bodies are combined, which ones do the cutting,
and whether the sources survive.

## Decisions

| Area            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs          | The operation owns two ordered lists of bodies: `bodyIds` (the targets it starts from) and `toolIds` (what is combined with, cut away or intersected). Both are picked like extrude target bodies — a pencil in the section header, clicks in the 3D view or the model tree. Starting the tool from a selection fills the first list with the first picked body and the second list with every later one.                                                                                                                                                                                             |
| Exclusivity     | A body belongs to one list only. Picking a body that is already in the other list moves it, so the two sets can never overlap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Operations      | Three tabs in the order the lists read: subtract, union, intersect. Subtract is the default. Union combines both lists; subtract removes the second list from the first; intersect keeps their common volume.                                                                                                                                                                                                                                                                                                                                                                                         |
| Keep switches   | Each list header carries a `Keep` switch, off by default. On the first list, off means the first target is modified in place; on means the originals stay and the operation is performed on a copy. On the second list, off means the tools are consumed by the operation; on means they stay. Consumed bodies leave the object list from that point in the history, but their `BodyRef`, name and colour stay in the document, so turning `Keep` back on brings the same object back. The rebuild reports what it consumed, so a failed or suppressed boolean consumes nothing.                      |
| Target in place | The operation is one `boolean-all` request: the first body is the base and every other body of both lists is a tool, which makes the sequential semantics exactly `(∪ targets) op (∪ tools)`. With `Keep` off, the first target becomes the result, so its id, name, colour and place in the tree are preserved; the other targets were the material the result was built from and are consumed. With `Keep` on, the result is a copy of that material and all targets stay.                                                                                                                          |
| Result identity | A result of several independent solids is split with `split-solids`. Without `Keep`, the largest piece keeps the first target and the rest become bodies with stable ids (`<feature>:split:<target>:<slot>`); with `Keep`, every piece is a new body (`<feature>:solid-0`, `-1`, …). Names and colours stay put while the operation is edited.                                                                                                                                                                                                                                                        |
| Empty result    | An intersection that leaves nothing is an error (`BOOLEAN_EMPTY`); it does not produce an empty body. A list that is still being filled builds nothing and is not an error, and closing a fresh, incomplete boolean discards it like any other unused tool.                                                                                                                                                                                                                                                                                                                                           |
| Errors          | A missing or non-solid input is reported on that body's row (`UNKNOWN_BODY` / `BODY_NOT_SOLID`), and the operation is marked failed, exactly like an extrude target.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Preview         | The edited operation is built against the input state, and the operation's delta alone carries the change: a subtract draws only the material it cuts away in red, a union only the material it adds in green, and an intersection only the material it removes in red at half the usual opacity. Consumed bodies are not drawn at all (the tree still lists them as removed), and a union keeps the target's original look. The deltas render above the bodies. With `Keep` on, the copies the operation will make are not drawn in the viewport either — the delta is what the user is configuring. |
| History         | Both lists are body references for dependency and order checks, so a boolean depends on the operations that built either list and cannot be moved in front of them.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Arrays          | The boolean participates in arrays through its created bodies, like primitives and new-body extrudes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Consequences

- A later operation that names the first target keeps working: it is the same
  object with the result shape. An operation that needs the original shape is
  what the first list's `Keep` is for, since it keeps the originals and applies
  the boolean to a copy.
- A project can carry a boolean whose tools or extra targets are consumed;
  turning `Keep` back on returns them at the same point of the history without
  re-creating their operations, because the refs and metadata stay in the
  document and only the set of objects in the model is derived.
- Suppressing the boolean stops the consumption as well as the result, so the
  operation can be toggled without losing its inputs.
- A boolean that fails — an empty intersection, a missing input — consumes
  nothing: consumption happens after the result is built, and a failed operation
  leaves the model exactly as it was before it.
- Deleting the boolean restores the model to the state before it: the targets
  keep their original shape in their history and consumed bodies come back.
