import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const kernelRequire = createRequire(path.join(root, 'packages/kernel/package.json'));
const occtDir = path.dirname(kernelRequire.resolve('opencascade.js/package.json'));
const source = path.join(occtDir, 'dist', 'opencascade.wasm.wasm');
const targetDir = path.join(root, 'apps/web/public/occt');
const target = path.join(targetDir, 'opencascade.wasm.wasm');

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

const sizeMb = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`[occt] copied opencascade.wasm.wasm (${sizeMb} MB) -> apps/web/public/occt/`);
