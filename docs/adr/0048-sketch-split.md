# ADR 0048 — Sketch tool: split

Status: accepted

## Context

`MEMO.md` lists Разделение as the tool that "добавляет общую точку, деля геометрию в указанном месте": a curve becomes two curves that meet at a new point, so the point can then carry relations of its own — a dimension to it, a fillet at it, a split of a profile edge.

Вырез (`ADR 0047`) already takes a piece out of a curve and can be told a place by the pointer. This is the other half of that pair: the same cut, with nothing removed.

## Decisions

| Area | Decision |
| --- | --- |
| Menu | Разделение (`GitCommitHorizontal`) sits second in the Tools menu, right after Вырез: the two are the same act with and without a piece taken away. |
| What decides the place | The pointer: the curve nearest to it is split at the point of that curve nearest to it. No selection, and a selection left over is cleared when the tool starts, as with Вырез. |
| Construction curves | Helpers, so they are not split — and are not in the way — unless **Shift** is held, the same rule as the scissors. Projected curves are derived on every rebuild and are left out entirely. |
| Refusals | A point within a thousandth of the curve's own end is refused: the two pieces would be the curve and nothing. A Bezier is refused as before — cutting one changes its control points, which is its own decision. |
| The pieces | Two exact pieces of the same curve, using the same parameter machinery as the trim: a line stays a line, an arc keeps its centre and radius, a circle becomes two arcs. The first piece keeps the curve's id. |
| The point | A `coincident` between the new ends of the two pieces, so the point is one point and not two that happen to touch. A closed curve has two such joints — the new point and the seam it already had — because a circle cut once is two arcs that meet twice. |
| Relations | A relation on a point moves to the piece that carries that point; a relation on the curve as a whole (horizontal, tangent, radius) stays with the piece that kept its id; a relation on a point that no piece carries any more (a circle's rim handle, say) is dropped rather than left dangling. |
| No solve | A split adds no geometry — only a point that was already on the curve — so the pieces are exact and the sketch must not move. Solving would let an under-constrained sketch shift for no reason. |
| Preview | The curve stands aside for its own two pieces and the point is drawn where the click will put it, so what the click does is what is seen. The pointer-tool preview list carries its own points now, drawn with the draft markers. |
| One edit, then another | Pieces and the joint land as one `feature/replace`, and the tool stays on: a line divided in two can be divided again without leaving the tool. Escape leaves it. |

## Consequences

- Splitting a curve in two pieces and then constraining either piece works, because both are ordinary entities; the point is visible as the joint between them.
- Because the tool keeps the curve's id on the first piece, a relation the user had put on that curve keeps working; a relation that named a control point which the split did not keep (a circle's rim handle) is removed, and the tool does not report it.
- The point is a joint, not an entity: there is no standalone point in the sketch, so it cannot be selected as one. Making a selectable point out of it — the «Точка» tool placed on a curve — is a separate step.
- A split curve is not automatically trimmed: the pieces keep their exact ends, and the piece that ran past another curve still does.
