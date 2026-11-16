import { activeModel, createProject, parseProject } from '@icancad/model';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { rebuildScene } from '../kernel/rebuild';
import { bootKernel } from '../kernel/client';
import { getSetting, loadProject, setSetting } from '../persistence/db';
import { queueProjectSave } from '../persistence/saveQueue';
import { whenOfflineCacheReady } from '../pwa/updates';

let hydration: Promise<void> | null = null;

async function hydrateProject(): Promise<void> {
  try {
    const lastProjectId = await getSetting('lastProjectId');
    const stored = lastProjectId ? await loadProject(lastProjectId) : null;
    const project = stored
      ? parseProject(stored, { modelName: i18n.t('model.defaultName') })
      : createProject(i18n.t('project.untitled'), i18n.t('model.defaultName'));
    await setSetting('lastProjectId', project.id);
    useDocumentStore.getState().hydrate(project);
  } catch {
    useDocumentStore
      .getState()
      .hydrate(createProject(i18n.t('project.untitled'), i18n.t('model.defaultName')));
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
    // Waiting for the worker keeps the first kernel download inside the offline
    // cache; the promise resolves at once in development.
    void whenOfflineCacheReady().then(() => bootKernel());
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
  const activeModelId = useDocumentStore((state) => state.project.activeSuperObjectId);
  const features = useDocumentStore((state) => activeModel(state.project).features);
  const bodies = useDocumentStore((state) => activeModel(state.project).bodies);
  const historyEnd = useDocumentStore((state) => activeModel(state.project).historyEnd);
  // Selecting an operation previews it on top of the rolled-back state, so the
  // rebuild also has to follow the operation being edited.
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  const hydrated = useDocumentStore((state) => state.hydrated);
  const kernelStatus = useKernelStore((state) => state.status);

  useEffect(() => {
    if (!hydrated || kernelStatus !== 'ready') return;
    const timer = setTimeout(() => {
      void rebuildScene(
        activeModel(useDocumentStore.getState().project),
        t('status.rebuild'),
      ).catch(() => undefined);
    }, 50);
    return () => clearTimeout(timer);
  }, [activeModelId, features, bodies, historyEnd, editingFeatureId, hydrated, kernelStatus, t]);
}
