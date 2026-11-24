# ADR 0050 — Sketch tool: regular polygon

Status: accepted

## Context

`MEMO.md` listed the polygon generator as the last drawing tool: "Задается центр, внешний или внутренний радиус (переключение через shift), и третья точка задает длину ребра, определяя количество углов. Полученная фигура множеством отрезков и конструкционной окружностью должна быть связана ограничениями, чтобы оставаться собой."

The sketch has no polygon entity and is not going to get one: a polygon is a ring of lines and a helper circle, and what makes it a *regular* polygon is the relations between them. So the tool's real work is not the drawing — three clicks and some trigonometry — but choosing the smallest set of relations that keeps the figure itself without saying anything twice.

## Decisions

| Area | Decision |
| --- | --- |
| Menu | A `Pentagon` button in the drawing row of the rail, right **before** Проекция, as the memo places it, and **N** on the keyboard. It is a drawing tool like the others: no selection, and it stays on after a figure is made. A bare letter is a tool and a Shift letter is a relation, so Shift+N stays Перпендикулярность and the two never meet. |
| Who is drawing | The hints follow the pointer in use: a mouse is told to click, and may hold Shift for the internal radius; a finger and a pen are told to drag and to lift, and are never told about a key they do not have. The tool takes either — three taps, or a drag that names the centre and the radius in one gesture and a tap that only has to count the corners. |
| Three clicks | The **centre**, then the **radius** — which is also the direction of the first corner — then the pointer that names **how many corners** there are. The first two steps take the magnet, like any point a tool places; the third names an angle and takes nothing. |
| The number of corners | The angle between the radius and the pointer is the angle one edge takes up, so the whole turn divided by it is the number of corners, rounded and held between 3 and 64. The pointer's *distance* means nothing at that step: the radius was already given, and reading a length again would let the two disagree. |
| While it is drawn | The chip under the pointer reads the number the step is setting and no other: the radius in millimetres — as the circle tool's does — while the pointer names it, then how many corners there are once the radius is fixed. Two numbers at once would read as two things to set at the same time. Until the radius is named the figure is already drawn, five corners' worth, the way an ellipse is drawn half as tall as it is long before its own second axis is picked: a guess that shows what the clicks are making, and one the next click replaces. |
| The two radii | Shift, held while the radius is being set, switches what that radius means: the distance to the **corners** (the figure is inside the circle pointed at), or the distance to the **middle of every edge** (the figure is outside it). The memo's "внешний или внутренний радиус". The preview follows the key at once, as the offset tool's corners do — but the **click that names the radius keeps the answer**: letting go of Shift afterwards must not turn the figure inside out, and Shift pressed while the count is being set changes nothing. A modifier that keeps re-deciding a value already clicked is a modifier that undoes the click. |
| The dotted radius | The guide circle is always the radius that was pointed at, so it sits where that radius is: through the corners when the figure stands inside it, and *inside the figure* when Shift made the distance the one the edges stand at. |
| One circle, always through the corners | The construction circle holds the figure at one radius, whichever radius was pointed at: with the internal radius the circle is placed on the corners, a factor of `1/cos(π/n)` further out. A circle the edges touch would need one tangency per edge instead, and a ring of equal edges already implies that tangency for every polygon whose count is a multiple of four — the solver then reports the figure as over-constrained. One circle through the corners says "all corners equally far away" once, in one way, for every count. |
| What holds the figure | Three relations and nothing else: `n` coincidences (a corner is one point, not two that touch), `n-1` equal edges (all measured against the first), and `n` point-on-circle. A closed ring of equal edges with every corner on one circle *is* a regular polygon, in both directions — and the rank analysis agrees: no conflict and no redundancy for every count from three to sixteen. |
| Exact, no solve | The corners are computed on the circle and every relation holds by construction, so the commit does not solve — the same rule as the scissors, the split and the stretch. Solving could only let an under-constrained sketch move something the figure did not ask for. |
| One edit | The lines, the circle and every relation land as one `feature/replace`, so the whole figure is one undo step, and the tool stays on for the next one. |
| Snapping | The centre and the first corner are points of the finished figure, so a click that snapped keeps that: a point target becomes a `coincident`, a curve target a `point-on-line`, `point-on-circle` or `point-on-ellipse`. That is how a polygon centred on the origin stays centred on it. |
| Helpers | The circle is construction geometry, so it never joins the profile; the figure itself is plain lines, so the scissors, the rounding and the offset work on it like on any other lines. |

## Consequences

- Dragging a corner brings the figure back to a regular polygon instead of shearing it: the equal edges and the one circle pull the rest of the corners along. A test drags one corner three millimetres out and checks that every edge comes back equal and every corner back on the circle.
- The number of corners is a fact of the geometry, not a parameter: the figure cannot be told to become a heptagon later, the way a feature would. Making that a driving relation is a separate step, and the sketch format has nowhere to put it yet.
- A polygon drawn with the internal radius is larger than the circle that was dragged: its edges stand where the pointer stood, and its corners stand further out. The construction circle shows where the corners are, which is the circle the figure is actually held on.
- The figure is a set of separate lines joined by coincidences, not one entity: deleting one edge leaves the rest, and that is what the sketch format can express.
