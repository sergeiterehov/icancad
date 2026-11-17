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
  const setDimensionEdit = useUiStore((state) => state.setSketchDimensionEdit);
  const [busy, setBusy] = useState(false);
  const locking = useRef(false);

  const run = useCallback(
    async (action: ConstraintAction) => {
      if (!feature || locking.current) return;
      locking.current = true;
      setBusy(true);
      try {
        const next = await applyConstraintAction(feature, action);
        if (next.feature !== feature) apply({ type: 'feature/replace', feature: next.feature });
        // A dimension is only worth having once its value is the one the user
        // means; the editor opens straight away instead of waiting for a
        // second click on the chip.
        if (next.editConstraintId) setDimensionEdit(next.editConstraintId);
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
    [feature, apply, setDimensionEdit, showToast],
  );

  return { run, busy };
}
