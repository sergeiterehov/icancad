# ADR 0001 — Foundation architecture

Status: accepted (M0)

## Context

ICANCad targets browser-based modeling for 3D printing. The critical path is importing Blender meshes, converting them into solids, and applying engineering operations (cuts, wall thickness, screw holes, ribs). It also needs a full 2D sketcher, multi-body extrude/cut, section views with hatching, sketching on faces and projection of body geometry.

## Decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| Geometry kernel | OCCT via `opencascade.js` 1.1.1 (OCCT 7.4.0p1), in Web Workers | True B-rep: sewing/healing, solid creation, shell, fillet, section curves, projection, STEP |
| Kernel access | Custom typed RPC protocol with transferables; no OCCT objects on the main thread | Large buffers must not be structured-cloned; UI must stay responsive |
| Tessellation | `BRepMesh_IncrementalMesh`, per-face triangulation, face orientation respected | Correct winding/normals for WebGL culling and lighting |
| Mesh → solid (M3) | Auto: watertight → sew/heal; otherwise voxel remesh → decimate → sew/heal; report fidelity | Blender toy meshes are frequently non-watertight |
| Sketch solver (M2) | planegcs WASM (`@salusoft89/planegcs`) in a dedicated worker | Battle-tested FreeCAD constraint solver with the required constraint set |
| UI | React 19 + TypeScript + Vite, Radix/Tailwind primitives, Figma-like tokens | Fast iteration, accessible primitives, compact CAD UI |
| Viewport | Imperative Three.js WebGL2, custom ortho orbit camera | Full control over stencil caps, picking and large meshes; WebGPU later |
| State | Zustand + Immer; feature commands validated in `packages/model` | Small, testable document layer; undo/redo via snapshots |
| Document | Linear feature timeline, rollback marker, dependency validation | Matches Fusion/Onshape mental model |
| Body | Container of one or more solids | A boolean cut can split a body |
| Section view | View state, multiple clip planes, stencil caps + hatch shader | Fusion-like cut appearance with exact silhouettes, no history pollution |
| Persistence | IndexedDB autosave + `.icad` ZIP (document JSON + asset blobs) | No backend on the critical path |
| Units | millimetres internally, 1e-4 mm modeling tolerance | 3D printing domain |
| i18n | i18next + react-i18next, en/ru, browser locale detection, typed keys | Localization is mandatory from the first commit |
| Export | Binary STL + STEP (mm) | STL for printing, STEP for engineering interchange |
| Testing | Vitest, golden geometry tests running OCCT in Node, Playwright e2e | The kernel artifact works in Node via a small CJS shim |
| Python | Deferred; keep commands/features serializable and transport-agnostic | Pyodide can reuse the same kernel API later |

## Consequences

- OCCT WASM is large (about 63 MB uncompressed). It is lazy-loaded in a worker with a progress UI and cached by the browser; a trimmed custom build is a later optimization.
- Faceted B-rep conversion needs decimation limits, fidelity reporting and clear failure messages because shell/fillet operations on dense triangle soups are fragile.
- Persistent topological naming is a first-class subsystem, not an afterthought; M5 delivers ID propagation via OCCT operation history plus geometric fingerprint fallback.
- WebGL2 is the baseline; WebGPU remains a future backend, not a dependency of the core design.
