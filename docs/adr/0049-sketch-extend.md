# ADR 0049 — Sketch tool: extend

Status: accepted

## Context

`MEMO.md` lists Продление as the last of the pointer tools: "нажимаем на геометрию и двигаем курсор в ту сторону, куда нужно продлить. Если крайняя точка связана с чем то, то на ее месте создается точка, которая перепривязывается ко всем ограничениям."

Вырез (`ADR 0047`) and Разделение (`ADR 0048`) both change a curve where the pointer stands on it. Extending changes a curve the pointer stands *off*: the end grows along the course the curve already has, and what the pointer does is say how far. The awkward part is not the geometry but the relations: a curve whose end is jointed or dimensioned cannot grow at all until that corner stops being the end.

## Decisions

| Area | Decision |
| --- | --- |
| Menu | Продление (`LineDotLeftHorizontal`) sits third in the Tools menu, after Вырез and Разделение: the three pointer tools stand together, and the two that take geometry away come before the one that adds it. |
| The gesture | A **press on the curve** takes hold of it, the travel says how far, and the release commits. A press that never travels is not a stretch and leaves nothing behind. This is the one tool that cannot be a click, because a click stands *on* the curve and the direction it should grow in is the one place a click cannot show. |
| What grows | The end of the curve the press stood nearer. It is decided at the press and held for the whole gesture, so the pointer is only a distance from then on: pulling back and forth shortens and lengthens the same end instead of switching between them. |
| Which curve | The press takes what it landed on, and failing that the curve it came close to. The axes and the origin are references, not curves to stretch, and the pick prefers stored geometry over them, so a line drawn along an axis is still the line under the press. |
| The direction | The curve's own course and nothing else: a line grows along its direction, an arc round its own circle with its centre and radius untouched, an elliptical arc round its own ellipse. The pointer is read as an angle (or as a distance along the line), so the new end lands on the curve's course however far off it the pointer is. |
| Which way round | For an arc the pointer says where on the circle; the stretch is the way from the end it took hold of, and the shorter of the two ways when the press did not name an end. A whole turn is the most an arc can grow. |
| What stops it | The first curve the stretch meets. Extending into a wall lands the end *on* the wall rather than through it, which is what makes the joint exact; without this every stretch would end wherever the pointer happened to stop, a hair off the geometry it was aimed at. |
| Construction curves | Helpers: they are neither stretched nor in the way, unless **Shift** is held, as with the scissors and the split. |
| Joints at the new end | A point of the sketch stands there — the end of another curve, a joint, an ellipse's axis handle — and a `coincident` says the two are one point. Where the other curve only runs through, the end is held on that curve with `point-on-line`, `point-on-circle` or `point-on-ellipse`. Both are `auto` and deduplicated against what the sketch already says. |
| Relations of the end | They describe the corner that stood there, so they **stay there**: a `point` entity is created at the old end and every constraint that named that end is re-pointed at it. A joint with another curve keeps that curve where it was; a dimension keeps its value and its place; and the curve is free to grow. Re-pointing instead of dropping matters — a dropped dimension would silently change the shape, and a dimension left on the growing end would either block the stretch or jump in value. |
| No point when there is nothing to keep | An end with no relations of its own leaves nothing behind: the point is created only when a constraint named that end. |
| Ids | The curve keeps its own id, so a relation naming the curve as a whole (horizontal, vertical, radius) goes on meaning the same curve. |
| Refusals | A circle or an ellipse has no end to grow and is not a target. A Bezier is refused: stretching one moves its control points, which is a decision of its own. A pointer that never left the curve asks for nothing. |
| No solve | The commit does not solve. A stretch moves an end along a course the curve already had, so the result is exact; solving could only let an under-constrained sketch move something the user did not ask it to move, and it would fight the dimension that was just left behind. |
| Preview | The curve stands aside for its own stretched self while the gesture is on, so the ghost is the whole result and not a second curve drawn over the first. Nothing is drawn before the press: there is no stretch to show. |
| One edit | The grown curve, the point it leaves behind and every joint land as one `feature/replace`, so the whole stretch is one undo step. The tool stays on; the next end is the next press. |

## Consequences

- A curve whose end is dimensioned can be extended without the dimension being lost: the dimension now holds the point the end used to reach. That point is a real entity of the sketch, drawn as one, and can be selected, dimensioned and dragged like any other.
- An end that grows past everything in its way cannot be done in one gesture: the first curve it meets stops it. Extending again from the new end continues past that curve, which is also the way to pass a curve rather than join it.
- A curve extended into a sketch that has a point at the meeting place is joined to that point; one extended into a curve that merely passes through is held on it. Neither is trimmed to fit: the profile builder decides what a crossing means.
- A stretch is not a dimension: it changes the geometry and leaves no record of what it grew by. Driving a length needs a dimension on the curve, which is a separate relation.
- Projected curves are not stretched — a projection is re-derived on every rebuild. They are in the way of a stretch, so a curve can still be extended up to one.
