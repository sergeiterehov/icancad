import { DEFAULT_TESSELLATION_QUALITY } from '@icancad/kernel';
import { describe, expect, it } from 'vitest';
import { exportQuality, EXPORT_QUALITIES } from '../src/io/exportQuality';

describe('export mesh quality', () => {
  it('offers three levels and defaults the standard one to the viewport mesh', () => {
    expect(EXPORT_QUALITIES.map((quality) => quality.id)).toEqual(['draft', 'standard', 'fine']);
    expect(exportQuality('standard').quality).toEqual(DEFAULT_TESSELLATION_QUALITY);
  });

  it('gets finer from draft to fine', () => {
    const draft = exportQuality('draft').quality;
    const standard = exportQuality('standard').quality;
    const fine = exportQuality('fine').quality;
    expect(draft.linearDeflection).toBeGreaterThan(standard.linearDeflection);
    expect(standard.linearDeflection).toBeGreaterThan(fine.linearDeflection);
    expect(draft.angularDeflection).toBeGreaterThan(standard.angularDeflection);
    expect(standard.angularDeflection).toBeGreaterThan(fine.angularDeflection);
  });
});
