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
| What holds the pieces on the curve | A line needs nothing beyond the joint: two pieces of a line are still a line. An **arc** keeps its **centre** and its **radius** — a `coincident` of the two centres and an `equal` of the two radii — because without them the pieces drift apart in curvature and the arc looks broken after a drag. An **elliptical arc** keeps its centre and **both axes**, and since the solver has no "equal radii" for an ellipse, the axes are the points the elliptical arc already has: a `coincident` of centre, of the X axis point and of the Y axis point is the same ellipse. A **circle** becomes two arcs and is held like an arc — same centre, same radius — and its joints already meet twice, at the new point and at the seam. |
| Closed curves tie less | A closed curve is cut from its own angle zero, so its first piece starts on the X axis exactly where its second piece ends. The seam joint already ties those two handles, so an **elliptical arc cut from an ellipse** gets the centre and the Y axis only: adding the X axis as well is a relation the solver reports as redundant, and the sketch shows the "conflicting or redundant" note for a shape that is perfectly sound. An elliptical arc that was already open has no seam, so there it does get both axes. |
| The point | A `coincident` between the new ends of the two pieces, so the point is one point and not two that happen to touch. A closed curve has two such joints — the new point and the seam it already had — because a circle cut once is two arcs that meet twice. The ends are named by the indices a relation uses, which are not the ends' own order: an arc's points are its centre, then its start and its end, so the first piece's new end is index 2 and the second piece's is 1. Naming index 0 instead ties a piece's end to the other piece's **centre**, and the solver answers that by collapsing both arcs to nothing — the arc does not look split, it looks broken. The indices come from `curveEndIndices`, never from matching the ends by position: an ellipse's axis handles sit *exactly* where its start and end are, so a position match finds the handle first and the joint ends up naming an axis instead of the end — the seam joint then holds nothing and the second meeting point comes apart. |
| Relations | A relation on a point moves to the piece that carries that point; a relation on the curve as a whole (horizontal, tangent, radius) stays with the piece that kept its id; a relation on a point that no piece carries any more (a circle's rim handle, say) is dropped rather than left dangling. |
| No solve | A split adds no geometry — only a point that was already on the curve — so the pieces are exact and the sketch must not move. Solving would let an under-constrained sketch shift for no reason. |
| Preview | The curve stands aside for its own two pieces and the point is drawn where the click will put it, so what the click does is what is seen. The pointer-tool preview list carries its own points now, drawn with the draft markers. |
| One edit, then another | Pieces and the joint land as one `feature/replace`, and the tool stays on: a line divided in two can be divided again without leaving the tool. Escape leaves it. |

## Consequences

- Splitting a curve in two pieces and then constraining either piece works, because both are ordinary entities; the point is visible as the joint between them.
- Because the tool keeps the curve's id on the first piece, a relation the user had put on that curve keeps working; a relation that named a control point which the split did not keep (a circle's rim handle) is removed, and the tool does not report it.
- The point is a joint, not an entity: there is no standalone point in the sketch, so it cannot be selected as one. Making a selectable point out of it — the «Точка» tool placed on a curve — is a separate step.
- A split curve is not automatically trimmed: the pieces keep their exact ends, and the piece that ran past another curve still does.
- The rank analysis reports the `equal` of an arc's two radii as redundant, because an arc's own ends are tied to its radius, so equal radii are implied on paper. They are not implied in practice — without the `equal` a drag left the pieces with radii 9.09 and 10.00 — so the relation is kept and the sketch may show one "redundant" note after a split. That is the price of the pieces staying one arc; the shape is right either way.
- An ellipse split in two is the same ellipse afterwards — same centre, same radii, same tilt, measured after a solve — and reports no redundancy, because the one relation its own geometry implies is the one that is left out.
