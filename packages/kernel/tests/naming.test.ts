import { beforeAll, describe, expect, it } from 'vitest';
import { KernelEngine } from '../src/engine';
import { loadOcctNode } from '../src/occt-node';

const rectangle = (x: number, y: number, width: number, height: number) => ({
  curves: [
    { type: 'line' as const, x1: x, y1: y, x2: x + width, y2: y },
    { type: 'line' as const, x1: x + width, y1: y, x2: x + width, y2: y + height },
    { type: 'line' as const, x1: x + width, y1: y + height, x2: x, y2: y + height },
    { type: 'line' as const, x1: x, y1: y + height, x2: x, y2: y },
  ],
  keys: ['bottom', 'right', 'top', 'left'],
});


const complexKeys = [
  'entity_d60d0b8130de456e9593',
  'entity_6b8c397dd20f46ee9d4c',
  'entity_b011badc34e24fd9bb3a',
  'entity_d8fe8535566847b69f8b',
  'entity_88b6f8e014084befa1a9',
  'entity_52c56e105bf049fe9240',
  'entity_adee39d6c30f4b449dd0',
  'entity_33decff342b54eabbd3a',
];

/** A base with a post: the symmetric extrude fuses two prisms and unifies them. */
function complexProfile(width: number) {
  const right = 57.32603178227458;
  return {
    curves: [
      { type: 'line' as const, x1: -width, y1: 0, x2: -width, y2: -5 },
      { type: 'line' as const, x1: -width, y1: -5, x2: right, y2: -5 },
      { type: 'line' as const, x1: right, y1: -5, x2: right, y2: 0 },
      { type: 'line' as const, x1: right, y1: 0, x2: 5, y2: 0 },
      { type: 'line' as const, x1: 5, y1: 0, x2: 5, y2: 82.29785952068544 },
      { type: 'line' as const, x1: 5, y1: 82.29785952068544, x2: 0, y2: 82.29785952068544 },
      { type: 'line' as const, x1: 0, y1: 82.29785952068544, x2: 0, y2: 0 },
      { type: 'line' as const, x1: 0, y1: 0, x2: -width, y2: 0 },
    ],
    keys: complexKeys,
  };
}

