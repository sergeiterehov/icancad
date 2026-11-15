# ADR 0030 — The dark cockpit: colour means attention

Status: accepted

## Context

The interface shows a lot at once: a model, an operation history, a kernel
status, a rail of tools and a panel of settings. When everything is tinted with a
meaning of its own, nothing stands out, and a user looking for the one thing that
is wrong has to read the whole screen.

A cockpit is lit for the opposite reason: the dials that are fine are dark, and
the one lamp that is on is the one that matters.

## Decisions

| Area | Decision |
| ---- | -------- |
| Principle | Colour is a signal, not decoration. If something glows, it is asking for attention; everything that is fine stays muted. |
| Normal states | A state that needs nothing from the user is drawn in the ordinary muted colour of its control, on the ordinary background, with no accent of its own. A ready kernel is a muted check, not a green one. |
| Attention | Only two things are allowed to call attention: a failure (danger colour, always paired with an icon or text) and an action in progress (a spinner, which is movement rather than colour). |
| Hover and selection | Hover and selection keep their own accents (ADR 0017): they answer the pointer, they do not report a state. |
| New states | A new indicator starts muted. It gets a colour only when there is a reason for the user to look at it, and that reason is written down next to the rule. |

## Consequences

- Indicators report by shape and text first; colour is the second channel, not
  the first.
- A status that is fine is invisible until it is looked at, which is the point:
  the eye lands on the exception.
- Colourful affordances that used to mark "all good" (green checks, tinted
  success rows) are removed rather than reused.
