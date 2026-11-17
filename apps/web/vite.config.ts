import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './src/pwa/manifest.ts';

// GitHub Pages serves a project site under its repository path, so the base
// comes from the deployment (VITE_BASE=/icancad/); local builds keep the root.
const base = process.env.VITE_BASE ?? '/';

// The OCCT binary is a public file with a fixed name, copied in by predev and
// prebuild. Its URL carries a content hash, so the service worker can keep it
// without a network check and a new OCCT build still reaches an offline app.
const occtWasmPath = fileURLToPath(new URL('./public/occt/opencascade.wasm.wasm', import.meta.url));
const occtRevision = existsSync(occtWasmPath)
  ? createHash('sha256').update(readFileSync(occtWasmPath)).digest('hex').slice(0, 16)
  : 'unbuilt';

export default defineConfig({
  base,
  define: {
    __OCCT_WASM_REVISION__: JSON.stringify(occtRevision),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // The app registers the worker itself (src/pwa/updates.ts) because a
      // reload has to save the open project first.
      injectRegister: false,
      includeManifestIcons: false,
      manifest: pwaManifest,
      workbox: {
        // The first worker claims the page that just installed it, so the
        // kernel download of that visit still passes through the cache.
        clientsClaim: true,
        // Workers and the sketch solver are separate files of the shell, so an
        // offline tab needs them as much as the entry chunk.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,wasm,woff,woff2,zip,json}'],
        // The 63 MB kernel stays out of the install: it is cached on first use,
        // under the hashed URL above.
        globIgnores: ['occt/**'],
        // Pyodide ships a 9 MB wasm and a 2.5 MB stdlib archive of its own.
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/occt\/opencascade\.wasm\.wasm/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'icancad-occt',
              expiration: { maxEntries: 1 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  resolve: {
    dedupe: ['three'],
  },
  optimizeDeps: {
    exclude: ['opencascade.js'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 12000,
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
