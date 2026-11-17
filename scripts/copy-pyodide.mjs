import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'packages/formula/package.json'));
const source = path.dirname(require.resolve('pyodide/package.json'));
const target = path.join(root, 'apps/web/public/pyodide');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

// The static host serves `.mjs` as application/octet-stream, which a browser
// refuses to import as a module. Keep the runtime under `.js` names instead;
// the loader only needs its own worker module renamed inside the boot file.
const loader = await readFile(path.join(source, 'pyodide.mjs'), 'utf8');
await writeFile(
  path.join(target, 'pyodide.js'),
  loader.replaceAll('pyodide.asm.mjs', 'pyodide.asm.js'),
);
await cp(path.join(source, 'pyodide.asm.mjs'), path.join(target, 'pyodide.asm.js'));

for (const file of ['pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await cp(path.join(source, file), path.join(target, file));
}
console.log('Copied 5 Pyodide assets to apps/web/public/pyodide');
