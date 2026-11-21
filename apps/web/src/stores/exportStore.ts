import { exportStlBinary } from '@icancad/io';
import { activeModel, bodiesInHistory, type BodyObject } from '@icancad/model';
import { create } from 'zustand';
import { i18n } from '../i18n';
import { downloadBlob } from '../io/download';
import { exportQuality, type ExportQualityId } from '../io/exportQuality';
import { meshesForExport, stepBodies, stepForExport } from '../kernel/export';
import { stepFileName, stlFileName } from '../persistence/projectFile';
import { useDocumentStore } from './documentStore';
import { useKernelStore } from './kernelStore';
import { directBodyIds } from './selection';
import { useUiStore } from './uiStore';

export type ExportFormat = 'stl' | 'step';
export type ExportScope = 'selected' | 'model';

interface StlExportRequest {
  bodyIds: string[];
  quality: ExportQualityId;
  /** A one-body export takes the body's name into the file name. */
  nameSingleBody: boolean;
}

interface ScopeQuestion {
  format: ExportFormat;
  selectedBodyIds: string[];
}

interface ExportState {
  /** Main menu's "selected or whole model" question, while it is open. */
  scope: ScopeQuestion | null;
  /** STL quality dialog, once the bodies to write are known. */
  stl: StlExportRequest | null;
  exporting: boolean;
  /** Opens the export flow from the project menu. */
  start: (format: ExportFormat) => void;
  /** Exports exactly these bodies; used by the object context menu. */
  requestStl: (bodyIds: readonly string[], nameSingleBody?: boolean) => void;
  requestStep: (bodyIds: readonly string[], nameSingleBody?: boolean) => Promise<void>;
  askScope: (format: ExportFormat, selectedBodyIds: string[]) => void;
  chooseScope: (scope: ExportScope) => Promise<void>;
  setQuality: (quality: ExportQualityId) => void;
  confirmStl: () => Promise<void>;
  cancel: () => void;
}

function toast(key: string, kind: 'info' | 'error' = 'info', params?: Record<string, unknown>) {
  useUiStore.getState().showToast(key, kind, params);
}

function historyBodies(): BodyObject[] {
  const document = useDocumentStore.getState();
  return bodiesInHistory(
    activeModel(document.project),
    useKernelStore.getState().consumedBodies,
  );
}

/** Bodies of a request in model order; ids that are gone are dropped. */
function bodiesById(bodyIds: readonly string[]): BodyObject[] {
  const wanted = new Set(bodyIds);
  return historyBodies().filter((body) => wanted.has(body.id));
}

/** Every body of the model, hidden ones included. */
export function allBodyIds(): string[] {
  return historyBodies().map((body) => body.id);
}

/** What an export has always used without a selection: the visible bodies. */
export function visibleBodyIds(): string[] {
  return historyBodies()
    .filter((body) => body.visible)
    .map((body) => body.id);
}

function exportFileName(
  format: ExportFormat,
  bodies: readonly BodyObject[],
  nameSingleBody: boolean,
): string {
  const document = useDocumentStore.getState();
  const model = activeModel(document.project);
  const bodyName = nameSingleBody && bodies.length === 1 ? bodies[0]?.name : undefined;
  return format === 'stl'
    ? stlFileName(document.project.name, model.name, bodyName)
    : stepFileName(document.project.name, model.name, bodyName);
}

export const useExportStore = create<ExportState>((set, get) => ({
  scope: null,
  stl: null,
  exporting: false,

  start: (format) => {
    if (get().exporting) return;
    const selected = directBodyIds(useDocumentStore.getState().selection);
    if (selected.length > 0) {
      get().askScope(format, selected);
      return;
    }
    if (format === 'stl') get().requestStl(visibleBodyIds(), false);
    else void get().requestStep(visibleBodyIds(), false);
  },

  askScope: (format, selectedBodyIds) => {
    set({ scope: { format, selectedBodyIds } });
  },

  chooseScope: async (scope) => {
    const question = get().scope;
    if (!question || get().exporting) return;
    set({ scope: null });
    const fromSelection = scope === 'selected';
    const bodyIds = fromSelection ? question.selectedBodyIds : allBodyIds();
    if (question.format === 'stl') get().requestStl(bodyIds, fromSelection);
    else await get().requestStep(bodyIds, fromSelection);
  },

  requestStl: (bodyIds, nameSingleBody = false) => {
    if (get().exporting) return;
    const bodies = bodiesById(bodyIds);
    const meshes = useKernelStore.getState().meshes;
    if (!bodies.some((body) => meshes[body.id])) {
      toast('toast.noGeometry', 'error');
      return;
    }
    set({
      scope: null,
      stl: { bodyIds: bodies.map((body) => body.id), quality: 'standard', nameSingleBody },
    });
  },

  requestStep: async (bodyIds, nameSingleBody = false) => {
    if (get().exporting) return;
    const bodies = bodiesById(bodyIds);
    const { bodies: exported, skipped } = stepBodies(
      bodies,
      useKernelStore.getState().bodyShapes,
    );
    if (exported.length === 0) {
      toast(skipped > 0 ? 'toast.stepNeedsSolids' : 'toast.noGeometry', 'error');
      return;
    }
    set({ exporting: true, scope: null, stl: null });
    try {
      const data = await stepForExport(exported, i18n.t('project.exportStep'));
      downloadBlob(
        new Blob([new Uint8Array(data)], { type: 'application/step' }),
        exportFileName('step', bodies, nameSingleBody),
      );
      if (skipped > 0) {
        toast('toast.stepExportedSkippedMeshes', 'info', { count: skipped });
      } else {
        toast('toast.stepExported');
      }
    } catch {
      toast('toast.stepExportFailed', 'error');
    } finally {
      set({ exporting: false });
    }
  },

  setQuality: (quality) => {
    set((state) => (state.stl ? { stl: { ...state.stl, quality } } : {}));
  },

  confirmStl: async () => {
    const request = get().stl;
    if (!request || get().exporting) return;
    const bodies = bodiesById(request.bodyIds);
    if (bodies.length === 0) {
      set({ stl: null });
      toast('toast.noGeometry', 'error');
      return;
    }
    set({ exporting: true });
    try {
      const meshes = await meshesForExport(
        request.bodyIds,
        exportQuality(request.quality).quality,
        i18n.t('project.exportStl'),
      );
      if (meshes.length === 0) {
        toast('toast.noGeometry', 'error');
        return;
      }
      downloadBlob(
        new Blob([new Uint8Array(exportStlBinary(meshes))], { type: 'model/stl' }),
        exportFileName('stl', bodies, request.nameSingleBody),
      );
      toast('toast.stlExported');
      set({ stl: null });
    } catch {
      toast('toast.stlExportFailed', 'error');
    } finally {
      set({ exporting: false });
    }
  },

  cancel: () => {
    if (get().exporting) return;
    set({ scope: null, stl: null });
  },
}));
