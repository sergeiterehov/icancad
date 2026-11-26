# ADR 0057 — The view pulls back when an edit takes the sketch out of the frame

Status: accepted

## Context

A sketch opens framed on its geometry, and the zoom stays where the user left
it. That breaks the moment a dimension is typed instead of dragged: a line of a
few millimetres given a metre-sized value grows a hundredfold, leaves the
picture, and the only sign of it is an annotation that is no longer visible. The
user has to zoom out by hand to find out what happened — and the same happens
for any edit that changes a sketch's size by a large factor.

FreeCAD answers this by not answering it: the view stays put and the user
presses "fit". A workaround that keeps the picture honest is better than a
button that has to be remembered.

## Decisions

| Area        | Decision                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The trigger | Only a **change of geometry** is answered, never a camera move. The editor measures the sketch's diagonal after the change settles and keeps it per sketch.                       |
| The growth  | The view moves only when the sketch grew by more than a tenth of itself. A view the user zoomed or panned by hand therefore stays theirs: a small edit changes nothing to answer. |
| The fit     | Growing is not enough on its own: the geometry must also no longer stand in the picture (`sketchFits`). A sketch that grew but is still on screen keeps the view it had.          |
| A gesture   | A drag owns the picture while it runs; the question is asked after its commit, not during it.                                                                                     |
| Empty       | An empty sketch has no diagonal, so nothing can trigger a move; opening one never moves the camera.                                                                               |
| The move    | The same `alignSketch` the editor uses on entry: centre on the geometry, zoom to fit with a margin, and roll to the sketch's own axes.                                            |
| The wait    | 160 ms after the geometry changes, so a burst of edits (a wheel stepping a dimension) produces at most one move.                                                                  |

## Consequences

- A dimension typed into a small sketch keeps its result on screen, which is the
  whole point: the number and the picture agree.
- The camera can move without the user asking. It only does so after the geometry
  really left the frame — the alternative would have been an empty view.
- A stepped dimension (the wheel on a value) refits on the step that crosses a
  tenth of the sketch, not on every notch.
- Zooming into one corner of a large sketch and then editing it _does_ pull the
  view back the first time the sketch grows past a tenth: the picture was already
  missing most of the sketch, and the growth is what made the question worth
  asking. The alternative — tracking the camera as well — remembers a camera the
  refit itself has just moved, so it was not taken.
