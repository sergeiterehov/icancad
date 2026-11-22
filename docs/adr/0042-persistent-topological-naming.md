# ADR 0042 — Persistent topology names replace traversal indexes and pose lookup

Status: accepted (M5)

## Context

Faces and edges used to be addressed by their OCCT traversal index and by a
stored pose. A rebuild renumbers the traversal, so every reference had to find
its topology again geometrically: `faceLookup` matched a normal and a centroid,
`edgeLookup` matched start, middle, end, length and closure and had special
rules for closed rims and shortened arcs. Those rules are the hacks recorded in
ADR 0010, 0014, 0015, 0019, 0023 and 0037. They work until two faces look alike,
a face is split, or an unrelated edit changes the shape enough for the pose to
miss.

OCCT already knows where an operation moved its input topology. The build this
project uses exposes `Modified`, `Generated`, `IsRemoved`, the sweep makers'
`FirstShape`/`LastShape` and `ShapeUpgrade_UnifySameDomain.History_1()`.

## Decisions

| Area | Decision |
| --- | --- |
| Authority | The kernel creates and propagates names. The app passes semantic keys — the operation id, sketch curve keys, array stamp keys — and never invents a name from geometry. |
| Name | A name is `<scope>/<path>`. The scope is the operation (or array instance chain) that produced the topology; the path is its role inside that operation: `box/+z`, `extrude/side/<curveKey>`, `junction/<hash>`. |
| Creation | Primitives get semantic roles, STEP import gets `import/face/<i>`, an extrusion names its caps and the side of every profile curve, a revolve does the same, and a swept face names its sides after the edges it was swept from. |
| History | Booleans, shells, treatments, offsets and `unify` carry the names of untouched and modified faces. A face the operation creates gets a name from the source faces or edges it came from, or from its deterministic face key when the maker reports no origin. |
| Aliases | Every face keeps the names it historically represented. A merge of pieces that still share a source name keeps that source name as canonical, so a symmetric extrude does not rename a side face when its two halves meet; a split gives each piece a suffix and keeps the source name as an alias. A reference resolves by canonical name or by alias. |
| Split ambiguity | When one name still matches several pieces, the stored pose picks the piece the user pointed at. This is a tie-break between pieces of the same name, not a search for a similar face. |
| Edges | An edge is named from the stable lineage of the pair of faces that meet along it: `edge/<hash>`. The lineage drops a geometry-derived `/p/<key>` suffix, so a boundary change that renumbers a piece does not rename its edges. Aliases are built from every alias of both faces. A copy prefixes the whole edge name, so an array stamp never has to recompute the hash. |
| Copies | A 1:1 copy (array stamp, transform) prefixes every face and edge name with the instance scope and can re-own the copy. Names are never recomputed from the copied geometry. |
| Array of operations | A stamp scopes its chain as `<arrayId>/<stampKey>/…`. A reference to a body the chain creates is rebased by mapping the body id through `arrayBodyId` and prefixing the name with the same scope. References to bodies outside the chain stay as they are; the array repeats those changes as material deltas, as before. |
| References | `BodyFaceRef`, `BodyEdgeRef`, `SketchPlaneRef`, `SectionFaceRef`, `RevolveAxis`, `SketchProjection`, array paths and array rotation axes store names. `faceId`, `edgeId`, `topoId` and `entityRef.fingerprint` are gone. Poses remain as a cache for handles, drawing and the split tie-break. |
| Owners | The operation that created a face travels with the face. A face a later operation only trims or moves keeps its owner; faces an operation creates belong to it. The viewport reads owners from the tessellation. |
| Body ids | A body split off by a boolean is named after the smallest persistent face name it carries, so editing the operation does not renumber the pieces. |
| Schema | Schema version 9 writes stable names. Version 8 is migrated: its body face and edge references are marked `legacyPose`, and their stored pose is used only when their name is gone. Documents older than 8 cannot be read. |
| Verification | Kernel tests prove a symmetric extrude keeps its face and edge names across a width change and that array copies keep prefixed names; web tests prove a reference resolves after renumbering, an array stamp finds its own edge, and schema 8 references recover a moved edge or a shortened arc. |

## Consequences

- `faceLookup.ts` and `edgeLookup.ts` are deleted; `topologyLookup.ts` resolves by name and alias. Only a schema 8 reference whose name is gone falls back to its stored pose.
- ADR 0010, 0014, 0015, 0019, 0023 and 0037 lose their "persistent naming is M5" caveats.
- A reference to topology an operation really removed is an operation error, not a silent jump to another face.
- A reference to a split face means the whole face: every piece a name covers counts. A sketch on a face is placed at the middle of that whole face, and keeps the frame the last rebuild used when the name is briefly gone, so a preview or an operation being edited cannot slide it.
- Picking reads a name from the mesh the pick was made on. While an operation is open that mesh is the preview's input, not the published model, which belongs to the history before it.
- A schema 8 reference recovers the face or edge it pointed at by its exact pose; a shortened arc is matched by the circle it lies on. A reference written by version 9 resolves by name only.
- A face created by an operation whose maker reports no history still gets a deterministic name from its own key; it is stable for a replay but may not survive a parameter change that reshapes that particular face.
- Components and assemblies can reuse the same scope mechanism: an instance is another scope prefix around a chain of operations.
