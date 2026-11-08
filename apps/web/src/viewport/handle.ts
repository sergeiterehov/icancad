export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

export interface ViewportHandle {
  fit: () => void;
  setView: (name: ViewName) => void;
}

let current: ViewportHandle | null = null;

export function registerViewport(handle: ViewportHandle | null): void {
  current = handle;
}

export function getViewport(): ViewportHandle | null {
  return current;
}
