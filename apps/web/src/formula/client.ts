import { FormulaEngineClient } from '@icancad/formula';
import { useFormulaStore } from '../stores/formulaStore';

let engine: FormulaEngineClient | null = null;

export function getFormulaEngine(): FormulaEngineClient {
  if (!engine) {
    engine = new FormulaEngineClient(
      () =>
        new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
          name: 'icancad-formula',
        }),
    );
    engine.onStatus = (event) => useFormulaStore.getState().handleStatus(event);
  }
  return engine;
}

export function bootFormulaEngine(): Promise<void> {
  return getFormulaEngine().boot();
}

export function resetFormulaEngine(): void {
  engine?.terminate();
  engine = null;
}
