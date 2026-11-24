# ADR 0047 — Sketch tool: trim

Status: accepted

## Context

`MEMO.md` lists Вырез as the next sketch tool: "удаляет выбранный сегмент между пересечениями с любой другой геометрией". Rounding (`ADR 0046`) showed what a tool that *changes* existing curves has to get right — the trims, the relations that named the changed curve, and a preview that cannot be mistaken for the result. Trimming is the same kind of operation with a different job: it takes a piece away and leaves the rest.

## Decisions

| Area | Decision |
| --- | --- |
| Menu | Вырез (`Scissors`) sits **first** in the Tools menu: it is the tool reached for most often, and the one that changes what is already drawn. |
| What decides the cut | The **pointer**, and only the pointer: the piece that goes is the one the pointer stands on. A selection is not an input — a cut is a direct act on one curve — and a selection left over from before the tool is cleared when it starts, so it cannot look like a promise the cut does not keep. |
| Which curve | The nearest curve to the pointer. Only that curve's crossings are computed: the preview runs on every pointer move, and the crossings of the whole sketch would cost more than the plan is worth. |
| Picking pieces | Everything the curve crosses splits it into pieces, and the piece under the pointer goes while the others stay. A crossing that lands on the curve's own end is the joint it already has, not a cut. A closed curve is cut from crossing to crossing all the way round, so a circle with two crossings becomes two arcs. |
| A curve nothing crosses | The pointer removes it whole: that is the piece it stands on. The same holds for a closed curve that only one curve crosses — it is one piece. Deleting is not a special case bolted on: it is the ordinary rule with the whole curve as its only piece, so the scissors never refuse to act on a lone line. |
| Construction curves | They are helpers, so they are neither cut nor do they cut: with them in the way, a helper drawn across the part would turn every cut into a cut on it. Holding **Shift** brings them into the picture for as long as it is held, and the preview answers at once. |
| Joints at the new points | A cut end that lands where the sketch already has a point — the end of another cut, a joint — gets a `coincident` to that point. Where the other curve only runs through, with no point of its own there, the end is held on it with `point-on-line`, `point-on-circle` or `point-on-ellipse`: that is what the crossing is, and it is what keeps the pieces together when the other curve is dragged. Both are `auto` and deduplicated against what the sketch already says. |
| Repetition | The tool stays on after a cut, so a chain of pieces is a chain of clicks; only Escape leaves it. Nothing is selected after a cut, because the next cut is a pointer's job again. |
| Exactness | A piece is the same kind of curve: a line stays a line, an arc stays an arc of the same centre and radius, a circle's piece is an arc, an ellipse's piece is an elliptical arc. Bezier is refused rather than approximated — cutting one changes its control points, and that is a different decision about what its constraints mean. |
| Crossings | A pair the intersection code solves exactly is answered exactly; a pair it does not — an ellipse or a Bezier against anything — is walked as short segments of the curve that has no exact form, so an ellipse cuts a line at the right place on the line. |
| Ids | The piece that carries the curve's own start keeps the curve's id, so a relation that names the curve keeps naming a curve that exists; the other pieces are new entities. |
| Relations | The constraints that named the cut curve follow the pieces: a relation on a point that a piece still carries moves to that piece and to the index the point has there; a relation on an end the cut took away goes with it. Nothing is guessed or re-pointed at a nearest piece. A relation that names the curve as a whole (horizontal, tangent, radius) stays with the piece that kept the id. |
| No solve | The commit does not solve. A cut removes geometry and adds nothing, and every piece is an exact piece of a curve the sketch already held, so a solve could only move what the user did not ask to move. |
| Preview | The cut curve stands aside while the pointer moves and the pieces that stay are drawn in its place, so the gap is exactly the piece that the click will take. The overlay's `replaced` list (`ADR 0046`) does this without a second drawing path. |
| One edit | Pieces and the remapped constraints land as one `feature/replace`, so the whole cut is one undo step. The kept pieces become the selection. |
| Interaction | Hover previews, click or Enter cuts, Shift includes the construction curves, Escape leaves the tool. A press starts neither a draft nor a selection box, and the magnet is not used: the pointer stands over a piece, it does not place a point. |
| Not covered | Projected curves are not cut — a projection is re-derived on every rebuild, so a cut in one would not survive. Construction curves are cut like any other. |

## Consequences

- Repeated cuts are separate steps: each one is its own edit and its own undo.
- A cut is a joint, not a merge: the pieces of one curve stay separate entities, tied at the crossings they share by the joints the tool adds. A sketch cut into four pieces is four curves, which is what the sketch format holds.
- A dimension attached to a point the cut took away is removed with it; the tool reports nothing about it, because the point it named no longer exists. Re-pointing such a dimension at a piece is a later step.
- Trimming does not extend: a piece that ends short of a crossing is not stretched to it. Продление is its own memo entry.
- A Bezier can be cut only after it has been replaced by arcs, which the offset and contour tools already do when they need exact curves.
- Because the commit does not solve, a sketch that was already in conflict stays in conflict: the cut changes nothing about the relations it did not touch.
