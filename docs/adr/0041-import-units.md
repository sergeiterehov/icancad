# ADR 0041 — Imported mesh units

Status: accepted

## Context

The model works in millimetres (ADR 0001), but an imported mesh file carries
positions with no unit attached. STL, OBJ and PLY have no unit field at all;
glTF is defined in metres, yet exporters regularly ignore that. A 20-unit cube
can mean 20 mm, 20 cm, 20 inches or 20 metres, and guessing from the size is
unsafe.

ADR 0040 put STEP import on the kernel, which already normalises lengths to
millimetres from the file's `LENGTH_UNIT`. Meshes do not have that luxury: the
unit has to come from the user.

## Decisions

| Area | Decision |
| --- | --- |
| Where the unit lives | The source unit is a parameter of the `import-mesh` operation (`unit`: `mm`, `cm`, `m`, `in`, `ft`), next to its placement and scale. The asset still holds the original bytes, untouched. |
| When it applies | During the rebuild. The parser returns the file coordinates; `transformImportedMesh` multiplies them by the unit factor and the operation's scale before producing the render mesh. Changing the unit is an ordinary parameter edit with undo and a new rebuild. |
| Factor | `MILLIMETRES_PER_MESH_UNIT` maps the unit to millimetres: 1, 10, 1000, 25.4, 304.8. It composes with both scale fields of the operation, so a manual scale keeps working. |
| Statistics | Meshes rebuilt with a new unit also get new bounds, volume and surface area. Volume scales by the cube of the factor and area by its square; the bounds come from the transformed positions. Without this the inspector would report the original file's numbers. |
| Default | Imports start at `mm`, because the app is a millimetre CAD tool and most printing/CAD exports already use it. The inspector opens on the new operation, so a different unit can be chosen immediately. |
| Formats | The same setting serves STL, OBJ, PLY and GLB. There is no automatic detection: the formats do not carry enough information, and bbox heuristics would silently change a valid small part into a large one. GLB's metre convention is not trusted, because exporters do not follow it consistently. |
| STEP | Left alone: the STEP reader converts the file's unit to millimetres itself (ADR 0040), so a STEP operation has no unit parameter. |
| Persistence | Project schema version 7 adds the field. Version 6 projects migrate with `unit = mm`, which matches how their meshes were already interpreted. |

## Consequences

- A file in inches can be imported correctly and corrected later without
  uploading it again.
- The rendered mesh and its statistics match the unit choice, and the same
  geometry feeds selection, sectioning and mesh export.
- Every rebuild pays one pass over the vertices, which the existing scale
  already did. Parsed meshes are still cached in their original units.
- A file with mixed units inside one document cannot be represented; the
  operation has one source unit. glTF node transforms are baked by the parser,
  and STEP assemblies are handled by the kernel reader.
- If the project ever supports a unit other than millimetres, the factor has to
  target `project.units` instead of a fixed millimetre constant, and the UI has
  to convert its displayed values as well.
