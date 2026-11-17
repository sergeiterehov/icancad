import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initI18n } from './i18n';
import { startPwa } from './pwa/updates';
import './styles.css';

/**
 * The workspace is a single full-screen surface: a browser pinch must never
 * zoom the page. A pinch over a sketch annotation still belongs to the
 * viewport, so it is forwarded to the canvas at the same place.
 */
function installPageZoomGuard(): void {
  const stopPageZoom = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const target = event.target;
    if (!(target instanceof Element) || target instanceof HTMLCanvasElement) return;
    const wrap = target.closest('.viewport-wrap');
    const canvas = wrap?.querySelector('canvas.viewport-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  window.addEventListener('wheel', stopPageZoom, { passive: false, capture: true });
  const stopGesture = (event: Event) => event.preventDefault();
  document.addEventListener('gesturestart', stopGesture, { passive: false });
  document.addEventListener('gesturechange', stopGesture, { passive: false });
}

installPageZoomGuard();

void initI18n().then(() => {
  // Install and update arrive from the browser, not from a click, so the worker
  // and its listeners are wired before the first render.
  startPwa();
  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
