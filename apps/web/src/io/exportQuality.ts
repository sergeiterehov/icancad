import { DEFAULT_TESSELLATION_QUALITY, type TessellationQuality } from '@icancad/kernel';

export type ExportQualityId = 'draft' | 'standard' | 'fine';

export interface ExportQuality {
  id: ExportQualityId;
  /** Translation key of the label shown in the dialog. */
  labelKey: string;
  quality: TessellationQuality;
}

/**
 * Mesh quality offered before an STL export. The middle level is exactly what
 * the viewport uses, so a standard export matches what the user sees; the other
 * two trade detail for size.
 */
export const EXPORT_QUALITIES: readonly ExportQuality[] = [
  {
    id: 'draft',
    labelKey: 'project.qualityDraft',
    quality: { linearDeflection: 0.2, angularDeflection: 0.45 },
  },
  {
    id: 'standard',
    labelKey: 'project.qualityStandard',
    quality: DEFAULT_TESSELLATION_QUALITY,
  },
  {
    id: 'fine',
    labelKey: 'project.qualityFine',
    quality: { linearDeflection: 0.02, angularDeflection: 0.08 },
  },
];

export function exportQuality(id: ExportQualityId): ExportQuality {
  return EXPORT_QUALITIES.find((candidate) => candidate.id === id) ?? EXPORT_QUALITIES[1]!;
}
