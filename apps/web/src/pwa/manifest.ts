import type { ManifestOptions } from 'vite-plugin-pwa';

/**
 * The install manifest, shared by vite.config.ts and the tests. Icon paths stay
 * relative to the manifest itself, so the same build installs from a domain
 * root and from the GitHub Pages project path.
 */
export const pwaManifest: Partial<ManifestOptions> = {
  name: 'ICanCAD',
  short_name: 'ICanCAD',
  description:
    'Parametric browser CAD for 3D printing: constrained sketches, solids and OpenCascade geometry, stored locally and ready offline.',
  lang: 'en',
  display: 'standalone',
  orientation: 'any',
  theme_color: '#111318',
  background_color: '#111318',
  categories: ['productivity', 'utilities'],
  icons: [
    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: 'pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
    { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
};
