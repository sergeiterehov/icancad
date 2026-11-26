# ADR 0058 — The depth range follows the picture, and a section cap follows its body

Status: accepted

## Context

Zooming the 3D view far out cut the ground grid off halfway across the screen:
past a few metres of orbit distance the plane ended on a straight line and the
backdrop was gone. The depth range came from the model — `far` was the eye plus
twice the content radius plus `CAMERA_REACH` — while at a wide zoom the picture
reaches much further than the model, and the grid is built to cover that picture.
Everything past `far` was clipped away, and the grid is the widest thing in the
scene, so it went first. Handles, overlay lines and caps that reach beyond the
model were exposed to the same cut.

A section cap was a fixed `PlaneGeometry(4000, 4000)` placed on the cut plane at
its origin. A body measured in metres poked out of its own cap, and a body built
away from the origin left the patch behind altogether, so a section showed a
hatched rectangle floating over an unhatched face.

## Decisions

| Area        | Decision                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depth range | `cameraFrustum(distance, radius, viewRadius)` takes how far the picture reaches from the target and uses the larger of that and the content radius for `far`. `SceneController` passes the ground grid's extent, since the grid covers more than the frustum by design (ADR 0056). |
| Near plane  | Unchanged: still `distance * 0.001`, and the eye keeps `2 · contentRadius` of clearance, so an orthographic zoom never drives the near plane into the model.                                                                                                                       |
| Cap patch   | One shared 4 m patch (`CAP_PATCH_SIZE`) that is moved onto the body's bounding-sphere centre projected onto the cut plane and scaled to its radius, so it always covers the whole cut face of the body it fills.                                                                   |
| Grid extent | `gridExtent()` is the single place that answers how far the ground grid is drawn; both `updateWorldGrid()` and the depth range read it, so the two cannot drift apart.                                                                                                             |

## Consequences

- The ground plane reaches the edge of the view at any zoom; the backdrop no
  longer ends on a visible straight cut.
- The depth range now depends on the zoom as well as on the model, so the
  depth buffer's resolution scales down as the view pulls back — 0.005 mm at a
  3 m view, 0.6 mm at a 10 km one, against a picture measured in metres.
- A section cap covers a part of any size, wherever it stands in the model, at
  the cost of one `scale` per body instead of a fixed square.
