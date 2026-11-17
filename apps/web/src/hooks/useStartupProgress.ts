import { activeModel } from '@icancad/model';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useFormulaStore } from '../stores/formulaStore';
import { useKernelStore } from '../stores/kernelStore';

/** Where the boot work ends on the single progress bar. */
const HYDRATION_END = 0.12;
const KERNEL_END = 0.68;
const FORMULA_END = 0.88;

export interface StartupProgress {
  stage: 'project' | 'kernel' | 'formulas' | 'model' | 'ready';
  message: string;
  /** Overall completion in 0..1; absent while the current work has no ratio. */
  progress?: number;
  /** The current stage has no measurable progress and needs a running bar. */
  busy: boolean;
}

/**
 * One progress line for the whole boot: restoring the document, streaming the
 * kernel, loading Python and, when the project has operations, the first
 * rebuild. Later formula work and rebuilds are not boot and must not cover the
 * viewport again.
 */
export function useStartupProgress(): StartupProgress {
  const { t } = useTranslation();
  const hydrated = useDocumentStore((state) => state.hydrated);
  const featureCount = useDocumentStore((state) => activeModel(state.project).features.length);
  const kernelStatus = useKernelStore((state) => state.status);
  const kernelRatio = useKernelStore((state) => state.ratio);
  const sceneVersion = useKernelStore((state) => state.sceneVersion);
  const formulaStatus = useFormulaStore((state) => state.status);

  if (!hydrated) {
    return { stage: 'project', message: t('status.openingProject'), busy: true };
  }
  if (kernelStatus === 'error' || formulaStatus === 'error') {
    return { stage: 'ready', message: '', busy: false };
  }
  if (kernelStatus !== 'ready') {
    return {
      stage: 'kernel',
      message: t('status.kernelLoading'),
      progress:
        kernelRatio === undefined
          ? HYDRATION_END
          : HYDRATION_END + (KERNEL_END - HYDRATION_END) * kernelRatio,
      busy: kernelRatio === undefined,
    };
  }
  if (formulaStatus !== 'ready') {
    return {
      stage: 'formulas',
      message: t('formula.loading'),
      progress: KERNEL_END,
      busy: true,
    };
  }
  // Only the first scene is boot. Later formula evaluations and rebuilds must
  // not cover the viewport again, so publishing any scene ends this stage.
  if (featureCount > 0 && sceneVersion === 0) {
    return {
      stage: 'model',
      message: t('status.preparingModel'),
      progress: FORMULA_END,
      busy: true,
    };
  }
  return { stage: 'ready', message: '', busy: false };
}