describe('persistent topology names', () => {
  const engine = new KernelEngine(() => loadOcctNode());

  beforeAll(async () => {
    await engine.init();
  });

  it('names the faces of a primitive by their role', () => {
    engine.makeBox({ shapeId: 'named-box', dx: 10, dy: 10, dz: 10, name: 'feat_box' });
    const mesh = engine.tessellate('named-box');
    expect(mesh.faceNames).toHaveLength(6);
    expect(new Set(mesh.faceNames).size).toBe(6);
    for (const name of mesh.faceNames!) expect(name.startsWith('feat_box/')).toBe(true);
    expect(mesh.faceNames).toEqual(
      expect.arrayContaining([
        'feat_box/+x',
        'feat_box/-x',
        'feat_box/+y',
        'feat_box/-y',
        'feat_box/+z',
        'feat_box/-z',
      ]),
    );
    expect(mesh.faceOwners?.every((owner) => owner === 'feat_box')).toBe(true);
  });

  it('names tessellated edges by the faces they join', () => {
    engine.makeBox({ shapeId: 'named-box-edges', dx: 10, dy: 10, dz: 10, name: 'feat_box' });
    const mesh = engine.tessellate('named-box-edges');
    expect(mesh.edges).toHaveLength(12);
    expect(new Set(mesh.edges!.map((edge) => edge.name)).size).toBe(12);
    for (const edge of mesh.edges!) expect(edge.name).toMatch(/\/edge\//);
  });

  it('names the caps and sides of an extrusion from the profile keys', () => {
    engine.makePrism({
      shapeId: 'named-prism',
      name: 'feat_ex',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      regions: [{ key: 'region-1', outer: rectangle(0, 0, 20, 10), holes: [] }],
      distances: [5],
    });
    const mesh = engine.tessellate('named-prism');
    expect(mesh.faceOwners?.every((owner) => owner === 'feat_ex')).toBe(true);
    expect(mesh.faceNames).toEqual(
      expect.arrayContaining([
        'feat_ex/r-region-1/cap/start',
        'feat_ex/r-region-1/cap/end',
        'feat_ex/r-region-1/side/bottom',
        'feat_ex/r-region-1/side/right',
        'feat_ex/r-region-1/side/top',
        'feat_ex/r-region-1/side/left',
      ]),
    );
  });

  it('keeps a face name when a later cut renumbers the body', () => {
    const build = (shapeId: string, height: number) => {
      engine.makeBox({ shapeId, dx: 20, dy: 10, dz: height, name: 'feat_base' });
      engine.makeBox({
        shapeId: `${shapeId}-tool`,
        dx: 4,
        dy: 20,
        dz: 20,
        at: [8, -5, -5],
        name: 'feat_tool',
      });
      engine.booleanShape({
        shapeId: `${shapeId}-cut`,
        name: 'feat_cut',
        baseShapeId: shapeId,
        toolShapeId: `${shapeId}-tool`,
        op: 'cut',
      });
      return engine.tessellate(`${shapeId}-cut`);
    };
    const first = build('cut-a', 10);
    const second = build('cut-b', 30);
    const firstNames = new Set(first.faceNames);
    const secondNames = new Set(second.faceNames);
    const firstAliases = new Set(first.faceAliases!.flat());
    const secondAliases = new Set(second.faceAliases!.flat());
    // The bottom face is split by the cut into two pieces in both builds, but
    // every piece still answers to the name the box gave it, even though the
    // height and the face traversal changed.
    expect(firstAliases.has('feat_base/-z')).toBe(true);
    expect(secondAliases.has('feat_base/-z')).toBe(true);
    // The face the cut does not touch at all keeps its canonical name.
    expect(firstNames.has('feat_base/+x')).toBe(true);
    expect(secondNames.has('feat_base/+x')).toBe(true);
    // The walls the cut leaves are the tool's surfaces, so they carry the
    // tool's names in the result instead of losing their identity.
    expect([...secondNames].some((name) => name.startsWith('tool/feat_tool/'))).toBe(true);
  });

  it('keeps names through a symmetric extrude that fuses and unifies', () => {
    const build = (shapeId: string, width: number) => {
      engine.makePrism({
        shapeId,
        name: 'feat_base',
        origin: [0, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        regions: [{ key: 'face_base', outer: complexProfile(width), holes: [] }],
        distances: [-20, 20],
      });
      return engine.tessellate(shapeId);
    };
    const wide = build('complex-wide', 30.63168943941933);
    const narrow = build('complex-narrow', 20);
    expect(wide.faceNames).toHaveLength(10);
    expect(narrow.faceNames).toHaveLength(10);
    // The fuse splits every side face and the unify merges the halves again.
    // The merge has to keep the profile name, not replace it with a hash of the
    // pieces, or an edge reference on the body would move with the width.
    expect(wide.faceNames).toEqual(narrow.faceNames);
    expect(wide.faceNames!.some((name) => name.includes('/new/'))).toBe(false);
    expect(
      wide.faceAliases!.flat().some((name) => name.endsWith('/side/entity_6b8c397dd20f46ee9d4c')),
    ).toBe(true);
    expect(wide.edges!.map((edge) => edge.name)).toEqual(
      narrow.edges!.map((edge) => edge.name),
    );
  });

  it('re-owns a boolean result and keeps every name unique', () => {
    engine.makeBox({ shapeId: 'bool-base', dx: 20, dy: 20, dz: 20, name: 'feat_base' });
    engine.makeBox({
      shapeId: 'bool-tool',
      dx: 6,
      dy: 30,
      dz: 30,
      at: [7, -5, -5],
      name: 'feat_tool',
    });
    engine.booleanAll({
      shapeId: 'bool-result',
      name: 'feat_cut',
      baseShapeId: 'bool-base',
      tools: [{ sourceShapeId: 'bool-tool', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }],
      op: 'cut',
      reown: true,
    });
    const mesh = engine.tessellate('bool-result');
    expect(new Set(mesh.faceNames).size).toBe(mesh.faceNames!.length);
    expect(mesh.faceOwners?.every((owner) => owner === 'feat_cut')).toBe(true);
    expect(mesh.faceNames!.some((name) => name.startsWith('feat_base/'))).toBe(true);
    expect(mesh.faceNames!.some((name) => name.startsWith('feat_tool/'))).toBe(true);
  });

  it('keeps the trimmed faces and names the surface a treatment creates', () => {
    engine.makeBox({ shapeId: 'treat-box', dx: 10, dy: 10, dz: 10, name: 'feat_box' });
    const mesh = engine.tessellate('treat-box');
    const edge = mesh.edges![0]!;
    engine.treatEdges({
      shapeId: 'treat-result',
      name: 'feat_treat',
      sourceShapeId: 'treat-box',
      kind: 'fillet',
      faceIds: [],
      edgeIds: [edge.id],
      size: 2,
    });
    const result = engine.tessellate('treat-result');
    expect(result.faceNames).toHaveLength(7);
    expect(result.faceNames!.filter((name) => name.startsWith('feat_box/'))).toHaveLength(6);
    expect(result.faceNames!.filter((name) => name.startsWith('feat_treat/treat/'))).toHaveLength(1);
  });

  it('names the cavity of a shell and keeps those names when the body changes', () => {
    const hollow = (shapeId: string, height: number) => {
      engine.makeBox({ shapeId, dx: 20, dy: 20, dz: height, name: 'feat_box' });
      engine.shell({
        shapeId: `${shapeId}-shell`,
        sourceShapeId: shapeId,
        name: 'feat_shell',
        removeFaceIds: [],
        thickness: 2,
        offset: 0,
        direction: 'inward',
      });
      return engine.tessellate(`${shapeId}-shell`);
    };
    const first = hollow('shell-a', 20);
    const second = hollow('shell-b', 30);
    expect(first.faceNames).toHaveLength(12);
    expect(second.faceNames).toHaveLength(12);
    // The outside is still the box's; only the cavity belongs to the shell.
    expect(first.faceNames!.filter((name) => name.startsWith('feat_box/'))).toHaveLength(6);
    const cavity = first.faceNames!.filter((name) => name.startsWith('feat_shell/'));
    expect(cavity).toHaveLength(6);
    expect(first.faceOwners).toEqual(first.faceNames!.map((name) => (name.startsWith('feat_box/') ? 'feat_box' : 'feat_shell')));
    // The cavity faces keep their names even though the body and its face
    // traversal changed; no cavity face is named after its position.
    expect(new Set(second.faceNames!.filter((name) => name.startsWith('feat_shell/')))).toEqual(
      new Set(cavity),
    );
  });

  it('prefixes every name of an array copy', () => {
    engine.makeBox({ shapeId: 'copy-source', dx: 10, dy: 10, dz: 10, name: 'feat_box' });
    engine.transformShape({
      shapeId: 'copy-result',
      sourceShapeId: 'copy-source',
      matrix: [1, 0, 0, 30, 0, 1, 0, 0, 0, 0, 1, 0],
      nameScope: 'feat_array/2',
      owner: 'feat_array',
    });
    const mesh = engine.tessellate('copy-result');
    expect(mesh.faceNames).toHaveLength(6);
    for (const name of mesh.faceNames!) expect(name.startsWith('feat_array/2/feat_box/')).toBe(true);
    expect(mesh.faceOwners?.every((owner) => owner === 'feat_array')).toBe(true);
    for (const edge of mesh.edges!) expect(edge.name!.startsWith('feat_array/2/')).toBe(true);
  });
});
