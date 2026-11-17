import type { TessellationResult } from '@icancad/kernel';
import type { PrimitiveFeature, Resolved } from '@icancad/model';
import * as THREE from 'three';

/**
 * A cheap mesh for the primitive delta shown while its settings are open. It
 * mirrors the kernel shape closely enough for feedback and never touches the
 * kernel, so dragging a handle only regenerates this geometry.
 */
const previewCache = new WeakMap<Resolved<PrimitiveFeature>, TessellationResult>();

export function primitivePreviewMesh(feature: Resolved<PrimitiveFeature>): TessellationResult {
  const cached = previewCache.get(feature);
  if (cached) return cached;
  const geometry = buildGeometry(feature);
  const mesh = tessellationFromGeometry(geometry);
  geometry.dispose();
  previewCache.set(feature, mesh);
  return mesh;
}

function buildGeometry(feature: Resolved<PrimitiveFeature>): THREE.BufferGeometry {
  const [x, y, z] = feature.transform.translation;
  switch (feature.kind) {
    case 'box': {
      const { dx, dy, dz } = feature.params;
      const geometry = new THREE.BoxGeometry(dx, dy, dz);
      // A box grows from its corner, like the kernel maker.
      geometry.translate(x + dx / 2, y + dy / 2, z + dz / 2);
      return geometry;
    }
    case 'sphere': {
      const geometry = new THREE.SphereGeometry(feature.params.radius, 32, 20);
      geometry.translate(x, y, z);
      return geometry;
    }
    case 'cylinder': {
      const geometry = new THREE.CylinderGeometry(
        feature.params.radius,
        feature.params.radius,
        feature.params.height,
        48,
        1,
        false,
      );
      geometry.rotateX(Math.PI / 2);
      geometry.translate(x, y, z + feature.params.height / 2);
      return geometry;
    }
    case 'cone': {
      const geometry = new THREE.CylinderGeometry(
        feature.params.topRadius,
        feature.params.bottomRadius,
        feature.params.height,
        48,
        1,
        false,
      );
      geometry.rotateX(Math.PI / 2);
      geometry.translate(x, y, z + feature.params.height / 2);
      return geometry;
    }
    case 'torus': {
      const geometry = new THREE.TorusGeometry(
        feature.params.majorRadius,
        feature.params.tubeRadius,
        16,
        64,
      );
      geometry.translate(x, y, z);
      return geometry;
    }
    case 'pyramid':
      return pyramidGeometry(feature);
    case 'capsule': {
      const geometry = new THREE.CapsuleGeometry(
        feature.params.radius,
        feature.params.height,
        8,
        24,
      );
      geometry.rotateX(Math.PI / 2);
      geometry.translate(x, y, z + feature.params.height / 2);
      return geometry;
    }
  }
}

function pyramidGeometry(
  feature: Extract<Resolved<PrimitiveFeature>, { kind: 'pyramid' }>,
): THREE.BufferGeometry {
  const [x, y, z] = feature.transform.translation;
  const { sides, radius, height } = feature.params;
  const base: Array<[number, number, number]> = [];
  for (let side = 0; side < sides; side += 1) {
    // The first vertex sits half a step from +X, so +X points at an edge
    // centre exactly like the kernel geometry.
    const angle = Math.PI / sides + (Math.PI * 2 * side) / sides;
    base.push([x + radius * Math.cos(angle), y + radius * Math.sin(angle), z]);
  }
  const center: [number, number, number] = [x, y, z];
  const apex: [number, number, number] = [x, y, z + height];
  const positions: number[] = [];
  const triangle = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
  ) => {
    positions.push(...a, ...b, ...c);
  };
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    triangle(center, base[next]!, base[side]!);
    triangle(base[side]!, base[next]!, apex);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function tessellationFromGeometry(geometry: THREE.BufferGeometry): TessellationResult {
  geometry.computeBoundingBox();
  const positions = new Float32Array(geometry.getAttribute('position').array);
  const normals = new Float32Array(geometry.getAttribute('normal').array);
  const index = geometry.getIndex();
  const vertexCount = positions.length / 3;
  const indices = index
    ? Uint32Array.from(index.array)
    : Uint32Array.from({ length: vertexCount }, (_, value) => value);
  const box = geometry.boundingBox ?? new THREE.Box3();
  return {
    positions,
    normals,
    indices,
    faceIds: new Uint32Array(indices.length / 3),
    triangleCount: indices.length / 3,
    vertexCount,
    bbox: {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
  };
}
