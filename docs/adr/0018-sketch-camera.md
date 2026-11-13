# ADR 0018 — Sketch camera: align on entry, restore on exit

Status: accepted

## Context

Opening a sketch turns the camera to its plane and frames its content so the
user can draw. Leaving the sketch should bring back the 3D view the user had
before, otherwise every visit to a sketch loses the orientation they were
working in. Switching from one sketch to another while editing is not the same
as leaving and opening a sketch again: the view to return to is still the one
from before the first sketch of that editing session.

## Decisions

| Area          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reserved view | Entering a sketch stores the complete camera pose — target, distance, azimuth and polar — once per editing session. Switching sketches keeps it; only leaving the editor clears it.                                                                                                                                                                                                                                                                            |
| Entry         | The stored pose is captured after the rebuild at the sketch's timeline position is ready and before the first alignment. The camera then looks along the sketch normal and frames the sketch content; an empty sketch keeps the current zoom and only centres on its plane.                                                                                                                                                                                    |
| Switch        | Opening another sketch while editing aligns the camera to that sketch and leaves the reserved pose untouched. A switch is not an exit followed by an entry.                                                                                                                                                                                                                                                                                                    |
| Exit          | Finishing, closing or otherwise clearing the active sketch moves the camera back to the reserved pose in one transition. Manual "Orient to sketch" from the navigation cube is a deliberate view change and does not touch the reserved pose.                                                                                                                                                                                                                  |
| Body auto-fit | Bodies created after the edited sketch disappear while the timeline is rolled in front of it and come back on exit. A returning body is not a new body: the automatic fit only runs when the scene goes from empty to a body that has never been shown. Fitting during the exit would start a second transition from the middle of the restore; because a fit keeps the current orientation, the camera would freeze between the sketch and the reserved view. |
| Documentation | The rule is covered by end-to-end tests: aligning on entry, aligning on a switch, keeping the reserved pose across a switch and restoring it on exit, including when later bodies were hidden.                                                                                                                                                                                                                                                                 |

## Consequences

- A sketch visit never costs the user their 3D view.
- Rolling the timeline backwards and forwards does not refit the camera either, because the bodies have already been seen.
- Automation that adds bodies to an existing scene does not steal the camera; only the first body of an empty scene does.
