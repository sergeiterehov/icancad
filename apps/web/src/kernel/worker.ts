import { startKernelWorker } from '@icancad/kernel/worker-runtime';

const wasmUrl = new URL(
  `${import.meta.env.BASE_URL}occt/opencascade.wasm.wasm`,
  self.location.origin,
).href;

startKernelWorker({ wasmUrl });
