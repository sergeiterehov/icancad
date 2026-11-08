declare module 'three/examples/jsm/lines/LineMaterial.js' {
  import { Material } from 'three';
  import type { Color, Vector2 } from 'three';
  export class LineMaterial extends Material {
    constructor(parameters?: Record<string, unknown>);
    color: Color;
    linewidth: number;
    resolution: Vector2;
    opacity: number;
    transparent: boolean;
    worldUnits: boolean;
  }
}

declare module 'three/examples/jsm/lines/Line2.js' {
  import { Mesh } from 'three';
  import type { BufferGeometry } from 'three';
  import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
  export class Line2 extends Mesh<BufferGeometry, LineMaterial> {
    constructor(geometry?: BufferGeometry, material?: LineMaterial);
    computeLineDistances(): this;
  }
}

declare module 'three/examples/jsm/lines/LineGeometry.js' {
  import type { BufferGeometry } from 'three';
  export class LineGeometry extends BufferGeometry {
    setPositions(array: number[]): this;
  }
}
