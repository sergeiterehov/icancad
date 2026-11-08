import { createProject, parseProject } from '@icancad/model';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { rebuildScene } from '../kernel/rebuild';
import { bootKernel } from '../kernel/client';
import { getSetting, loadProject, setSetting } from '../persistence/db';
import { queueProjectSave } from '../persistence/saveQueue';

let hydration: Promise<void> | null = null;

async function hydrateProject(): Promise<void> {
  try {
    const lastProjectId = await getSetting('lastProjectId');
    const stored = lastProjectId ? await loadProject(lastProjectId) : null;
    const project = stored ? parseProject(stored) : createProject();
    await setSetting('lastProjectId', project.id);
    useDocumentStore.getState().hydrate(project);
  } catch {
    useDocumentStore.getState().hydrate(createProject());
  }
}

export function useHydrateProject(): void {
  useEffect(() => {
    if (!hydration) hydration = hydrateProject();
    void hydration;
  }, []);
}

export function useKernelBoot(): void {
  useEffect(() => {
    void bootKernel();
  }, []);
}

export function useAutosave(): void {
  const project = useDocumentStore((state) => state.project);
  const hydrated = useDocumentStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    useDocumentStore.getState().setSaveState('saving');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        await queueProjectSave(project);
        await setSetting('lastProjectId', project.id);
        if (!cancelled) useDocumentStore.getState().setSaveState('saved');
      } catch {
        if (!cancelled) useDocumentStore.getState().setSaveState('error');
      }
    }, 650);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, hydrated]);
}

export function useRebuildScene(): void {
  const { t } = useTranslation();
  const features = useDocumentStore((state) => state.project.features);
  const bodies = useDocumentStore((state) => state.project.bodies);
  const historyEnd = useDocumentStore((state) => state.project.historyEnd);
  const hydrated = useDocumentStore((state) => state.hydrated);
  const kernelStatus = useKernelStore((state) => state.status);

  useEffect(() => {
    if (!hydrated || kernelStatus !== 'ready') return;
    const timer = setTimeout(() => {
      void rebuildScene(useDocumentStore.getState().project, t('status.rebuild')).catch(
        () => undefined,
      );
    }, 50);
    return () => clearTimeout(timer);
  }, [features, bodies, historyEnd, hydrated, kernelStatus, t]);
}
