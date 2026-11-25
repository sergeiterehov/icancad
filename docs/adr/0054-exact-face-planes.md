# ADR 0054 — A face sketch takes the surface's own plane

Status: accepted

## Context

A sketch on a face is placed by fitting a plane to the face's triangles, and
every operation that starts on that sketch begins on the plane. The triangles
are float32, so the fitted plane sits a fraction of a micron **inside** the
solid: a top face at `12.9` is tessellated at `12.899999…`, and the sketch that
reports to sit on it is placed 0.4 µm under the surface.

Nothing showed while sketches were only drawn. A cut that starts on the face
does: its tool begins under the surface, so the boolean leaves a skin of that
thickness over its own hole, and the hole looks closed. The face is right there
in the B-rep — a plane with double-precision origin and direction — and only the
mesh copy of it was being used.

## Decisions

| Area            | Decision                                                                                                                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The kernel      | `TessellationResult` carries `facePlanes`, one entry per face in the same order as `faceIds`: the exact `origin` and `normal` of a flat face, read from its surface (`BRepAdaptor_Surface`), and `null` for a curved one.                                                                       |
| The check       | A plane is reported only when it lies where the face's own triangles are (a micron apart is a float32 vertex, millimetres apart is a surface in another placement). A refused plane is `null`, and the face keeps the fitted one.                                                               |
| The frame       | `faceFrameByName` / `faceFrameFromMesh` keep fitting the middle and the axes from the triangles, then take the normal from the exact plane and snap the middle onto it. The axes still follow the world axis the face is closest to, so a face keeps looking like the datum plane it resembles. |
| Curved faces    | They have no plane, so a sketch cannot be placed on them at all — the picker refuses them (`faces.frame` is only meaningful when the normal could be averaged).                                                                                                                                 |
| Everything else | Section planes and the quick handles read the same frame, so they inherit the exact plane without changes.                                                                                                                                                                                      |

## Consequences

- A sketch on a face sits exactly on the surface, and an operation that starts
  on it begins there: a cut opens its hole instead of leaving a skin, and it
  no longer depends on how finely the face happened to be tessellated.
- The plane is what the _document_ stores too: `plane.frame` written when the
  face is picked is exact, so a project saved today opens on the surface.
- Sketches authored before this change move by the tessellation error — under a
  micron — which is invisible and smaller than a solver tolerance.
- One `BRepAdaptor_Surface` per face per tessellation: microseconds each, and
  only while a shape is meshed.
