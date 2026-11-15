import { beforeEach, describe, expect, it } from 'vitest';
import { useKernelStore } from '../src/stores/kernelStore';

const emptyPreview = { featureId: 'feat_1', bodies: [], ghosts: [] };

describe('preview of the edited operation', () => {
  beforeEach(() => {
    useKernelStore.setState({ preview: null });
  });

  it('is dropped when the rebuild that should have replaced it fails', () => {
    useKernelStore.setState({ preview: emptyPreview });
    useKernelStore.getState().clearPreview();
    expect(useKernelStore.getState().preview).toBeNull();
  });

  it('leaves the state alone when there is nothing to drop', () => {
    const state = useKernelStore.getState();
    state.clearPreview();
    expect(useKernelStore.getState()).toBe(state);
  });

  it('only takes copies of the operation it belongs to', () => {
    useKernelStore.setState({ preview: emptyPreview });
    useKernelStore.getState().setPreviewGhosts('feat_other', []);
    expect(useKernelStore.getState().preview).toEqual(emptyPreview);
  });
});
