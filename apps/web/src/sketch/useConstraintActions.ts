import type { SketchFeature } from '@icancad/model';
import { useCallback, useRef, useState } from 'react';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import {
  applyConstraintAction,
  ConstraintSolveError,
  type ConstraintAction,
} from './constraintModel';

/** Applies a constraint action to the sketch and reports solver failures. */
export function useApplyConstraintAction(feature: SketchFeature | undefined) {
  const apply = useDocumentStore((state) => state.apply);
  const showToast = useUiStore((state) => state.showToast);
  const [busy, setBusy] = useState(false);
  const locking = useRef(false);

  const run = useCallback(
    async (action: ConstraintAction) => {
      if (!feature || locking.current) return;
      locking.current = true;
      setBusy(true);
      try {
        const next = await applyConstraintAction(feature, action);
        apply({ type: 'feature/replace', feature: next });
      } catch (error) {
        showToast(
          error instanceof ConstraintSolveError && error.code === 'conflict'
            ? 'constraint.conflict'
            : 'constraint.failed',
          'error',
        );
      } finally {
        locking.current = false;
        setBusy(false);
      }
    },
    [feature, apply, showToast],
  );

  return { run, busy };
}
