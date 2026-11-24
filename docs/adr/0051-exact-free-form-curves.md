# ADR 0051 — Exact free-form curves in profiles

Status: accepted

## Context

A sketch Bezier reached the kernel as the 32 line segments of its tessellation, so an extrusion over it got a wall of 32 facets instead of one smooth face. Circles, arcs, ellipses and elliptical arcs have been exact `gp_Circ`/`gp_Elips` edges since ADRs 0008, 0009 and 0044; free-form curves were the last curve still passed as a polyline, and the facet seams also made those walls impossible to fillet as one face.

A Bezier is not a special case of anything. It is a B-spline of degree *n* over *n* + 1 poles with a single span, so the kernel already has the primitive it needs: `Geom_BSplineCurve`.

## Decisions

| Area | Decision |
| ---- | -------- |
| Curve | The sketch profile gains a `bspline` curve: poles in sketch coordinates, a degree, the knots and their multiplicities, an optional weight per pole for a rational curve, and `reversed` like the other exact curves. |
| Bezier as a span | `entityOrientations` sends a Bezier as one clamped span: the control points are the poles, the degree is `points.length - 1`, the knots are `[0, 1]` and both multiplicities are `degree + 1`. No weights, because a sketch Bezier is not rational. |
| Walking it backwards | Reversing a spline is reversing its poles, so the backward direction is the same span with the poles flipped and no `reversed` flag: the edge needs no flip, and the contour still joins end to end because a clamped spline starts at its first pole and ends at its last. |
| Kernel edge | `buildEdge` lifts the poles onto the sketch plane, builds `Geom_BSplineCurve_1` from them, wraps it in `Handle_Geom_Curve_2` and makes the edge with `BRepBuilderAPI_MakeEdge_24`. That overload of the constructor takes any `Geom_Curve`, and it is the only one the wasm binding exposes for a spline: the `Handle_Geom_BSplineCurve` that was tried first is not accepted by any `MakeEdge`. |
| Contour ends | `curveStart` and `curveEnd` of both the profile and the kernel use the first and last pole, honouring `reversed`, so chaining and `assertClosedLoop` need no special case. |
| Keys | The span keeps the entity key, so an extrusion side named after the Bezier keeps its name (ADR 0042). |
| Partial runs | A run of a Bezier cut short by an intersection is still sent as a polyline. Splitting a spline exactly means subdividing it at a parameter, which is the separate step the next ADR covers. |

## Consequences

- A bump over a base line sweeps into four faces — two caps, one flat base, one curved wall — where the polyline gave one face per segment.
- The kernel test builds exactly that prism and asserts four faces, and the profile test asserts one clamped span with the poles in order, plus the reversed-pole variant.
- `libPoints` in `extrudeToBody` approximates a spline by its poles. Those points only seed probes for picking a body, so the convex hull being slightly larger than the curve does not matter.
- Still open, in order: a real `bspline` sketch entity (degree 3, several spans, weights, periodic), and trimming, splitting and extending a free-form curve at a parameter of its span. Until then a free-form curve is drawn, constrained and extruded exactly, but trimmed by its tessellation.
