# ADR 0038 — STEP export

Status: accepted

## Context

The app could export a project archive and binary STL only. STL carries
triangles and nothing else: no names, no colours, no B-rep. A part sent to a
shop, opened in another CAD system, or re-imported for a later operation loses
everything the model knows about itself. The MEMO asks for a CAD interchange
format, names and colours included, and notes that STEP is the expected answer.

OCCT already ships the pieces in the bundled 7.4 build: `STEPCAFControl_Writer`,
`TDocStd_Document`, `XCAFDoc_ShapeTool`, `XCAFDoc_ColorTool` and
`TDataStd_Name`. A prototype against the real wasm produced one AP214 file with
two bodies, each keeping its `PRODUCT` name and its `COLOUR_RGB`.

## Decisions

| Area | Decision |
| --- | --- |
| Format | **STEP AP214** (`AUTOMOTIVE_DESIGN`). It is the default of the OCCT writer, keeps B-rep solids, product names, colours and assembly structure, and is accepted by mainstream CAD/CAM. AP242 is the modern successor but less universal; it can become a switch later. IGES was rejected (surface oriented, weak names/colours), as were 3MF and glTF (printing and visual formats). |
| Scope | Export in this pass. STEP import stays part of the same MEMO item but needs a new B-rep import feature and a name-reading path: the bundled binding exposes colours, but not the text of a `TCollection_ExtendedString`. |
| Source | The selected bodies, or every visible body when nothing is selected — the same rule as STL export. Selection wins even for hidden objects. |
| Bodies | Each body is one top-level shape of an XCAF document, added with `AddShape(shape, false, true)`. The body's tree name becomes `TDataStd_Name`, and its colour a generic `XCAFDoc_Color` from the `#rrggbb` in the metadata. Non-ASCII names keep their UTF-8 bytes (`TCollection_ExtendedString_2(name, false)`), so a Cyrillic name survives. |
| Meshes | Imported meshes have no B-rep and are skipped; when some were skipped the success toast says how many. If no solid is exportable, the export fails with the usual "nothing to export" error. |
| File | One `.step` file, written in mm, named `project - model.step` like the STL export. The writer writes through the Emscripten filesystem under a unique name; the worker reads the bytes and deletes the file. |
| Kernel API | A new `export-step` request carries `{ shapeId, name, color }` per body and returns the file bytes. It runs under the existing `export` queue key, so it never interleaves with a rebuild. |
| UI | The project menu's Export submenu gains a STEP item, with the selected count when bodies are selected. There is no quality dialog: the writer uses the B-rep as it is. |

## Consequences

- A part can leave the app as a real solid with its name and colour, and open in
  a CAM or CAD tool unchanged.
- STEP export depends on the kernel being ready and the body shapes being built;
  an export attempted before that reports that there is nothing to export.
- STEP import is still ahead. When it arrives, `STEPCAFControl_Reader` can give
  the colours; the names need either a small custom binding for
  `TCollection_ExtendedString` text or a Part 21 product-name pass.
- The OCCT writer prints transfer statistics to the worker console; this is
  harmless but visible when debugging the kernel.
