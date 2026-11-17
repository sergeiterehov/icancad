import type { ResolvedModel } from '@icancad/model';

/**
 * What the kernel actually rebuilds. Folders are a view of the strip, not a
 * build step (ADR 0032), so `groupId` is dropped: grouping, ungrouping and
 * moving between folders leave the key untouched. The input also covers the
 * cursor, the operation being edited and the formula state the build reads, so
 * a real edit cannot be mistaken for an organisational one.
 */
export function rebuildInputKey(input: {
  modelId: string;
  model: ResolvedModel | null;
  historyEnd: string | null;
  editingFeatureId: string | null;
  expressionErrors: readonly string[];
  drivenSketches: readonly string[];
}): string {
  return JSON.stringify(
    {
      modelId: input.modelId,
      features: input.model?.features ?? null,
      historyEnd: input.historyEnd,
      editingFeatureId: input.editingFeatureId,
      errors: [...input.expressionErrors].sort(),
      driven: [...input.drivenSketches].sort(),
    },
    (key, value) => (key === 'groupId' ? undefined : value),
  );
}
