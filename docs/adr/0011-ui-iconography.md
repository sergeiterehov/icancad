# ADR 0011 — UI iconography

Status: accepted (M2)

## Context

The toolbar, the sketch tools and the history used different visual languages:
the extrude chip always looked the same regardless of its operation, the sketch
tools used generic shapes, and some placeholder tools were shown disabled. The
product wants one monochrome icon set with an obvious meaning for every action.

## Decisions

Icons come from `lucide-react` 1.71. The experimental point marker
(`crosshair-plus-dot`) comes from `@lucide/lab` 0.12 and is rendered through
lucide's `Icon` wrapper. Both packages are dependencies of the web app.

| Location | Action | Icon |
|---|---|---|
| Main tools | Sketch | `PencilRuler` |
| Main tools | Extrude | `LayersArrowUp` |
| Main tools | Section | `SquareCenterlineDashedVertical` |
| Extrude operation, inspector and history | New body | `Box` |
| Extrude operation, inspector and history | Add / unite | `SquaresUnite` |
| Extrude operation, inspector and history | Subtract | `SquaresSubtract` |
| Extrude operation, inspector and history | Intersect | `SquaresIntersect` |
| Sketch tools | Select | `MousePointer2` |
| Sketch tools | Point | `CrosshairPlusDot` (Lucide Lab) |
| Sketch tools | Line | `Waypoints` |
| Sketch tools | Circle | `CircleDot` |
| Sketch tools | Arc | `LoaderCircle` |
| Sketch tools | Ellipse | `Ellipse` |
| Sketch tools | Spline / Bezier | `LineSquiggle` |
| Sketch tools | Construction geometry | `LineStyle` |
| Sketch tools | Constraints | `Ruler` |
| Sketch object sections | Faces | `Hexagon` |
| Sketch object sections | Edges | `Spline` |
| Sketch object sections | Points | `CrosshairPlusDot` (Lucide Lab) |
| Extrude faces list | Whole sketch | `PencilRuler` |
| Extrude faces list | Picked sketch or body face | `Hexagon` |
| History | Sketch feature | `PencilRuler` |
| History | Extrude feature | The icon of its operation (`Box`, `SquaresUnite`, `SquaresSubtract`, `SquaresIntersect`) |
| History | Primitive, boolean, import, delete | `Box`, `Scissors`, `FileUp`, `Trash2` |

Unimplemented tools are not shown: the disabled Shell and Hole buttons and their
labels were removed.

## Consequences

- The extrude chip in the history is a quick read of the operation, and the same
  icon appears on the operation tabs in the inspector.
- The face marker is reused for section headers and for picked faces in an
  extrude, so a face always looks the same in the sketch object and in the
  operation that consumes it.
- The point marker is experimental in Lucide Lab. If it changes or disappears,
  replace it with the closest Lab marker without touching the rest of the set.
- Upgrading `lucide-react` is now part of the UI work: the chosen names (for
  example `LayersArrowUp` and `SquaresUnite`) do not exist in the old 0.70
  version.
