import type { Feature, Resolved } from '@icancad/model';
import { useMemo } from 'react';
import { resolvedFeatureFor, useFormulaStore } from '../stores/formulaStore';

/** The resolved copy of a feature, re-read when the formula result changes. */
export function useResolvedFeature<T extends Feature>(feature: T): Resolved<T> | undefined {
  const revision = useFormulaStore((state) => state.resolution?.revision ?? 0);
  return useMemo(() => resolvedFeatureFor(feature), [feature, revision]);
}
