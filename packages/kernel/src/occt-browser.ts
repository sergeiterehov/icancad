import type { OcctBindings } from './occt-types';

export type LoadProgress = (loadedBytes: number, totalBytes: number) => void;

async function fetchBinary(url: string, onProgress?: LoadProgress): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load OCCT wasm (${response.status} ${response.statusText})`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function loadOcctBrowser(
  wasmUrl: string,
  onProgress?: LoadProgress,
): Promise<OcctBindings> {
  const { default: factory } = await import('opencascade.js/dist/opencascade.wasm.js');
  const wasmBinary = await fetchBinary(wasmUrl, onProgress);
  const module = await factory({ wasmBinary });
  return module as OcctBindings;
}
