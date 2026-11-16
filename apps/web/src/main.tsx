import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initI18n } from './i18n';
import { startPwa } from './pwa/updates';
import './styles.css';

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
