# ADR 0056 — The ground grid follows the camera

Status: accepted

## Context

The world grid was a `GridHelper(2000, 200)`: two metres across in ten
millimetre cells, fixed. On a part measured in tens of millimetres it filled
the view with a solid lattice; on a model measured in metres it stopped before
the edge of the picture and its cells were too coarse to judge a distance by.
The sketch grid had already solved the same problem for the plane being drawn
on (its step follows the visible scale, its lines cover the view), and the 3D
view kept the fixed one.

## Decisions

| Area       | Decision                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The step   | From the 1-2-5 series, chosen so cells are about 48 px apart (`WORLD_GRID_TARGET_PX`). Coarser than the sketch grid's 28 px: the ground is a backdrop, the sketch plane is the surface being worked on.      |
| The extent | Lines cover the view around the orbit target with a chunk of margin, on absolute multiples of the step — panning only changes which lines exist, nothing slides under the pointer.                           |
| Rebuilding | On a step change, a chunk crossing (every ten cells) or a quarter-octave change of the visible span; the key also carries the canvas size. A pan inside one chunk and a zoom inside one octave cost nothing. |
| Drawing    | Minor and major line sets (major every fifth), opaque with no depth write, in the opaque pass before the model, exactly as the fixed grid drew.                                                              |

## Consequences

- The same grid serves a 20 mm part and a 2 m assembly: squares the eye can
  count, and the plane reaches the edge of the view instead of ending at 2 m.
- Zooming changes the step, so a line can appear or disappear while the wheel
  turns; the lines stay on absolute coordinates, so nothing else moves.
- Two small geometries are rebuilt instead of one helper, at most once per
  chunk or per quarter-octave of zoom.
