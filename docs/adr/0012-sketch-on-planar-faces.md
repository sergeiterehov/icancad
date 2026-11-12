# ADR 0012 — Sketch planes on planar faces

Status: accepted (M3)

## Context

Sketches could only use the XY, XZ and YZ datum planes. The document already had
a `face` variant of `SketchPlaneRef` with a body id, a face id and a frame, but
the inspector never exposed it. Users need to sketch directly on a flat face of
a solid, with the same offset control they use on datum planes, and an invalid
face must not leave a usable sketch object behind.

## Decisions

| Area | Decision |
|---|---|
| Plane selector | The sketch placement switch has a fourth tab for a face, using the established face icon `Hexagon` (ADR 0011). The three datum tabs keep their labels. |
| Sketch tool entry | The Sketch tool menu starts with "Select face" / "Выбрать грань" (`Hexagon`). It creates a face-plane sketch, selects the operation, opens the placement panel and starts face picking. A successful pick writes the plane and opens the sketch editor immediately; cancelling leaves the operation with a required but empty plane. When the viewport already has a single selected planar body face, that face is used directly and the sketch editor opens without a picking step (ADR 0014). |
| Datum side hints | The datum entries use the side as their main label (Top, Front, Right) and the plane as the muted right-aligned hint (XY, XZ, YZ), so the orientation can be matched to the adjacent navigation cube. The hints use the existing smaller context-menu hint style. |
| Face picker | Below the switch, a face-plane tab shows an input-like picker with the face icon on the left. An empty picker reads "Select a face"; the picker itself supports an empty value, and only the sketch placement marks it invalid. An invalid value uses the selector error background (red tint); an active picking control uses the selector active background (blue tint). |
| Camera alignment | Opening a sketch aligns the camera along the sketch frame normal, including tilted faces. The old dominant-axis shortcut is gone, so the sketch is always viewed face-on. Alignment waits until the rebuild at the sketch's timeline position has published a scene, then resolves the active sketch's face and frame from that fresh scene, so the sketch is oriented only after all earlier operations are applied. The automatic "first geometry" fit is disabled while a sketch is active so it cannot overwrite the sketch alignment. |
| Required face | While the face plane has no face, the picker glows red. Clicking it highlights the control in the accent color and starts face picking. Clicking the active control again or pressing Escape leaves picking without clearing the value. Picking a new face replaces the value. |
| Picking rules | Picking reuses the extrude face mechanism: only a planar face of a solid body can be picked, a curved face is rejected with `FACE_NOT_PLANAR`, and a mesh object is never a candidate. One face is stored at a time. |
| Offset | The offset field is unchanged and moves the sketch along the face normal. The face centre and normal are computed when the sketch operation is evaluated during the rebuild and frozen in the derived sketch-object frame; the editor, section plane and extrusion use that frame plus the offset. Geometry changes before the sketch update it, while changes after the sketch do not move it. |
| Validity | A face plane is valid only while its body still exists, the face id still exists, the stored frame is present and the face is planar. Otherwise the rebuild reports `INVALID_SKETCH_PLANE`, blocks later operations, hides the sketch object from the tree and viewport, and refuses to open the editor. If the editor is already open for that sketch, it closes. |
| Object lifetime | An invalid face sketch is still an operation with an error on the timeline, but it produces no sketch object. Selecting a face and rebuilding restores the object. |

## Consequences

- Face-plane sketches use the same frame helpers as datum sketches, so the camera alignment, section view and extrusion direction agree.
- A face that changes topology or becomes curved invalidates the sketch rather than silently sketching on a fallback plane.
- Persistent face naming remains the same limitation as extrude face refs: the stored id is the OCCT traversal index and is stable only while the body rebuilds the same way.
- The face-plane picker is the first use of the generic `ObjectPickerField`; an empty value is valid by default and callers opt into the red required state.
