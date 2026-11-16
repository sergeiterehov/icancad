import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../src/stores/uiStore';

/**
 * The layout follows the panels that are on screen. A panel unfolds for its
 * subject as well as by hand, so the wish to have it open and the fact of it
 * being there are two things, and the bars and the nav cube read the fact.
 */
describe('a dock on screen', () => {
  beforeEach(() => {
    useUiStore.setState({ leftDockOpen: true, rightDockOpen: true });
    useUiStore.setState({ leftDockShown: true, rightDockShown: true });
  });

  it('is a separate fact from the wish to have it open', () => {
    const store = useUiStore.getState();
    store.setRightDockOpen(false);
    // The operation the user selected unfolds the panel without touching the
    // wish, so the panel is shown while it is not "open".
    store.setRightDockShown(true);
    expect(useUiStore.getState().rightDockOpen).toBe(false);
    expect(useUiStore.getState().rightDockShown).toBe(true);
  });

  it('follows the panels of each side on its own', () => {
    const store = useUiStore.getState();
    store.setLeftDockShown(false);
    expect(useUiStore.getState().leftDockShown).toBe(false);
    expect(useUiStore.getState().rightDockShown).toBe(true);
  });

  it('leaves the rest of the panel state alone', () => {
    const store = useUiStore.getState();
    store.setLeftDockOpen(false);
    store.setLeftDockShown(false);
    expect(useUiStore.getState().leftDockOpen).toBe(false);
    // Showing or hiding a panel is not a preference: it does not fold it away.
    store.setLeftDockShown(true);
    expect(useUiStore.getState().leftDockOpen).toBe(false);
  });
});
