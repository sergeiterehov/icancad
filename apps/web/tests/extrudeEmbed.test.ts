import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@icancad/model';
import { addEmbedFor, UNION_EMBED } from '../src/kernel/embed';
import { cubeMesh } from './cubeMesh';

const cube = { body: cubeMesh(20) };
const onTopFace: Vec3[] = [
  [5, 20, 5],
  [15, 20, 15],
];

describe('union embed', () => {
  it('reaches behind a face the tool stands on', () => {
    // A boss on the +Y face extrudes outwards: behind the plane is the cube.
    expect(addEmbedFor(onTopFace, [0, 1, 0], cube)).toBe(UNION_EMBED);
  });

  it('does not reach behind a sweep that already goes into the body', () => {
    // The same plane, but the sweep points into the cube. Reaching behind the
    // plane would push the tool's cap 0.01 out of the face and leave a step.
    expect(addEmbedFor(onTopFace, [0, -1, 0], cube)).toBe(0);
  });

  it('leaves a tool floating away from every body unembedded', () => {
    expect(addEmbedFor([[5, 30, 5]], [0, 1, 0], cube)).toBe(0);
  });
});
