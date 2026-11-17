import { activeModel, createProject, parseProject } from '@icancad/model';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { rebuildScene } from '../kernel/rebuild';
import { bootKernel } from '../kernel/client';
import { bootFormulaEngine } from '../formula/client';
import { useFormulaStore } from '../stores/formulaStore';
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
    // Waiting for the workers keeps the first downloads inside the offline
    // cache; the promises resolve at once in development. Python is a boot
    // dependency too: formulas are part of the model, not a lazy add-on.
    void whenOfflineCacheReady().then(() => {
      void bootKernel();
      void bootFormulaEngine().catch(() => undefined);
    });
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
  const resolution = useFormulaStore((state) => state.resolution);
  const pendingKey = useFormulaStore((state) => state.pendingKey);
  const formulaStatus = useFormulaStore((state) => state.status);
  // Folders are a view of the strip, not a build step (ADR 0032): grouping,
  // ungrouping and moving between folders must not reach the kernel, so the
  // rebuild follows what the operations say, not which folder shows them.
  const buildKey = useMemo(
    () => JSON.stringify(features, (key, value) => (key === 'groupId' ? undefined : value)),
    [features],
  );
  const historyEnd = useDocumentStore((state) => activeModel(state.project).historyEnd);
  // Selecting an operation previews it on top of the rolled-back state, so the
  // rebuild also has to follow the operation being edited.
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  const hydrated = useDocumentStore((state) => state.hydrated);
  const kernelStatus = useKernelStore((state) => state.status);
  const revision = resolution?.revision ?? 0;

  useEffect(() => {
    if (!hydrated || kernelStatus !== 'ready' || formulaStatus !== 'ready') return;
    if (!resolution || resolution.model.id !== activeModelId) return;
    if (pendingKey !== null) return;
    const timer = setTimeout(() => {
      void rebuildScene(resolution.model, t('status.rebuild'), {
        expressionErrors: new Set(Object.keys(resolution.errors)),
        drivenSketches: resolution.drivenSketches,
      }).catch(() => undefined);
    }, 50);
    return () => clearTimeout(timer);
  }, [
    activeModelId,
    buildKey,
    bodies,
    historyEnd,
    editingFeatureId,
    hydrated,
    kernelStatus,
    formulaStatus,
    pendingKey,
    revision,
    resolution,
    t,
  ]);
}
