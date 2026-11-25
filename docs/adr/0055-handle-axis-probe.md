# ADR 0055 — A handle's axis is measured over an arrow, not a millimetre

Status: accepted

## Context

A 3D handle is picked by projecting its shaft and asking how far the pointer is
from that line. The drag needs a direction and a scale: pixels per millimetre
along the handle's own axis. Both were read by probing one millimetre past the
handle's origin — the obvious measurement, and one that silently disappears.

Far enough out, a millimetre is less than half a pixel, the probe measures
nothing usable, and the code skipped the handle altogether. The arrow was still
drawn (its length follows the value in world units), so the picture said "you
can drag this" and the pointer said nothing at all. The limit was a model a
metre across on a normal screen — a size people zoom out to constantly.

## Decisions

| Area      | Decision                                                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The probe | The axis is measured over the length of a drawn idle arrow (48 px worth of world), not over one millimetre. Its projection stays tens of pixels long at any zoom, so pixels-per-millimetre stays a sane number. |
| The gate  | A handle is refused only when its axis has no direction on screen at all — it points at the camera and the probe covers less than a pixel. Zoom level is never a reason to refuse.                              |
| The drag  | The same pixels-per-millimetre drives the drag, so a handle far out moves a value slowly and exactly like one near.                                                                                             |

## Consequences

- Handles keep working however far the view is pulled back: the pointer cost of
  a drag does not change with zoom, because it never did — only the gate did.
- An axis pointing at the viewer stays ungrabbable, which is honest: it has no
  length on screen to drag along.
