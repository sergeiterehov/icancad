import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'packages/formula/package.json'));
const source = path.dirname(require.resolve('pyodide/package.json'));
const target = path.join(root, 'apps/web/public/pyodide');

const files = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of files) {
  await cp(path.join(source, file), path.join(target, file));
}
console.log(`Copied ${files.length} Pyodide assets to ${path.relative(root, target)}`);
