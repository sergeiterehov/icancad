# ADR 0027 — Camera turns around the point under the pointer

Status: accepted

## Context

Turning the view always happened around the orbit target, which is the middle of
the model. When the user is working on the far side of a part, a drag threw that
part out of the viewport: the model swung around a point the user was not looking
at. The buttons were also hard-coded — the middle button turned the view and
Shift with it panned — so anyone arriving from Fusion, Blender or SOLIDWORKS had
to relearn the mouse.

## Decisions

| Area            | Decision                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pivot           | A camera drag rotates both the eye and the target about a pivot, and the view basis turns with them. The pivot therefore keeps its pixel while the model swings around it.                                                                 |
| Pivot source    | The pivot is the surface under the pointer. With nothing under it, the pivot is the point of the pointer's ray at the depth of the current target, so the view turns on the column the pointer stands on without changing the zoom.        |
| Where it is set | At the start of the drag, not on every move: the pivot stays on the pixel where the drag began even though the pointer travels.                                                                                                           |
| Nav cube        | Dragging the cube still turns the view around the target: the pointer is on the widget, not on the model, and the cube is a global orientation control.                                                                                   |
| Schemes         | A table in `apps/web/src/viewport/cameraControls.ts` maps a pointer gesture to orbit or pan, names the pivot and decides whether the wheel zooms towards the pointer. Blender, Fusion 360, SOLIDWORKS and SketchUp are offered.          |
| Gesture default | Blender: the wheel button orbits, Shift with it pans, and the wheel zooms towards the pointer. The app keeps no scheme of its own — it had one only because the bindings were hard-coded before.                                            |
| Trackpad        | A scheme of a program without a middle button still has to work on a trackpad, so every wheel-button gesture has an Alt-with-the-left-button twin, the way Blender's "emulate 3 button mouse" does: Alt drags, Shift+Alt pans.            |
| Input profile   | The camera follows a mouse, a trackpad or a finger. Asking is not enough: the media query only says whether the primary pointer is coarse, which is a tablet or a phone, and a trackpad reports the same fine pointer as a mouse.                                                                     |
| Wheel reading   | The wheel says the rest: a mouse sends whole notches on one axis and reports lines or pages, a trackpad scrolls in fractions and often sideways, and a pinch arrives as a wheel with Ctrl. "Automatic" follows the last reading and falls back to the platform (Apple devices come with a trackpad). |
| Trackpad wheel  | Blender drives a trackpad with the wheel it has: two fingers orbit, Shift with them pans, and a pinch zooms. The schemes whose wheel zooms keep zooming on a trackpad, and a pinch always zooms.                                                                                                          |
| Hints           | The nav cube tooltip is built from the scheme and the device in hand: one gesture per line, spelled out ("средняя кнопка мыши", not "СКМ"), with the Alt key named the way the keyboard names it — ⌥ on an Apple keyboard. The menu reuses the same list per scheme.                                        |
| Rotation        | A turntable keeps the world up axis, so the horizon never tilts and the model always stands the way it was modelled. A trackball turns the model in its own frame, like a ball in the hand, and stores the tilt as a roll about the view direction. Both live under "Rotation", stored in `icancad.orbit`; Fit, the view presets and orienting to a sketch level the horizon again. |
| Choosing input  | The camera submenu pins the choice: automatic, mouse, trackpad or touch screen. It is stored under `icancad.input`, and the automatic row shows what the reading is at that moment.                                                                                                                       |
| Touch           | In the finger profile one finger orbits the point it holds, two fingers pan and pinch, and a tap still selects. The sketch editor keeps touches for itself while it is open: there they draw and drag geometry.                     |
| Choosing        | The nav cube context menu carries the list under "Camera controls". The menu stays open, so schemes can be tried one after another, and the tick follows the chosen one.                                                                   |
| Memory          | The choice is a preference in `uiStore`, stored under `icancad.cameraScheme`, and an id that is not in the table falls back to the default.                                                                                                 |
| Picking         | A press that is not a camera gesture still belongs to selection, a handle or a context menu; camera bindings are matched exactly, so Shift and no-Shift are different gestures.                                                             |

## Consequences

- A drag on a face now turns the model around that face and leaves it in place.
- The camera target drifts to where the user was looking, which is what "the
  view is about this part now" should mean; Fit still frames the whole model.
- A stored scheme that no longer exists, such as the removed ICanCAD one, falls
  back to Blender instead of leaving the camera without bindings.
- Adding a scheme is a row in the table: the renderer asks the table which
  gesture starts what and never reads a modifier for the camera itself.
- Tests can select a scheme through `localStorage` instead of dragging buttons.
