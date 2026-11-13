# ADR 0020 — Constraint shortcuts

## Context

Every sketch constraint used to take its own `Shift` letter, so the catalog needed twenty
letters. That forced mnemonics that mean nothing to a user (`Shift+I`, `Shift+J`,
`Shift+K` for point-on-line, point-on-circle and point-on-ellipse) and kept two letters
(`Shift+O` concentric, `Shift+M` midpoint) for constraints the editor can never create and
the solver mapping ignores.

At the same time some constraints can never apply to the same selection. `coincident`
needs every selected reference to be a point, while `point-on-line`, `point-on-circle` and
`point-on-ellipse` need exactly one selected entity to lie on — a selection is never both.
They also mean the same thing to a user: attach the point to the target under it. The same
holds for `distance` (two points, or the length of one line) and `diameter` (one circle or
arc).

## Decision

| Area | Decision |
| --- | --- |
| Families | A shortcut letter belongs to a family of constraint types. A letter may name several types only when no selection can offer two of them at once, which the constraint menu already guarantees because it lists what the selection allows. |
| Resolution | On a key press the editor walks the family in catalog order and applies the first action `buildConstraintActions` offers for the current selection. A family with no applicable constraint is a silent no-op. |
| Letters | `⇧C` coincident, point-on-line, point-on-circle, point-on-ellipse; `⇧D` distance, diameter; `⇧F` fix; `⇧H` horizontal; `⇧V` vertical; `⇧P` parallel; `⇧N` perpendicular; `⇧T` tangent; `⇧E` equal; `⇧S` symmetric; `⇧X` horizontal distance; `⇧Y` vertical distance; `⇧A` angle; `⇧R` radius. |
| Radius | `radius` keeps its own letter even though `diameter` shares `⇧D`: one circle offers both, so they cannot share. |
| Dead constraints | `concentric` and `midpoint` are removed from the model, the schema, the catalog and the locales. They were declared but never creatable and never mapped to the solver; midpoints are expressed by point symmetry instead. |
| Guard | A test enumerates representative selections and asserts that no two constraints offered together share a letter, so a future catalog edit cannot reintroduce a clash. |

## Consequences

- The catalog is the single place that owns keys; the tool rail menu and the tooltips read
  `constraintShortcutLabel` from it and therefore show one hint per entry.
- `Shift+L` no longer means distance; `Shift+I`, `Shift+J`, `Shift+K`, `Shift+O` and
  `Shift+M` are free.
- Project files that contain `concentric` or `midpoint` constraints no longer validate. The
  editor never produced them, so no project written by this app is affected.
- Grouping constraints by meaning is a UX decision, not a solver one: the underlying
  constraint types and the solver mapping are unchanged.
