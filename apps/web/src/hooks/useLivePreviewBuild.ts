import {
  activeModel,
  type Feature,
  type Project,
  type Resolved,
  type ResolvedModel,
} from '@icancad/model';
import { useEffect } from 'react';
import { i18n } from '../i18n';
import { rebuildScene } from '../kernel/rebuild';
import { useDocumentStore } from '../stores/documentStore';
import { useFormulaStore } from '../stores/formulaStore';
import { useLiveEditStore } from '../stores/liveEditStore';

/**
 * How often the 3D preview of a dragged operation may be rebuilt. The kernel
 * runs in its own worker, but every build still has to be enqueued, tessellated
 * and drawn, and a drag produces a value faster than anybody can read it.
 */
const PREVIEW_REBUILD_MS = 120;

/**
 * Keeps the 3D preview of a dragged operation up with the pointer.
 *
 * The document is not touched during a gesture (ADR 0053), so the ordinary
 * rebuild never sees it. This watches the live copy instead and asks the kernel
 * for the same preview an open operation gets: the model up to the operation,
 * then the operation itself evaluated on top of it. The task queue keeps one
 * rebuild per key, so a newer request replaces the queued one and asks the
 * running one to stop — the queue never grows with the gesture's frames.
 */
export function useLivePreviewBuild(): void {
  useEffect(() => {
    let timer: number | null = null;
    let lastRun = 0;
    let running = false;
    let documentBefore: Project | null = null;

    const build = (feature: Feature | null) => {
      const model =
        useFormulaStore.getState().resolution?.model ??
        (activeModel(useDocumentStore.getState().project) as unknown as ResolvedModel);
      const features = feature
        ? model.features.map((candidate) =>
            candidate.id === feature.id ? (feature as unknown as Resolved<Feature>) : candidate,
          )
        : model.features;
      void rebuildScene({ ...model, features }, i18n.t('status.preview'), {
        // A live copy names itself; a cancelled gesture goes back to whatever
        // operation the document has open.
        previewFeatureId: feature ? feature.id : useDocumentStore.getState().editingFeatureId,
      }).catch(() => undefined);
    };

    const flush = () => {
      timer = null;
      lastRun = performance.now();
      const feature = useLiveEditStore.getState().feature;
      if (feature) build(feature);
    };

    /** Leading and trailing: build at once if the last one is old, else once. */
    const schedule = () => {
      const wait = PREVIEW_REBUILD_MS - (performance.now() - lastRun);
      if (wait <= 0) {
        if (timer === null) flush();
        return;
      }
      if (timer === null) timer = window.setTimeout(flush, wait);
    };

    const unsubscribe = useLiveEditStore.subscribe((state) => {
      const active = state.project !== null;
      if (active && !running) {
        running = true;
        documentBefore = useDocumentStore.getState().project;
        return;
      }
      if (!active && running) {
        running = false;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        // A cancelled gesture leaves its preview on screen: the document never
        // changed, so no ordinary rebuild would take it away.
        const unchanged = documentBefore === useDocumentStore.getState().project;
        documentBefore = null;
        if (unchanged) build(null);
        return;
      }
      // A sketch drag is drawn from the live entities already; only an
      // operation preview has to be rebuilt by the kernel.
      if (active && state.kind === 'feature') schedule();
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}
