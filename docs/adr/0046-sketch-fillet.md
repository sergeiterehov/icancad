# ADR 0046 — Sketch tool: round corners

Status: accepted

## Context

`MEMO.md` lists Скругление углов as one of the four sketch tools that were still to come, "only for straight segments". A corner of a sketch is where two lines meet, and every real part has them rounded: a design that has to be drawn as a chain of straight lines keeps its corners sharp until something rounds them.

The offset and the outline (`ADR 0045`) read a *set* of curves and derive new ones. Rounding is the opposite kind of operation: it changes the curves that are already there. The corner it replaces disappears — the two lines are shortened — and an arc takes its place, so the operation has to be told exactly which corners to touch and what keeps them rounded afterwards.

## Decisions

| Area | Decision |
| --- | --- |
| Menu | Скругление (`SquareRoundCorner`) is the **first** entry of the Tools menu, ahead of Смещение and Контур: it is the one that changes what the user already drew, so it is the one reached for while a corner is on screen. It is disabled, with a tooltip, when the selection names no corner. |
| What the selection names | A corner is rounded because a pick named it: a selected **line brings both of its ends**, a selected **point** is a corner, and a selected **end** (`entity#0`/`#1`) is a corner. This is the point of the tool — one segment with a corner at one end rounds that one, a segment with corners at both ends rounds both, and a multi-selection rounds every corner of everything it holds. |
| Neighbours | The line a corner is rounded *with* does not have to be selected: a corner is completed from the sketch. Selecting the far line as well names the same corner and does not round it twice. |
| Junctions | Only a corner with exactly two lines is rounded. A junction of three or more is skipped: the arc would have to pick two of them, and a wrong pick is a shape the user never asked for. A straight continuation of two lines and a line whose end meets nothing are not corners either. |
| Radius | One radius for the whole selection, set by the pointer, which rides the middle of the arc of the corner it stands nearest to: the ghost arc's middle follows the cursor exactly. Every corner of the selection takes that radius, the way a radius dimension reads. |
| Exact geometry | The tangent points sit at `R / tan(θ/2)` from the corner along each line, the centre on the bisector at `R / sin(θ/2)`, and the arc sweeps the short way round. Nothing is fitted, so the sketch keeps lines and arcs it can constrain. The bisector is a direction, normalised on its own — measuring it from the corner gives a centre that is only right for a corner at the origin. |
| Trims | The two source lines keep their ids and lose the end that stood at the corner; the arc is added. A line between two rounded corners is shortened at both of its ends in the same edit, so the trims are laid over the source one after another instead of each one over the original. |
| The corner's joint | Rounding takes the corner apart, so the `coincident` that tied the two trimmed ends is **dropped** in the same edit. Keeping it is not a cosmetic detail: it tells the solver that the arc's two end points are one point, which it can only answer by collapsing the arc and dragging the rest of the sketch with it — on a profile of three lines and an arc it moved the untouched arc from r 11 to r 8.2 and reported a redundancy. Only the relation between exactly those two ends goes; anything else that merely touches one of them still says something true. |
| Driving dimensions | Each corner gets `coincident` at each joint, a `radius` on the arc, and an `angle` between the two lines with the corner's side. No `tangent`: the two coincidences and the radius already fix the angle, so a tangency would say it twice, make the set rank-deficient, and turn the next drag into a conflict. The angle is what keeps the corner a corner — without it a drag straightens the fillet out. Constraints are `auto: true` and deduplicated against what the sketch already says. |
| Refusals | A radius whose tangent points would run past the far end of a line is refused, not clamped and not skipped: the pointer is told, and the click reports the failure. A chain with one short segment therefore cannot be rounded at a large radius at all — a silent partial result would leave the user unable to tell which corners went in. |
| One solve, one edit | The commit plans again from the same pointer, solves the generated set once (a couple of milliseconds) and lands geometry and constraints as one `feature/replace`, so the whole operation is one undo step. The arcs become the selection and the Select tool takes over. |
| Interaction | The pointer previews every arc and every shortened line live, with the radius in the chip at the cursor. Click or Enter commits, Escape leaves the tool. A press starts neither a draft nor a box, and the magnet is not used, because it would pull the radius off the pointer. The preview goes the moment the click lands. |
| Overlay | The offset preview list is now the pointer-tool preview list: the same overlay draws a list of curves, so the fillet and the two offsets share one path into it. The preview also names the curves it replaces, and the scene hides them while it is up — a sharp corner left drawn under a rounded ghost reads as a tool that has already done its work — and brings them back when the preview goes. |
| Scope | Lines only, as the memo says. An arc, a circle, a Bezier or an elliptical arc corner needs its own tangent search and a different trim, and is a later step. |
| Geometry module | The corner search and the exact fillet live in `packages/sketch/src/fillet.ts`: `findFilletCorner` for one pair of lines, `findFilletCorners` for everything a selection names, `radiusAtPointer` and `filletShape`. The app layer (`sketch/sketchFillet.ts`) owns the selection reading, the plan over several corners, and the constraints. |

## Consequences

- Rounding is one-shot geometry, not a feature that re-derives itself. The arcs keep their radius and their joints under a drag, and the two lines keep their angle, so the corner holds; changing a source curve enough leaves the set unsolvable, which the sketch reports as a conflict.
- The trims are not dimensions: nothing says how long the shortened line is. That is deliberate — a length there would fight the radius, and the joint plus the angle already say what the fillet needs.
- A dimension that tied the two points of the corner to each other (`distance` between them, for one) is left in the sketch and now reads as the chord between the tangent points. Dropping a user's dimension silently would be worse than a dimension that means something slightly different, but it is the one relation the tool cannot take over: re-pointing such a dimension at the new arc is a later step.
- A rounded corner cannot be rounded again with a smaller radius: after the commit the two lines no longer meet, so the corner is gone. Re-rounding is an edit of the two arcs, which this tool does not do yet.
- A shallow corner scales the pointer up hard — at 135° a radius grows twelve times faster than the cursor moves — so a radius is set precisely only at a zoom where the corner fills a good part of the view. Typing the radius into a chip (which the memo asks for anyway) is the answer, and it joins this tool when the parameter inputs arrive.
- The corner a point names stays a point: rounding does not delete the point entity, it only shortens the lines. A point that was meant to mark the joint has to be removed by hand.
- The remaining memo tools (scissors, split, extend) change existing curves the same way and can reuse the corner search and `intersect.ts`, but each needs its own constraint remapping.
