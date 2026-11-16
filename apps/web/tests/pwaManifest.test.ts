import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pwaManifest } from '../src/pwa/manifest';

const publicDir = new URL('../public/', import.meta.url);

/** Width and height from the PNG header, so a wrong export cannot pass. */
function pngSize(bytes: Buffer): string {
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('app manifest', () => {
  it('offers the icon sizes an install prompt requires', () => {
    const icons = pwaManifest.icons ?? [];
    const sizes = icons.flatMap((icon) => icon.sizes?.split(' ') ?? []);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('ships every PNG icon at the size it declares', () => {
    for (const icon of pwaManifest.icons ?? []) {
      if (icon.type !== 'image/png') continue;
      expect(pngSize(readFileSync(new URL(icon.src, publicDir))), icon.src).toBe(icon.sizes);
    }
  });
});
