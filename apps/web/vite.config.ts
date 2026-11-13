import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves a project site under its repository path, so the base
// comes from the deployment (VITE_BASE=/icancad/); local builds keep the root.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
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
