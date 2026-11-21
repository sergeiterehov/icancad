# ADR 0040 — STEP import

Status: accepted

## Context

ADR 0038 added STEP export, so a part can leave the app with its B-rep, name
and colour. The other half of the MEMO item is the way back: a body exported
from Fusion, Onshape or FreeCAD has to open in ICanCAD as an editable solid.

No sample files were available when this was built, so the target is the common
case: one part document with one or more solid bodies, each carrying a product
name and optionally a colour. Assemblies, drawings, PMI and exotic encodings
are not required for the first pass.

The bundled OCCT 7.4 build already contains `STEPCAFControl_Reader`,
`TDocStd_Document`, `XCAFDoc_ShapeTool` and `XCAFDoc_ColorTool`. Two gaps shaped
the design: the binding does not expose the text of a
`TCollection_ExtendedString`, and `ReadFile` in this build refuses temporary
paths longer than ten characters.

## Decisions

| Area | Decision |
| --- | --- |
| Format | **STEP** (`.step`, `.stp`), read through `STEPCAFControl_Reader` with name and colour modes on. AP203 and AP214 files both go through the same reader; the writer still produces AP214 (ADR 0038). |
| Scope | Simple shapes only — the labels where `XCAFDoc_ShapeTool.IsSimpleShape` is true. An assembly is flattened into its parts; product hierarchy, instance names and assembly transforms beyond the shape's own location are not represented. Each simple shape becomes one body. |
| Storage | The original file is stored as an asset keyed by the feature id, exactly like an imported mesh. The `import-step` feature holds only `assetId`; a rebuild reads the bytes again, so the model stays deterministic and the file can be re-exported or inspected later. |
| Kernel API | `inspect-step` reads the file and returns `{ name, color }` per body before the document changes. `import-step` reads it again and builds the kernel shapes, returning one `{ shapeId, stats }` per body. Both use the `import` queue key so they never interleave with a rebuild. |
| Names | Read from the Part 21 `PRODUCT('...')` records in the file text, not from XCAF: `ToExtString` and `ToUTF8CString` are not bound. The parser decodes doubled quotes, `\X2\…\X0\` UTF-16 and `\X\hh`. Product order matched the simple-shape label order in every file produced by this app and the test fixtures. A missing name falls back to `Part N`. |
| Colours | `XCAFDoc_ColorTool.GetColor_4` with the surface colour, then the curve colour, then the tool's generic lookup. Channels are 0..1 and become `#rrggbb`. A body without a colour gets the next entry of the body palette in the store. |
| Units | The reader normalises lengths to millimetres from the file's `LENGTH_UNIT`, so an inch or metre file arrives in project units. This is OCCT's `xstep.cascade.unit` default of `MM`; the kernel tests cover millimetres, metres and inches. |
| Bodies | One solid body per imported shape, with id `featureId:solid-N`, kind `solid`, the parsed name and the resolved colour in the metadata. All bodies, metadata and the feature are applied in one undo step. |
| Selection | After a successful import the imported bodies are selected and no operation is left in edit mode. Nothing on an `import-step` feature is editable except its name, so an open editor would only hide the new bodies behind preview rows. |
| Failure | A file the kernel cannot read, or one with no simple shapes, shows an error toast and leaves the document untouched. The asset is saved only after `inspect-step` succeeds. |
| Temp files | The reader gets a short rotating name (`rN.stp`) in the wasm filesystem, which is removed in a `finally`. A longer name fails `ReadFile` even when the file exists. |
| UI | The project Import picker accepts `.step` and `.stp` next to the mesh formats. A STEP import shows "importing", then "imported" or "failed" toasts; the timeline shows the file name, the tree shows the product names. |

## Consequences

- A body modelled in Fusion, Onshape or FreeCAD opens as a real B-rep solid
  with its name and colour, and the rest of the modelling tool set (fillet,
  shell, booleans, export) works on it.
- STEP lengths arrive in project units: the reader uses the file's length unit
  and converts to millimetres. A file with a missing or malformed unit falls
  back to the reader's millimetre default.
- A product containing several solids becomes several bodies with the same
  product name. There is no way to keep them as one assembly node.
- Surface and sheet bodies are not filtered out: any simple shape becomes a
  body, so a surface part imports without a watertight solid.
- Names are parsed from Part 21 text, so a file that writes products in a
  different order than its shapes, or uses an encoding the parser does not
  know, falls back to `Part N`. A real custom binding for
  `TCollection_ExtendedString` would remove that dependency.
- The ten-character limit is a quirk of this OCCT build, not of STEP. Short
  temp names are the workaround; a newer binding can drop it.
