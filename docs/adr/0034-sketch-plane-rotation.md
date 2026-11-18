# ADR 0034 — Sketch plane rotation: an angled surface for a sketch operation

Status: accepted

## Context

A sketch could only sit on one of the three datum planes (with an offset) or on a
picked planar face. A face gives the sketch its pose, but a surface that does not
exist yet — an angled fixture, a draft wall, a plane through a sharp edge — had
no way into the sketch operation. Users asked for a rotation setting in the
operation: a switch under the plane row, three angle fields labelled with the
axes, and rotation grips in 3D.

The plane is not a separate object in this app: it is a property of the sketch
operation, and every derived shape (profiles, extrusions, projections, the
section cut, the editor camera and grid) is built from the sketch frame the
rebuild publishes. The setting therefore belongs on the plane reference, so a
rotation carries through undo, saving and every consumer without a second
source of truth.

## Decisions

| Area            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage         | Both plane variants, datum and face, take an optional `rotation: ParamVec3`. It is absent when the feature is off; the presence of the field is the switch, like the second direction of an extrude. Each angle is a `ParamValue`, so a formula works exactly as in every other numeric field.                                                                                                                                                                          |
| Units           | Angles are degrees, matching revolve and array angles, and the field shows `°`.                                                                                                                                                                                                                                                                                                                                                                                         |
| Axes            | The angles turn the sketch around its **own** axes: X is `frame.xAxis`, Y is `frame.yAxis`, Z is `frame.normal`. On a face sketch they travel with the face instead of pointing at the world axes.                                                                                                                                                                                                                                                                      |
| Order           | The turns are intrinsic: X first, then Y around the X-turned axis, then Z around the axis the two previous turns produced. The frame is `R = Rx(a) · Ry(b) · Rz(c)`, so Z spins the sketch in its plane while X and Y tilt the plane itself.                                                                                                                                                                                                                            |
| Pivot           | Rotation keeps `frame.origin` in place. That point is the sketch anchor — the world origin on a datum plane and the face centroid on a face — so the sketch turns around the marker the editor shows, not around the middle of whatever has been drawn.                                                                                                                                                                                                                 |
| Composition     | The base pose comes from the datum or the face and its mesh, then the offset moves it, then the direction flip turns it around, and the rotation turns its axes last. A frozen frame from a rebuild already contains the result and is used as is. Offsets and the flip therefore keep the meaning they had before rotation existed.                                                                                                                                    |
| Gizmo           | A sketch operation with rotation on offers three arc handles centred on the anchor. Each ring rides the axis the preceding turns left, its reference is the neighbouring axis of that intermediate frame, and its angle is the stored one; a drag writes that single angle as one undo step. Rings are coloured by axis (red X, green Y, blue Z). They are operation handles, so they hide while the sketch editor is open or a picker is armed, like every other grip. |
| Ring size       | A ring keeps a fixed 72 px radius on screen, independent of the sketch content and of the zoom. The controller resolves that radius through the current pixels-per-model-unit before drawing, hit-testing or reading the pointer angle, so nothing about a rotated sketch changes the size of its grips.                                                                                                                                                                |
| View            | Entering the editor turns the view along the sketch normal as before, and rolls it so the sketch's own X axis is horizontal and its Y axis vertical. The roll is measured from the turntable basis to the frame's Y axis about the eye direction, so a rotated sketch opens the way it was drawn instead of at an arbitrary angle.                                                                                                                                      |
| Formulas        | `plane.rotation.0/1/2` are registered as angle parameters, so the resolver normalises and diagnoses them like any other angle. An angle with a broken formula keeps the sketch's last solved geometry and now paints the field red; a driven angle offers no grip, because dragging would replace the expression.                                                                                                                                                       |
| Plane switching | Changing between datum tabs or switching to a face keeps the rotation. The rotation describes the sketch surface, not the datum, so losing it on a plane change would silently discard a placement setting.                                                                                                                                                                                                                                                             |
| Persistence     | The schema change is additive and optional, so the project schema version does not change: older documents read as before, and an absent field is not written. Older builds that do not know the field would drop it on a round trip, which is the usual cost of an additive optional feature in this format.                                                                                                                                                           |
| Testing         | Unit tests cover the frame composition (origin, right-handedness, all three axes, intrinsic order, flip plus rotation, formulas and a frozen frame), the rings' axes and references, the view roll (including a tilted plane), and the handles: three per enabled sketch, one per axis, no grips for absent rotation or a formula angle, the same screen radius for tiny and huge sketches, and a drag that changes one angle and commits one history step.             |

## Consequences

- A sketch can be placed on an arbitrary plane without constructing a reference
  body first; the plane is still a property of the operation, not a new object.
- Offset and flip keep their old meaning, and rotation is the last step, so a
  rotated sketch can also be offset and flipped without surprising axis changes.
- The gizmo exposes the same three numbers as the panel, so a drag and a typed
  value are interchangeable and both are undoable.
- Because everything downstream already reads the published sketch frame,
  extrusions, revolves, arrays, projections and the editor camera follow the
  rotated surface with no operation-specific handling.
