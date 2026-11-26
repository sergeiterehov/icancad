# ADR 0059 — Sketch clipboard

Status: accepted

## Context

`MEMO.md` asks for a clipboard: "Возможность копировать и вставлять выбранные объекты. Должно работать через системный буфер, чтобы копировать между разными вкладками и браузерами. Для начала сделаем копирование геометрии в рамках скеча."

The awkward parts are not the copy itself. A body is a *result* of operations, so copying a body would mean copying operations, and the note leaves that to a proper Clone operation. Sketch geometry, on the other hand, is plain data: points, lines, arcs, ellipses and Beziers in the sketch's own plane. It is the one object whose copy is unambiguous.

The second awkward part is the paste: where does the geometry land, and what does the user see before it lands. The note answers that too — the geometry follows the pointer as a purple ghost, a click places it, and a finger that cannot hover places it with its tap.

## Decisions

| Area | Decision |
| --- | --- |
| Scope | Sketch geometry only. Bodies are copied by a Clone operation later; an operation-level clipboard was considered and left out, because pasting a whole operation is a different act with its own questions (which inputs come along, what to do when they are missing). |
| Format | Plain JSON text: `{ kind: 'icancad.sketch-geometry', version: 1, entities }`, geometry in the sketch's own coordinates. The system clipboard carries it, so a copy travels between tabs, browsers and machines. `sketchClipboardSchema` lives in `packages/model/src/schemas.ts` and validates with the very schema a project file is read with: anything else on the clipboard parses to `null` instead of becoming geometry. |
| What is copied | The entities the selection names. A point key (`<entity>#<pointIndex>`) copies its whole curve: a corner is not geometry on its own. The origin and the axes are never copied — they exist in every sketch already. Construction curves keep their flag. |
| Projections | A projected curve is copied as the ordinary geometry it is drawn as: the payload carries no link to the body it came from, so what lands is a plain curve that no longer follows its source. That is what the note asks for ("Проекционная геометрия копируется сразу как обычная"). |
| Not copied | Constraints, dimensions and the reference annotations of the copied curves. They name entities that stay behind, and a paste is a placement, not a second parametric definition. The first version therefore copies shape, not relations. |
| Ids | Every paste writes fresh entity ids, so a copy can land in the sketch it was taken from. The ids are fixed when the paste is armed, so the ghost the user sees and the geometry the click commits are the same objects. A Shift run arms a fresh set after every copy — each copy is an object of its own, never one id written twice. |
| The grip | The centre of the copied bounds is the point that follows the pointer: a shape drags as one, so its middle is where a hand expects to hold it. |
| The paste preview | The geometry follows a pointer that can hover, drawn in the selection accent (purple) because it is exactly what the click will select. No magnet: nothing is being drawn, so nothing is snapped — and a previewed alignment the commit could not keep would be a lie. Nothing is written to the sketch until the click; Escape, a tool switch or leaving the sketch drops the ghost. |
| A finger | A pointer that cannot hover (a finger, a pen) gets no preview: the next tap on the editor is the place, and the geometry lands there. The hint line says so while the paste is armed. |
| A run of pastes | A click with **Shift** held places the copy and leaves the paste armed, so several copies land one click after another — the ghost stays under the pointer between clicks. The selection is everything the run has placed, not just the last copy, so a run of five can be moved, deleted or constrained as one set. A plain click ends the run and leaves that accumulated set selected. |
| The context menu | A right-click on geometry offers Copy and Paste; a right-click on empty space offers Paste alone. The place is read when the menu opens, not when an item is picked, so a paste from the menu lands where the menu was opened and with **no preview**: the pointer has already said where. |
| Keys | `Cmd`/`Ctrl`+`C` copies the selection and `Cmd`/`Ctrl`+`V` arms a paste. The physical key is read (`shortcutLetter`), so the shortcuts work on a non-Latin layout. With nothing to copy the key stays the browser's own. |
| One edit | A paste is one `feature/replace`: one history step, one rebuild. The pasted geometry becomes the selection and the old one is dropped, so the next step starts from what just arrived. A run of pastes is one step per copy, and the selection grows with each of them. |
| System clipboard and its fallback | `writeSketchClipboard` puts the text on the system clipboard and in `localStorage['icancad.clipboard.sketch']`. `readText` is asked first; a browser that refuses or never answers (the read is capped at 800 ms) falls back to the local copy. Text this app did not write is refused rather than replaced by the local copy — the user's clipboard is the user's. |

## Consequences

- Copy in one tab and paste in another (or in another browser) works with no server: the geometry is the message.
- The clipboard never carries a constraint, so a pasted rectangle is four lines. Relations must be re-applied, or the geometry is placed as drawn.
- A version this build does not know parses to `null`, so an older tab cannot paste a newer payload by accident.
- `apps/web/src/clipboard/payload.ts` is pure (build, parse, anchor, place) and covered by `apps/web/tests/sketchClipboard.test.ts`; `apps/web/tests/e2e/sketchClipboard.spec.ts` drives the shortcuts, the ghost, Escape and the context menu.
- Still open, in order: copying the constraints wholly inside the selection (so a copy stays parametric), and the body clipboard — the Clone operation the memo points at.
