# ICanCAD

Browser CAD for 3D printing. The long-term goal is a Figma-like parametric modeler with a linear feature history, OpenCascade (OCCT) B-rep geometry and Blender mesh import.

**Current status: M4 (modeling tool set).** The app shell, i18n, project/model document layer with undo/redo, IndexedDB autosave, `.icad` project files and the OCCT kernel pipeline are implemented. Modeling covers seven primitives, mesh import (STL/OBJ/PLY/GLB) with a source-unit setting, STEP import with product names and colours, a constrained sketcher, extrude/revolve with add/subtract/intersect, fillet/chamfer, shell/cavity, move/rotate/scale transforms, arrays, sections and STL/STEP export. The production build installs as a PWA and works offline once the kernel has been loaded. Persistent topological naming (M5) is implemented: faces and edges carry kernel-generated names through booleans, shells, treatments, imports and array stamps (ADR 0042). Mesh → solid conversion is still ahead; the feature backlog lives in [MEMO.md](MEMO.md).

## Quick start

```sh
corepack pnpm install
corepack pnpm dev
```

The first `dev`/`build` copies the OCCT WASM binary (about 63 MB) from `node_modules` into `apps/web/public/occt/`. It is served as a static asset and cached by the browser.

Open http://127.0.0.1:5173/, wait for the kernel status to become **Ready**, then create a test box. The box can be resized, undone, persisted, exported to `.icad` and imported back.

## Commands

| Command                    | What it does                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `corepack pnpm dev`        | Vite dev server with the kernel worker                                                                   |
| `corepack pnpm build`      | Typecheck and production build (copies OCCT WASM)                                                        |
| `corepack pnpm preview`    | Serve the production build, including the service worker                                                 |
| `corepack pnpm typecheck`  | TypeScript check for every workspace package                                                             |
| `corepack pnpm test`       | Vitest unit/integration tests (document model, sketch helpers, OCCT in Node, project files, i18n parity) |
| `corepack pnpm lint`       | ESLint flat config                                                                                       |
| `corepack pnpm e2e`        | Playwright smoke tests (Chromium)                                                                        |
| `corepack pnpm spike:occt` | Standalone OCCT capability/size/startup probe                                                            |

## Architecture

```
React UI (panels, inspector, timeline)      Three.js WebGL2 viewport
Zustand stores · command/undo · i18next
            │ typed RPC + transferables
            ▼
Kernel worker                               Sketch solver worker
OCCT WASM · shapes · tessellation           planegcs WASM
            │
            ▼
IO / mesh worker
STL/OBJ/PLY/GLB parsing; voxel remesh and decimation are still ahead
```

- **Kernel is authoritative.** Main thread never owns `TopoDS_Shape`; it receives typed arrays only.
- **Document is declarative.** `packages/model` holds the project's super-objects (models today, assemblies later), each with its own feature list, plus command validation and history checks. Geometry is rebuilt from features. References address persistent topology names, never traversal indexes (ADR 0042).
- **Tessellation respects OCCT face orientation**; triangle winding and normals are normalized for WebGL (`packages/kernel/src/engine.ts`).
- **Mesh import** parses STL/OBJ/PLY/GLB in the IO worker; an imported mesh becomes a body directly.
- **Section view** is view state, not history: multiple clip planes with stencil caps and screen-space hatching.
- **i18n** is English/Russian from the first commit; keys are typed and error codes are localized in the UI.
- **Python (later)** will use the same serializable command/feature layer; no API is frozen yet.

## Workspace layout

```
apps/web/                 Vite + React app, viewport, stores, i18n, persistence
packages/model/           Project/super-object/feature types, zod schemas, commands, history validation
packages/kernel/          OCCT bindings, engine, worker runtime, typed protocol, Node tests
packages/sketch/          Sketch entity tessellation and helpers; the planegcs solver runs in apps/web/src/sketch
scripts/copy-occt.mjs     Copies the OCCT WASM asset into the web app
docs/adr/                 Architecture decision records
```

## Progressive web app

The production build is installable and offline-capable. [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) generates `manifest.webmanifest`, the PNG icon set and a Workbox service worker; the app registers the worker itself in [apps/web/src/pwa/updates.ts](apps/web/src/pwa/updates.ts), because a reload has to save the open project first.

