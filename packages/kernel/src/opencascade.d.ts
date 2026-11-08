declare module 'opencascade.js/dist/opencascade.wasm.js' {
  interface OpenCascadeFactoryOptions {
    wasmBinary?: ArrayBuffer | Uint8Array;
    locateFile?: (path: string) => string;
  }

  const factory: (options?: OpenCascadeFactoryOptions) => Promise<unknown>;
  export default factory;
}
