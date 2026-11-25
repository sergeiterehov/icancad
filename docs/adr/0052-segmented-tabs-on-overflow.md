# ADR 0052 — Segmented tabs that do not fit

Status: accepted

## Context

A segmented row is one line: labels never wrap and never drop to a second row.
The inspector is narrow, and the operation rows carry both an icon and a word
(«Новое тело», «Объединение», «Вырезание», «Пересечение»), so on a real panel
the words did not fit. Every tab shrank and every label ended in an ellipsis —
four broken words, and the chosen one was as unreadable as the others.

## Decisions

| Area            | Decision                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule            | When the labels of a row do not fit the row's width, the active tab keeps its whole word and every other tab that has an icon folds into that icon. Tabs without an icon keep their label: an empty button says nothing.                                                                                                                                                                                   |
| Measuring       | `Segmented` decides the mode itself, on every render and on every resize of the row. It sets `data-measure` for one synchronous layout read — the row lays every tab out with its full label — compares `scrollWidth` with `clientWidth` (1 px of tolerance) and drops the attribute again before the browser paints. No hidden copy of the row is rendered, so nothing is mounted twice.                  |
| Folding         | `Segmented` passes the decision down through a context; `SegmentedTab` marks the tabs whose name it hides with `data-label-hidden`. The label stays in the DOM at zero width and zero opacity — the measuring pass has to lay it out, and the morph below grows it back out of the icon. A folded tab is 26 px wide, like a square tab.                                                                    |
| The active word | The active tab is the only word a folded row keeps, and it never shrinks into an ellipsis: it keeps its whole name and grows into the space the icons leave, so the row has no empty tail.                                                                                                                                                                                                                 |
| The morph       | Every change of the row's layout is animated over 170 ms: `Segmented` remembers where each slot sat, and after the next commit animates width (with flex-grow/shrink frozen at 0 in the keyframes, so the space is not redistributed mid-flight) and the label's own `max-width`/opacity, so a word grows out of an icon instead of popping in. The tooltip anchor and the tab inside it animate together. |
| No morph when   | The row changed width (a resize already moves the tabs continuously, and the snapshot would be stale), the set of tabs changed, or the system asks for less motion (`prefers-reduced-motion`). In the fold case the snapshot is taken inside the measuring pass itself, at the new width, so the morph starts from the squeezed row rather than from the previous render.                                  |     | One morph only | A click re-renders the whole panel, and every such render passes through the row. The morph is therefore gated on a key of what the row shows (its width, each slot's class, active and folded flags, text): an unchanged key leaves a running animation alone. Measuring on those renders instead read the widths mid-flight and restarted the morph from its own end, which looked like no animation at all. |     | The bubble | A folded tab has no visible name, so it is wrapped in the shared `Tooltip` and its bubble carries the name. A tab that also has its own hint shows the name first and the hint under it in the same stack — the 2 px gap of `tooltip-stack` is the "small offset". A square tab works the same way: the bubble is its name. A tab whose label is visible shows only its hint, as before. |
| Row geometry    | The tooltip anchor takes the tab's flex slot and the tab fills the anchor, so a row that mixes tabs with and without a bubble still lines up.                                                                                                                                                                                                                                                              |

## Consequences

- The extrude operation and extent rows now read «Новое тело» + three icons and
  «На расстояние» + three icons at the normal inspector width; before, all four
  words were ellipsised. Switching the operation slides the pill across the row
  and reveals the new word while the old one folds back into its icon.
- A folded label is still in the accessibility tree as text, but the button's
  `aria-label` is its name, so a screen reader hears the name once.
- Resizing the panel mid-morph cancels the morph (the snapshot no longer
  describes the row); the tabs land on the new layout instead.
- A folded icon is discovered by hovering it: the name arrives as the same
  delayed bubble as every other tooltip, and the button keeps an `aria-label`,
  so the name is not lost to the screen reader either.
- A row of text tabs with no icons cannot fold; it still ellipsises. Such rows
  are short by design (a plane choice, an export quality), and collapsing them
  would leave buttons with nothing inside.
- `data-collapsed` on the row and `data-label-hidden` on a tab are the only new
  styling hooks; the measuring attribute is set imperatively and never reaches
  React's tree.
