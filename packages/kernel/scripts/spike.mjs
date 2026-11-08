// OCCT capability spike: verifies bindings, measures startup and tessellation time.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const gluePath = require.resolve('opencascade.js/dist/opencascade.wasm.js');
const wasmPath = path.join(path.dirname(gluePath), 'opencascade.wasm.wasm');

const source = readFileSync(gluePath, 'utf8').replace(
  /export default opencascade;?\s*$/,
  'module.exports = opencascade;',
);
const moduleShim = { exports: {} };
const evaluate = new Function(
  'module',
  'exports',
  'require',
  '__filename',
  '__dirname',
  source,
);
evaluate(moduleShim, moduleShim.exports, require, gluePath, path.dirname(gluePath));

const t0 = performance.now();
const oc = await moduleShim.exports({ wasmBinary: readFileSync(wasmPath) });
console.log(`OCCT loaded in ${(performance.now() - t0).toFixed(0)} ms`);

const required = [
  'BRepBuilderAPI_Sewing',
  'ShapeFix_Shape',
  'BRepBuilderAPI_MakeSolid',
  'BRepOffsetAPI_MakeThickSolid',
  'BRepAlgoAPI_Section',
  'BRepProj_Projection',
  'STEPControl_Writer',
  'StlAPI_Writer',
  'BRepMesh_IncrementalMesh_2',
  'BRep_Tool',
];
for (const name of required) {
  console.log(`${name}: ${typeof oc[name] === 'undefined' ? 'MISSING' : 'ok'}`);
}

const boxShape = new oc.BRepPrimAPI_MakeBox_1(20, 10, 5).Shape();
const tMesh = performance.now();
new oc.BRepMesh_IncrementalMesh_2(boxShape, 0.1, false, 0.5, false);

const explorer = new oc.TopExp_Explorer_2(
  boxShape,
  oc.TopAbs_ShapeEnum.TopAbs_FACE,
  oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
);
let faces = 0;
let triangles = 0;
while (explorer.More()) {
  const face = oc.TopoDS.Face_1(explorer.Current());
  const location = new oc.TopLoc_Location_1();
  const handle = oc.BRep_Tool.Triangulation(face, location);
  if (handle) triangles += handle.get().NbTriangles();
  faces += 1;
  explorer.Next();
}
console.log(
  `Box: ${faces} faces, ${triangles} triangles, meshed in ${(performance.now() - tMesh).toFixed(0)} ms`,
);
