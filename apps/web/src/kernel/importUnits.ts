import { MILLIMETRES_PER_MESH_UNIT, type MeshUnit } from '@icancad/model';
import type { MeshStats } from '@icancad/io';

interface ImportScaleSource {
  unit: MeshUnit;
  scale: number;
  transform: { scale: number };
}

/** Millimetres per file unit, composed with the operation's own scale fields. */
export function importedMeshScale(feature: ImportScaleSource): number {
  const unit = MILLIMETRES_PER_MESH_UNIT[feature.unit] ?? 1;
  return unit * (feature.scale || 1) * (feature.transform.scale || 1);
}

/** Mesh statistics after a uniform scale; the caller supplies the new bounds. */
export function scaledMeshStats(
  stats: MeshStats,
  scale: number,
  bounds: MeshStats['bounds'],
): MeshStats {
  return {
    ...stats,
    bounds,
    volume: stats.volume * scale ** 3,
    surfaceArea: stats.surfaceArea * scale ** 2,
  };
}
