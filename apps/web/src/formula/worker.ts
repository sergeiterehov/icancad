import { startFormulaWorker } from '@icancad/formula/worker-runtime';

const base = new URL(import.meta.env.BASE_URL, self.location.origin);
startFormulaWorker({ pyodideUrl: new URL('pyodide/', base).href });
