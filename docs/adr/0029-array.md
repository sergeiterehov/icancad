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
| What is repeated | `target` is `bodies` or `geometry` (the panel's "Repeat": "Geometry" or "Bodies"). Bodies repeats the picked bodies. Geometry repeats what the picked operations did, in history order: a body an operation made is copied at the shape it had right after that operation, and a change an operation made in place is replayed on the bodies it changed. The array therefore reads the build, it does not re-run it. Projects written before the target was named honestly stored `operations`; loading them maps it to `geometry`. |
| Extrude tool | An extrude with `add`, `subtract` or `intersect` made no body of its own, but it does have a tool. The rebuild keeps that tool, the bodies it changed and the boolean it used; the array copies the tool to every placement and applies it to the same bodies with the same boolean. A row of slots is therefore one body with several cuts, not several bodies. Parts an add would leave as a separate solid are skipped, as the source operation skips them. |
| Modifying operations | Every other operation that changes a body in place is repeated by the material it changed: `added = after − before` and `removed = before − after`, computed once per body from the shapes recorded around the operation. Each copy transforms both volumes and fuses or cuts them, so a fillet, a chamfer, a hole, a rib, a boolean or an inward shell repeats as the same geometric change. A later operation that touched a body made by an earlier picked operation works on that body's copy, not on the seed. |
| Copies are bodies | Every copy is a body of its own, created by the array and listed under it. The seeds stay where they are, untouched. This is what lets a copy be picked, coloured, hidden or used by a later operation. |
| Directions | A direction is `linear` (a vector and a step), `rotation` (an axis and the whole angle the copies span) or `path` (curves joined end to end). Each one carries a `count` that includes the seed, so `count = 1` places nothing. |
| Linear | The step is a signed distance along the normalised vector; the inspector offers the world axes and a reverse toggle, and any vector is still valid in the document. |
| Tilt | A straight direction carries an `angle` (0° by default) that turns it out of its world axis, so two directions of a grid can meet at any angle and the array becomes a parallelepiped instead of a box. The hinge is fixed by the chosen axis: X and Y lean inside the horizontal plane (around Z), Z leans around X. The field sits beside the axis tabs — no grip, because the copies already show the result — and it is clamped to ±180°, since past half a turn the same row comes back the other way. |
| Rotation | The span is the whole sweep, not the step: the copies share it evenly, so the last one lands exactly on `angle` and the step is `angle / (count − 1)`; a full turn closes on itself and divides by the count instead. The span is always 0…360 and never signed — `inverted` carries the direction of turn, so the field has no minus sign and a grip dragged the other way sets that flag rather than a negative angle. There are exactly two axes (`ArrayRotationAxis`): a world axis through the centre of the model, and the normal of a picked planar face. Angles are right-handed degrees around the axis, measured from the seed. |
| World axis | A world axis runs through the centre of the model. The copies swing around it at whatever distance they are, so a rotation about an axis has exactly two freedoms — the span and the count — and no radius to set: a radius that is not a degree of freedom is a number the user has to invent. |
| Face axis | A picked face turns the copies around its normal, through the centre of the face. A region of a sketch counts as a face too: its plane is the plane of the sketch and its centre is the middle of its extent, so a sketch lying on a body can be the axis of its own array. Sketch regions are drawn over the faces they lie on while a face picker is armed, and they answer the pick first, so the sketch is reachable even when a body face sits under it. Only a planar face of a body qualifies — anything else is refused with the same "face is not planar" the sketch tool uses. The pose (centre and normal) is captured at pick time like every other face reference, so a rebuild that renumbers faces cannot move the turn. |
| Axis controls | The axis is a row of tabs — `X`, `Y`, `Z` and a face, the last one a symbol rather than a word — and the one setting that belongs to the selected tab: the tilt of a straight direction, or the face picker of a rotation. Neither has a heading of its own, and the face picker explains itself in a tooltip. |
| Rotation dial | The grips of a rotation ride the circle the copies themselves travel: the dial is centred on the point of the axis nearest the seed (the centre of the array) and its radius is the distance to the seed. The arrow ends where the last copy turns to, the count ball sits on the first copy, and the whole circle is drawn dashed so the ring is visible before it is filled. |
| Face centre | The centre of a face is the middle of its extent, not its centre of mass: a plate with a corner notched out covers half of its own box, and a turn around the middle of its material would look off-centre. The extent is measured in the plane of the face and along axes taken from the world, so one face is measured the same way as the next however its surface is stored — an offset re-stores a plane as a spline, and the frame of a stored plane is not stable. A face of a body asks the kernel, which boxes the exact boundary curves: a tessellated arc stops short of its own corner by the sagitta of its chords, which on a radius of fifty is nearly half a hundredth, and that is the error a turned pattern shows. A region of a sketch measures its own outline and solves the corners of its arcs and ellipses, which a flattened outline never reaches. |
| Names | Every picker and every list names a piece of geometry the same way: the object it belongs to, a middle dot, and the number of the piece — `Тело 10 · 8`, `Скетч · 1`. What the piece is, a face or an edge, is said by the icon beside the name, so the name stays short and identical in a single picker and in a multi-select list. |
| Path | A path is a list of curves — edges of bodies and curves of sketches — that have to run end to end. The rebuild orders them by the ends they share and walks them into one polyline; a set that does not join is `ARRAY_PATH_BROKEN`, the operation is not evaluated, and the curves stay in the list so the gap can be closed. Copies are spaced by arc length along that polyline and only translated — the seed keeps its orientation, so a ring of bodies stays upright. A closed run divides by the count instead of the count minus one, so the last copy does not land on the seed. |
| Several directions | Directions nest instead of being combined pairwise on the seed. With seeds `S` and directions `T₁…Tₖ`, the result is `S₀ = S`, `Sₖ = ⋃ᵢ Tₖ(i)(Sₖ₋₁)`. In other words: the second direction repeats the whole result of the first, and the third repeats the whole result of the second. A 3 × 4 linear array is a grid; a 3-linear + 6-rotation array is six clusters of three bodies turned around the axis. |
| Order matters | Nesting is why each direction is applied outside the previous one. Translations commute, so a grid looks the same either way; a rotation and a straight direction do not, and only nesting turns a whole row instead of scattering its copies. The matrices multiply as `Tₖ(iₖ) · … · T₁(i₁)`, which is the same order the panel lists them in. |
| Identity | The combination where every direction sits at index 0 is the seed itself and is not copied again. The number of copies is therefore `Π countₖ − 1` per seed. |
| Copy identity | A copy is named after its seed and its combination, `arrayBodyId(feature, seed, "0-2-1")`, so changing a later direction leaves the earlier copies where they were and keeps their names, colours and metadata. |
| Body lists | The array stores the picked body ids and operation ids. Both are normal history references: the model validates them, refuses a dependency that comes later, and a removed body or operation shows as a failed target instead of silently repeating nothing. |
| Picking surface | The pencil arms a picker and nothing else does: with the operations picker armed a timeline chip adds the clicked operation, and with it off a chip selects that operation like it always does. An array never takes itself or an operation that comes after it. Opening the settings never arms a picker by itself. |
| Limits | A direction takes 1 to 120 copies, an array at most three directions, and one array at most 200 positions including the seed. The inspector stops a count before the product leaves the ceiling; a document that carries a larger one is reported as `ARRAY_TOO_LARGE` and blocks the timeline like any other failing operation. |
| Kernel | The kernel gets one new request, `transform-shape`: it copies a shape at a row-major 3×4 affine (`gp_Trsf.SetValues`) and returns the new shape and its statistics. The array never rebuilds the seed operation: a copy is exact by construction, including arcs and holes. |
| One boolean per body | A repeated change is applied to a body as **one** boolean, not one per placement: every placed tool goes into a single `boolean-all` request, and the engine gathers them into one compound for OCCT. Twenty bosses cost one boolean instead of twenty, and the new material is merged in one pass. A guarded run (an add that must not leave a solid of its own) falls back to a placement at a time when the batch gains a solid. |
| One mesh per body | Bodies are meshed once, after the whole array is in place, and the statistics come from the boolean that produced the shape. Meshing the growing body after every placement was the largest single cost of a large array. |
| Errors | An unresolvable direction fails the operation instead of quietly repeating the seed once: `ARRAY_DIRECTION_MISSING`, `ARRAY_AXIS_MISSING`, `ARRAY_PATH_MISSING`, `ARRAY_PATH_EMPTY`, `ARRAY_PATH_BROKEN`. A seed that is missing or is an imported mesh is reported per body, and the other seeds still build. |
| Preview | While the array is being configured nothing is replayed. The volume one repetition repeats is measured once — the tool of an extrude, the created body, or `added`/`removed` of a change — and every placement draws that same tessellation at its own matrix. The volume is measured only when the picking ends, so picking stays a list edit; changing the count, the step or a direction only moves the placements, and the seeds stay in their own style. A handle drag moves the copies already on screen, without waiting for a rebuild: only the transforms change. |
| 3D grips | The array starts from the centre of the repeated volume. A step arrow grows along the repeat direction and sets the step; a ball grip on a dashed line sits where the last copy lands, so dragging it moves the copy index by whole steps. A rotation has an arc for its whole angle and a second grip on the first step: the closer that one sits to the start, the more copies the same angle holds. A path has one grip on its first copy, and the distance it is dragged to is the step, so the count follows the length of the run. Grips of the array and of everything else step aside while a picker is armed. |
| Single pickers | A field that holds one picked object can be emptied: Delete or Backspace while it has the keyboard, the cross on its right, or the one entry of its context menu. A field that is a list drops one row at a time instead. |
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
- An operation that only edits a body is arrayed on that body: a row of slots or
  a row of fillets is one body with several changes, which is what repeating the
  source operation by hand would produce.
- A group of operations repeats as a group. Picking the extrude that made a boss
  and the fillet that rounded its base builds every copy in that order, so the
  copies come out with the fillet instead of being plain bosses.
- Shell inward repeats its cavity. Inside a group — create a body, then shell it
  — that hollows every copy, which is what the group means. Used alone on one
  body it cuts the same cavity at several places: predictable, but rarely what a
  user wants. Shell outward makes bodies, so it is repeated as copies.
- A fillet or a boolean is repeated by its geometric change, not by re-running
  its face and edge references. That is why a pattern of bosses can carry their
  fillets without the array having to know which edges the fillet will create.
- A path array translates only. Aligning copies to the tangent of the path is a
  later decision; a rotation direction already covers rings and fans.
- Every copy is a kernel shape and a tessellation, which is why the count is
  capped. A future batched copy request can raise the ceiling without changing
  the document.
- A preview is one tessellation and a matrix per copy, so the count, the step
  and the directions answer immediately. Only committing the array pays for the
  real copies.
- The rotation axis is its own type rather than the revolve axis: a revolve axis
  is any line in the model, while an array needs a line it can derive without a
  pick (a world axis through the centre of the model) or a pose it can read
  from a face. An axis written as a picked edge or as a sketch arc before this
  change loads as a world axis.

## Known limitation of the delta replay

A modifying operation is repeated by the volume it added or removed, not by
re-running the operation against the geometry at the new position. For a boss
whose fillet was made on a low step, a copy that lands on a higher step gets the
fillet volume at the old height: inside the material, where it changes nothing.
The demo project "Array delta demo" shows exactly that — the left boss is
rounded, the right one on the raised step has a sharp base.

The replacement is to replay the operations themselves with transformed
references (a feature pattern, as other CAD tools do), so the fillet resolves
the edge that is actually there. The delta stays as the current implementation
and as a fallback for operations that cannot be replayed yet.
