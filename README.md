# ICanCAD

Browser CAD for 3D printing. The long-term goal is a Figma-like parametric modeler with a linear feature history, OpenCascade (OCCT) B-rep geometry and Blender mesh import.

**Current status: M0 (foundation).** The app shell, i18n, document model with undo/redo, IndexedDB autosave, `.icad` project files and the OCCT kernel pipeline are implemented. The only modeling feature so far is a box primitive used to validate the pipeline end to end.

## Quick start

```sh
corepack pnpm install
corepack pnpm dev
```

The first `dev`/`build` copies the OCCT WASM binary (about 63 MB) from `node_modules` into `apps/web/public/occt/`. It is served as a static asset and cached by the browser.

Open http://127.0.0.1:5173/, wait for the kernel status to become **Ready**, then create a test box. The box can be resized, undone, persisted, exported to `.icad` and imported back.

## Commands

| Command | What it does |
| --- | --- |
| `corepack pnpm dev` | Vite dev server with the kernel worker |
| `corepack pnpm build` | Typecheck and production build (copies OCCT WASM) |
| `corepack pnpm typecheck` | TypeScript check for every workspace package |
| `corepack pnpm test` | Vitest unit/integration tests (document model, sketch helpers, OCCT in Node, project files, i18n parity) |
| `corepack pnpm lint` | ESLint flat config |
| `corepack pnpm e2e` | Playwright smoke tests (Chromium) |
| `corepack pnpm spike:occt` | Standalone OCCT capability/size/startup probe |

## Architecture

```
React UI (panels, inspector, timeline)      Three.js WebGL2 viewport
Zustand stores · command/undo · i18next
            │ typed RPC + transferables
            ▼
Kernel worker pool                          Sketch solver worker
OCCT WASM · shapes · tessellation           planegcs WASM (M2)
            │
            ▼
IO / mesh worker
STL/OBJ/PLY/GLB parsing; voxel remesh and decimation arrive in M3
```

- **Kernel is authoritative.** Main thread never owns `TopoDS_Shape`; it receives typed arrays only.
- **Document is declarative.** `packages/model` holds the feature list, command validation and history checks. Geometry is rebuilt from features.
- **Tessellation respects OCCT face orientation**; triangle winding and normals are normalized for WebGL (`packages/kernel/src/engine.ts`).
- **Mesh import** parses STL/OBJ/PLY/GLB in the IO worker; an imported mesh becomes a body directly.
- **Section view** is view state, not history: multiple clip planes with stencil caps and screen-space hatching.
- **i18n** is English/Russian from the first commit; keys are typed and error codes are localized in the UI.
- **Python (later)** will use the same serializable command/feature layer; no API is frozen yet.

## Workspace layout

```
apps/web/                 Vite + React app, viewport, stores, i18n, persistence
packages/model/           Project/feature types, zod schemas, commands, history validation
packages/kernel/          OCCT bindings, engine, worker runtime, typed protocol, Node tests
packages/sketch/          Sketch entity tessellation and helpers (solver arrives in M2)
scripts/copy-occt.mjs     Copies the OCCT WASM asset into the web app
docs/adr/                 Architecture decision records
```

## Deployment

The production build is a static site in `apps/web/dist`; it includes the OCCT WASM, so the artifact is about 63 MB.

### GitHub Pages

`.github/workflows/deploy.yml` builds the site on every push to `main` (and on a manual run) and publishes it with the Pages artifact API. Pages must be enabled once for the repository with **Settings → Pages → Build and deployment → Source: GitHub Actions**; the workflow itself cannot do that, because `actions/configure-pages` needs a personal access token to switch Pages on.

The workflow takes the site path from `actions/configure-pages`, so a project site is served from `https://<owner>.github.io/<repo>/` without editing the config: `VITE_BASE` is set to that base path and [apps/web/vite.config.ts](apps/web/vite.config.ts) uses it as Vite's `base`. A local `pnpm build` keeps the domain root (`/`); pass `VITE_BASE=/icancad/` to reproduce the Pages build.

Pages serves the static files as they are: `.wasm` arrives with `application/wasm` and the JS chunks are content-hashed. `apps/web/public/occt/opencascade.wasm.wasm` keeps its name across builds, so a redeploy revalidates the 63 MB download; a CDN in front of Pages would be the next step if that matters.

### Any other static host

Serve `apps/web/dist` with:

- `Content-Type: application/wasm` for `.wasm`;
- long-lived immutable caching for `/occt/opencascade.wasm.wasm`;
- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (required for a future multi-threaded WASM build and harmless now).

Vite dev server already sets the COOP/COEP headers.

## Third-party licenses

- OpenCascade.js / OCCT — LGPL-2.1 (with OCCT exception). The WASM is shipped as a separate, unmodified artifact.
- planegcs (future) — LGPL-2.0-or-later.
- Three.js — MIT.

See `docs/adr/0001-foundation.md` for the decisions behind this foundation and the session plan for the full M0–M6 roadmap.
