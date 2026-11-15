# ADR 0029 — Array: repeat operations or bodies along several directions

Status: accepted (M4)

## Context

A part often needs the same shape many times: a row of ribs, a ring of holes, a
grid of bosses. Doing that by hand means copying the operation and moving every
copy, and the copies then fall out of step with the original.

The array tool has to answer four questions: what is repeated, how it is placed,
how many copies there are, and what happens when the user wants a grid rather
than a row.

## Decisions

| Area | Decision |
| --- | --- |
| One operation | The array is a feature of its own, `array`. Its inputs and directions live in the operation, so it can be edited, suppressed and undone like any other step of the history. |
| What is repeated | `target` is `bodies` or `operations`. Bodies repeats the picked bodies. Operations repeats the bodies the picked operations *made*: the rebuild reads what each operation reported, so a repeated new-body extrude, primitive or outward shell needs no second evaluation. |
| Modifying extrude | An extrude with `add`, `subtract` or `intersect` made no body of its own, but it does have a tool. The rebuild keeps that tool, the bodies it changed and the boolean it used; the array copies the tool to every placement and applies it to the same bodies with the same boolean. A row of slots is therefore one body with several cuts, not several bodies. Parts an add would leave as a separate solid are skipped, as the source operation skips them. Other operations that only change a body — a fillet, a boolean, an inward shell — have no tool to replay and are not offered. |
| Copies are bodies | Every copy is a body of its own, created by the array and listed under it. The seeds stay where they are, untouched. This is what lets a copy be picked, coloured, hidden or used by a later operation. |
| Directions | A direction is `linear` (a vector and a step), `rotation` (an axis and an angle step) or `path` (a sketch curve). Each one carries a `count` that includes the seed, so `count = 1` places nothing. |
| Linear | The step is a signed distance along the normalised vector; the inspector offers the world axes and a reverse toggle, and any vector is still valid in the document. |
| Rotation | The axis reuses `RevolveAxis`: a world axis today, with the same world axes shown in the inspector. Angles are right-handed degrees around the axis, measured from the seed. |
| Path | The path is a curve of a sketch: line, arc, circle, ellipse or Bézier. Copies are spaced by arc length along the tessellated curve and only translated — the seed keeps its orientation, so a ring of bodies stays upright. A closed curve divides by the count instead of the count minus one, so the last copy does not land on the seed. |
| Several directions | Directions nest instead of being combined pairwise on the seed. With seeds `S` and directions `T₁…Tₖ`, the result is `S₀ = S`, `Sₖ = ⋃ᵢ Tₖ(i)(Sₖ₋₁)`. In other words: the second direction repeats the whole result of the first, and the third repeats the whole result of the second. A 3 × 4 linear array is a grid; a 3-linear + 6-rotation array is six clusters of three bodies turned around the axis. |
| Order matters | Nesting is why each direction is applied outside the previous one. Translations commute, so a grid looks the same either way; a rotation and a straight direction do not, and only nesting turns a whole row instead of scattering its copies. The matrices multiply as `Tₖ(iₖ) · … · T₁(i₁)`, which is the same order the panel lists them in. |
| Identity | The combination where every direction sits at index 0 is the seed itself and is not copied again. The number of copies is therefore `Π countₖ − 1` per seed. |
| Copy identity | A copy is named after its seed and its combination, `arrayBodyId(feature, seed, "0-2-1")`, so changing a later direction leaves the earlier copies where they were and keeps their names, colours and metadata. |
| Body lists | The array stores the picked body ids and operation ids. Both are normal history references: the model validates them, refuses a dependency that comes later, and a removed body or operation shows as a failed target instead of silently repeating nothing. |
| Picking surface | While the array's settings are open the timeline belongs to it: a chip adds the clicked operation to the list, whether or not the pencil is armed, instead of closing the array and opening that operation. Reopening the settings arms the matching picker, so the hint and the pencil always describe what a click will take. |
| Limits | A direction takes 1 to 100 copies, an array at most three directions, and one array at most 200 positions including the seed. The inspector stops a count before the product leaves the ceiling; a document that carries a larger one is reported as `ARRAY_TOO_LARGE` and blocks the timeline like any other failing operation. |
| Kernel | The kernel gets one new request, `transform-shape`: it copies a shape at a row-major 3×4 affine (`gp_Trsf.SetValues`) and returns the new shape and its statistics. The array never rebuilds the seed operation: a copy is exact by construction, including arcs and holes. |
| Errors | An unresolvable direction fails the operation instead of quietly repeating the seed once: `ARRAY_DIRECTION_MISSING`, `ARRAY_AXIS_MISSING`, `ARRAY_PATH_MISSING`, `ARRAY_PATH_EMPTY`. A seed that is missing or is an imported mesh is reported per body, and the other seeds still build. |
| Preview | Copies are new bodies, so the ordinary preview marks them as added and draws them while the array is being configured. The seeds are not marked. |
| Icon | `layout-arrow-down` in the tool rail and the timeline: a column of shapes and an arrow, the shape repeated down a direction. |

## How a multi-direction array works

A three-by-four grid is one linear direction with three positions and a second
linear direction with four. Because the second repeats the first, the result is
`3 × 4 = 12` positions, the seed included:

```
S₁ = { T₁(0)s, T₁(1)s, T₁(2)s }
S₂ = { T₂(j)T₁(i)s | j = 0…3, i = 0…2 }
```

A straight row bent into a ring uses a rotation as the second direction. The
rotation turns the whole row, so the bodies keep their spacing relative to each
other and the result reads as a ring of rows rather than a ring of seeds:

```
T₂(j) · T₁(i) = R(jθ) · Translate(i · step)
```

If the rotation were applied to the seed instead, every body would stay at its
own distance from the axis and the spacing along the row would disappear. The
same rule makes a path usable as the outer direction: the whole inner array
walks along the curve.

## Consequences

- A user picks objects, adds a direction and sees the copies; no operation has
  to be duplicated by hand, and changing the seed changes every copy.
- An extrude that only edits a body is arrayed by its tool, so the copies land
  on the same body. Its result is not a set of new bodies: the body keeps its
  id, name and colour, and only its shape changes, exactly as after the source
  operation. A fillet or a boolean still cannot be arrayed as an operation:
  repeating one would mean transforming its face and edge refs into new ones,
  which is a different feature. The body it produced can still be arrayed as a
  body, which copies its result rather than the treatment.
- A path array translates only. Aligning copies to the tangent of the path is a
  later decision; a rotation direction already covers rings and fans.
- Every copy is a kernel shape and a tessellation, which is why the count is
  capped. A future batched copy request can raise the ceiling without changing
  the document.
- The rotation axis uses the revolve axis model, so edge axes can be offered by
  the inspector later without a schema change.
