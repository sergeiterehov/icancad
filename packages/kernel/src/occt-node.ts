import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { OcctBindings } from './occt-types';

/**
 * The published opencascade.js build is an ES module that references `__dirname`,
 * which Node's ESM loader rejects. Tests load the same artifact through a small CJS
 * shim so the browser and Node use identical binaries.
 */
export async function loadOcctNode(): Promise<OcctBindings> {
  const require = createRequire(import.meta.url);
  const gluePath = require.resolve('opencascade.js/dist/opencascade.wasm.js');
  const wasmPath = path.join(path.dirname(gluePath), 'opencascade.wasm.wasm');

  const source = readFileSync(gluePath, 'utf8').replace(
    /export default opencascade;?\s*$/,
    'module.exports = opencascade;',
  );
  const moduleShim: { exports: unknown } = { exports: {} };
  const evaluate = new Function(
    'module',
    'exports',
    'require',
    '__filename',
    '__dirname',
    source,
  ) as (...args: unknown[]) => void;
  evaluate(moduleShim, moduleShim.exports, require, gluePath, path.dirname(gluePath));

  const init = moduleShim.exports as (options: {
    wasmBinary: Uint8Array;
  }) => Promise<unknown>;
  return (await init({ wasmBinary: readFileSync(wasmPath) })) as OcctBindings;
}
