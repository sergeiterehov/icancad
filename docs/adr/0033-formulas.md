# ADR 0033 — Formulas in parameters: Python expressions in place of numbers

Status: accepted

## Context

Every operation takes numbers: a box size, an extrude distance, a sketch
dimension. Real parts are driven by a few dimensions that repeat across the
model, and typing the same number into a dozen fields means every later change
is a hunt for the copies. Users asked for named variables and for expressions
that compute a value from them.

Two things made the decision wider than "parse an expression":

- the parameters already live inside the feature objects and the rebuild cache
  matches snapshots by object identity;
- a Python script mode is planned, and it should share one runtime instead of
  growing a second, incompatible expression system.

## Decision

### A parameter is a number or a formula, in the same field

`ParamValue = number | Formula`, where `Formula` is `{ formula: string }`. The
formula is stored exactly where the number was, so:

- no second map, no ids to keep in sync, no orphan cleanup;
- undo, autosave and `feature/replace` work unchanged;
- the document never points at a runtime-only entity.

Strings never become formulas: the marker is an object, so a text parameter that
happens to start with `=` stays text.

The user types `=width/2` into an ordinary numeric field; the leading `=`
switches the field to formula mode and is not part of the stored source.

### Collection is structural, not a registry walk

`collectFormulas(value, targetId)` walks any object and returns the formulas it
finds by the `Formula` marker. A new parameter needs no collector change, and a
future Form or Script object is collected by the same walk. The registry in
`parameters.ts` exists for the other direction: bounds, rounding and diagnostics
per path.

### One runtime, Pyodide in a worker

Formulas are Python expressions evaluated by Pyodide in a dedicated worker. The
sandbox is an AST allowlist: no imports, no attribute access on private names,
no calls outside a whitelisted set (`abs`, `min`, `max`, `round`, math
functions). Variables resolve first in dependency order, so a cycle is a
diagnostic instead of a stack overflow.

The same worker will later run scripts: a script is a longer source evaluated by
the same interpreter with the same environment. Nothing in the client protocol is
formula-specific — it takes sources and returns numbers and diagnostics.

Pyodide is a boot dependency, not a lazy add-on: the page shows its loading phase
next to the kernel's, and the offline cache carries the wasm, the stdlib archive
and the lock file.

### Resolution is a layer between the document and the rebuild

`useFormulaResolution` debounces the sources, asks the engine, applies bounds and
saves a `ResolvedModel` in a store. The rebuild reads that model and waits until
the resolution matches the current sources. Identity is preserved: a feature
whose resolved values did not change keeps its object, so the checkpoint cache
still matches.

A formula that fails does not block editing. The feature is reported with
`EXPRESSION_ERROR`, the rebuild stops in front of it, and the field shows the
diagnostic. A sketch keeps its last solved geometry and can still be opened:
the solver is paused until the broken constraint formula is fixed.

### Driven sketch dimensions are solved in the rebuild

Sketch constraints are parameters like any other. Because the document stores
the solved entities, a driven dimension needs a solve: the rebuild takes the
resolved constraints and runs the solver again, keeping projected geometry
derived. A conflict is a `CONSTRAINT_CONFLICT` on the sketch; the formula stays.

### Variables have a project and a model scope

`Project.variables` holds the values shared by every model; each `Model` has its
own `variables` list with the same shape: `{ id, name, type, source }`. Both are
edited in the right panel when nothing is selected: the model header opens its
variables, and the project context header below opens the project variables. `number` sources are Python
expressions, `string` sources are text. Names are Python identifiers (Cyrillic
included), unique across the project and its models, and not reserved.

Project variables resolve first. Model variables resolve afterwards and may read
both project and earlier model variables; a project expression never sees a
model variable. The worker evaluates each scope with only the names it is
allowed to read, so the dependency graph cannot cross the boundary. A rename is
one undo step: the worker tokenizes every source in the variable's scope and
rewrites only `NAME` tokens.

## Consequences

- The kernel and the editor only ever see numbers; formulas become values at the
  boundary. A resolved value that is missing is `NaN`, never a guess.
- A rebuild is delayed by the engine round trip. The debounce and the identity
  cache keep it to one evaluation per edit, and the delay is invisible next to
  the kernel work it precedes.
- A formula in a sketch starts a second solve of that sketch. Only sketches with
  driven constraints pay for it.
- Script support inherits the protocol, the sandbox and the diagnostics, but not
  the model schema: scripts are their own object when they arrive.

## Alternatives considered

- **A separate formulas map inside each operation.** Rejected: two places to
  read a parameter, invariants to enforce, and a collection pass that a field
  edit can forget.
- **A `CalculationUnit` wrapper.** Rejected: it adds a layer with no reader —
  the field already knows whether it holds a formula.
- **A hand-written expression parser.** Rejected: Python is the target language
  for scripts, and a second grammar would diverge from it.
- **Lazy-loading Pyodide.** Rejected: the first formula would stall on a 12 MB
  download, and the state would be hard to explain in the UI.