- **Install** — browsers that offer an install prompt show _Install app_ in the project menu. iOS has no prompt API; its install tags live in [apps/web/index.html](apps/web/index.html), and the same menu item explains _Share → Add to Home Screen_. The manifest icon paths are relative, so the build installs both at a domain root and under the GitHub Pages project path.
- **Offline** — the shell is precached during install: entry chunk, CSS, the three workers, the planegcs WASM and the icons. The 63 MB OCCT binary is not part of the install; the kernel caches it on first use under a content-hashed URL (`occt/opencascade.wasm.wasm?v=<sha256>`), so later starts need no network, a new OCCT build reaches the app, and an unchanged one is never downloaded twice. IndexedDB already holds the projects, so a reload without a network loses nothing.
- **Updates** — a new build waits instead of replacing the running one. The toast's _Reload_ button, or _Update ICanCAD_ in the project menu, flushes the project to IndexedDB and then activates the waiting worker. The page also asks for a new deployment every hour, since a modeling session outlives many deploys.
- **Theme colour** — the browser's window chrome follows the app theme through the `theme-color` meta tag.

The worker exists only in a production build: the dev server rewrites modules on every edit, and a cache in front of it would serve stale code. To try the PWA:

```sh
corepack pnpm build
corepack pnpm preview
```

Open http://127.0.0.1:4173/, let the kernel reach **Ready**, then switch the browser offline (DevTools → Network → Offline) and reload: the app must start and the kernel must load from the cache.

## Deployment

The production build is a static site in `apps/web/dist`; it includes the OCCT WASM, so the artifact is about 63 MB.

### GitHub Pages

`.github/workflows/deploy.yml` builds the site on every push to `main` (and on a manual run) and publishes it with the Pages artifact API. Pages must be enabled once for the repository with **Settings → Pages → Build and deployment → Source: GitHub Actions**; the workflow itself cannot do that, because `actions/configure-pages` needs a personal access token to switch Pages on.

The workflow takes the site path from `actions/configure-pages`, so a project site is served from `https://<owner>.github.io/<repo>/` without editing the config: `VITE_BASE` is set to that base path and [apps/web/vite.config.ts](apps/web/vite.config.ts) uses it as Vite's `base`. A local `pnpm build` keeps the domain root (`/`); pass `VITE_BASE=/icancad/` to reproduce the Pages build.

Pages serves the static files as they are: `.wasm` arrives with `application/wasm` and the JS chunks are content-hashed. `apps/web/public/occt/opencascade.wasm.wasm` keeps its name across builds, but the app requests it under a content hash, and the service worker keeps that response: a redeploy only downloads the 63 MB again when the binary itself changed.

### icancad.com

`.github/workflows/deploy-site.yml` builds the site for the domain root (`VITE_BASE=/`) and mirrors `apps/web/dist` over FTP on every push to `main` and on a manual run. The repository secrets `FTP_HOST`, `FTP_USERNAME` and `FTP_PASSWORD` hold the account; the workflow reads the password from the `LFTP_PASSWORD` environment variable, so it never appears in a command line or a log. The FTP account is chrooted to the directory the domain serves, so the build is uploaded to the account root (`/`); a manual run can name another directory. The upload uses `lftp mirror --reverse --delete`, so only new and changed files travel, and files the build no longer contains are removed from the host. The run ends by asking the domain for the uploaded build, so a site root that does not match the account fails the workflow instead of passing quietly.

[apps/web/public/.htaccess](apps/web/public/.htaccess) travels with the build and gives an Apache or LiteSpeed host the headers listed below. icancad.com answers with nginx, which does not read `.htaccess` — the `.wasm` MIME type already comes from its own table, while `.mjs` is served as `application/octet-stream`; the Pyodide loader is therefore copied under `.js` names — and the caching and COOP/COEP rules have to be set in the hosting panel if the site needs them. GitHub Pages ignores the file as well. Both deployments are independent: a failure of one leaves the other published.

### Any other static host

Serve `apps/web/dist` with:

- `Content-Type: application/wasm` for `.wasm`;
- long-lived immutable caching for `/assets/` and `/occt/opencascade.wasm.wasm` (asset names carry their content hash, and the kernel URL gets a `?v=` hash, so an update changes the URL);
- `no-cache` for `index.html`, the service worker and the web manifest, so an update is noticed;
- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (required for a future multi-threaded WASM build and harmless now).

On Apache and LiteSpeed, [apps/web/public/.htaccess](apps/web/public/.htaccess) already carries these rules. Vite dev server already sets the COOP/COEP headers.

## Third-party licenses

- OpenCascade.js / OCCT — LGPL-2.1 (with OCCT exception). The WASM is shipped as a separate, unmodified artifact.
- planegcs — LGPL-2.0-or-later.
- Three.js — MIT.
- Workbox — MIT. Its runtime is bundled into the generated service worker.

See [docs/adr/0001-foundation.md](docs/adr/0001-foundation.md) for the foundation decisions and [MEMO.md](MEMO.md) for the feature backlog.
