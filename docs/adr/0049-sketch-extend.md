# ADR 0049 — Sketch tool: extend

Status: accepted

## Context

`MEMO.md` lists Продление as the last of the pointer tools: "нажимаем на геометрию и двигаем курсор в ту сторону, куда нужно продлить. Если крайняя точка связана с чем то, то на ее месте создается точка, которая перепривязывается ко всем ограничениям."

Вырез (`ADR 0047`) and Разделение (`ADR 0048`) both change a curve where the pointer stands on it. Extending changes a curve the pointer stands *off*: the end grows along the course the curve already has, and what the pointer does is say how far. The awkward part is not the geometry but the relations: a curve whose end is jointed or dimensioned cannot grow at all until that corner stops being the end.

## Decisions

| Area | Decision |
| --- | --- |
| Menu | Продление (`LineDotLeftHorizontal`) sits third in the Tools menu, after Вырез and Разделение: the three pointer tools stand together, and the two that take geometry away come before the one that adds it. |
| The gesture | **Two clicks.** The pointer over a curve highlights it and the first click takes hold of it; from then on the pointer alone says how far the end grows, with the button up, and the second click ends the stretch. Nothing has to be held down: the choice is a state of the tool, not a gesture, so a hand that lets go of the mouse does not lose the curve. |
| What grows | The end of the curve the first click stood nearer. It is decided by that click and held until the stretch ends, so the pointer is only a distance from then on: moving back and forth shortens and lengthens the same end instead of switching between them. |
| Which curve | Hovering highlights the curve a click would take: what it landed on, and failing that the curve it came close to. The highlight is the accent the editor already gives geometry a tool means (the same purple as a magnet target), not the hover blue: the tool is saying what it will act on, not merely what is under the pointer. The axes and the origin are references, not curves to stretch, and the pick prefers stored geometry over them, so a line drawn along an axis is still the line under the pointer. |
| The direction | The curve's own course and nothing else: a line grows along its direction, an arc round its own circle with its centre and radius untouched, an elliptical arc round its own ellipse. The pointer is read as an angle (or as a distance along the line), so the new end lands on the curve's course however far off it the pointer is. |
| The magnet | The end that grows is a point of the sketch like any other, so the magnet works on it: a target under the pointer is taken as where the end will stand. A **point** target is where the end goes, and a `coincident` says so; a **curve** target is where the end lands, at the crossing of the stretch with that curve, so the end meets it exactly rather than a hair short of it — which is what makes `point-on-line` and its like possible on an ellipse as readily as on a line. The curve being stretched is left out of the magnet — its own foot would pull the pointer back onto it. |
| Which way round | For an arc the pointer says where on the circle; the stretch is the way from the end it took hold of, and the shorter of the two ways when the press did not name an end. A whole turn is the most an arc can grow. |
| What stops it | Nothing. The pointer runs the stretch, so a curve it crosses on the way is crossed: the end goes where the pointer is, not to the first thing in its path. Stopping at the first crossing made the tool decide what the user wanted and left no way to pass a curve at all; landing on a curve is the magnet's job, and a pointer that is on a curve lands on it. |
| Construction curves | Helpers: they are neither stretched nor in the way, unless **Shift** is held, as with the scissors and the split. |
| Joints at the new end | A point of the sketch stands there — the end of another curve, a joint, an ellipse's axis handle — and a `coincident` says the two are one point. Where the other curve only runs through, the end is held on that curve with `point-on-line`, `point-on-circle` or `point-on-ellipse`. Both are `auto` and deduplicated against what the sketch already says. |
| Relations of the end | They describe the corner that stood there, so they **stay there**: a `point` entity is created at the old end and every constraint that named that end is re-pointed at it. A joint with another curve keeps that curve where it was; a dimension keeps its value and its place; and the curve is free to grow. Re-pointing instead of dropping matters — a dropped dimension would silently change the shape, and a dimension left on the growing end would either block the stretch or jump in value. |
| No point when there is nothing to keep | An end with no relations of its own leaves nothing behind: the point is created only when a constraint named that end. |
| Ids | The curve keeps its own id, so a relation naming the curve as a whole (horizontal, vertical, radius) goes on meaning the same curve. |
| Refusals | A circle or an ellipse has no end to grow and is not a target. A Bezier is refused: stretching one moves its control points, which is a decision of its own. A second click that stands over the curve itself asks for nothing, and says so. |
| No solve | The commit does not solve. A stretch moves an end along a course the curve already had, so the result is exact; solving could only let an under-constrained sketch move something the user did not ask it to move, and it would fight the dimension that was just left behind. |
| Preview | The curve stands aside for its own stretched self as soon as it is chosen, so the ghost is the whole result and not a second curve drawn over the first. Before the first click there is nothing to draw but the highlight, and **no point under the pointer**: nothing is being placed yet, and a marker there would promise one. Once the curve is chosen the pointer does place the new end, and is drawn as one. |
| One edit | The grown curve, the point it leaves behind and every joint land as one `feature/replace`, so the whole stretch is one undo step. The tool stays on and drops the chosen curve, so the next end is the next first click; Escape lets the chosen curve go before it leaves the tool. |

## Consequences

- A curve whose end is dimensioned can be extended without the dimension being lost: the dimension now holds the point the end used to reach. That point is a real entity of the sketch, drawn as one, and can be selected, dimensioned and dragged like any other.
- Passing a curve and landing on it are the same act seen from two places: a stretch whose pointer is past a curve goes through it and leaves nothing behind, and one whose pointer comes to that curve ends on it with a joint. Nothing is added by accident — a relation appears only where the end actually meets something.
- A curve extended into a sketch that has a point at the meeting place is joined to that point; one extended into a curve that merely passes through is held on it. Neither is trimmed to fit: the profile builder decides what a crossing means.
- A stretch is not a dimension: it changes the geometry and leaves no record of what it grew by. Driving a length needs a dimension on the curve, which is a separate relation.
- Projected curves are not stretched — a projection is re-derived on every rebuild. They are in the way of a stretch, so a curve can still be extended up to one.
- A chosen curve that no longer exists (it was deleted, or the sketch was rebuilt for another reason) has nothing to stretch: the tool says so on the next click rather than keeping a choice that cannot be carried out.
