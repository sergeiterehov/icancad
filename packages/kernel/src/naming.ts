/**
 * Persistent names of a body's topology (ADR 0042).
 *
 * A name is `<scope>/<path>`: the scope says which instance of an operation
 * produced the topology, the path says which face or edge it is inside that
 * instance. Copies made by an array prefix the whole name with the instance
 * scope, so a repeated operation can find the edges of its own copy.
 *
 * Names are produced by the kernel because OCCT is the only place that knows
 * how an operation moved its input topology. The app passes semantic keys
 * (operation ids, sketch curve keys, array stamps) and never invents a name
 * from geometry.
 */

/** A body's face names, aliases and owners, in face traversal order. */
export interface ShapeNames {
  /** Canonical name of every face, aligned with the kernel's face order. */
  faces: string[];
  /** Every historical name a face still answers to, including its canonical one. */
  aliases: string[][];
  /** Id of the operation that owns each face. */
  owners: string[];
  /** Edge names by tessellation edge id, filled once the shape is tessellated. */
  edges?: Record<string, string>;
  /** Every historical name an edge answers to, by tessellation edge id. */
  edgeAliases?: Record<string, string[]>;
}

/** A name a result face inherits, with the operation that owned it. */
export interface NameContribution {
  name: string;
  aliases: readonly string[];
  owner: string;
}

export interface PropagateNamesOptions {
  /** Number of faces in the result shape, in traversal order. */
  faceCount: number;
  /** Result face index -> the faces it was made from. */
  inherited: ReadonlyMap<number, readonly NameContribution[]>;
  /** Result face index -> deterministic key used to tell equal siblings apart. */
  faceKeys: readonly string[];
  /** Result face index -> path of a face the operation creates, e.g. `treat/<edge>`. */
  created?: ReadonlyMap<number, string>;
  /** Scope of the operation that produced the result. */
  scope: string;
  /** Owner recorded on faces the operation creates. */
  owner: string;
  /** Record `owner` on every face, as a boolean does with the body it rebuilds. */
  reown?: boolean;
}

/** Two independent FNV-1a hashes, short enough to read inside a name. */
export function stableNameHash(...values: string[]): string {
  const key = values.join('\u0001');
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second ^ code, 16777619) >>> 0;
  }
  return `${first.toString(36)}${second.toString(36)}`;
}

/** Puts a name into the instance scope of the operation that produced it. */
export function scoped(scope: string, path: string): string {
  return `${scope}/${path}`;
}

/** Prefixes a name with an instance scope: an array copy of another scope. */
export function prefixScope(prefix: string, name: string): string {
  return `${prefix}/${name}`;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function contributionAliases(contribution: NameContribution): string[] {
  return unique([contribution.name, ...contribution.aliases]);
}

/** Whether a path was derived from a face key rather than a semantic role. */
function generatedPath(path: string): boolean {
  const parts = path.split('/');
  return parts.includes('new') || parts.includes('merge') || parts.includes('p');
}

/**
 * The most stable name a face still answers to. A face a boolean split keeps
 * the name of the face it came from as an alias; that name survives a parameter
 * change, while the `/p/<key>` piece suffix does not. Edges are derived from
 * this name so an edge reference does not move when a sibling piece is
 * renumbered.
 */
export function stableFacePath(name: string, aliases: readonly string[]): string {
  const candidates = unique([name, ...aliases]);
  candidates.sort((left, right) => {
    const generated = Number(generatedPath(left)) - Number(generatedPath(right));
    if (generated !== 0) return generated;
    const segments = left.split('/').length - right.split('/').length;
    if (segments !== 0) return segments;
    const length = left.length - right.length;
    if (length !== 0) return length;
    return left.localeCompare(right);
  });
  return candidates[0] ?? name;
}

/** The aliases every one of the faces still answers to. */
function commonAliases(groups: ReadonlyArray<readonly string[]>): string[] {
  if (groups.length === 0) return [];
  return groups[0]!.filter((alias) => groups.every((group) => group.includes(alias)));
}

/**
 * Names the faces of a shape from what each face was made of.
 *
 * One source keeps its name; several sources merge under a name derived from
 * all of them; a face the operation creates gets the path the caller gives it.
 * When one source becomes several faces, each piece keeps the source name as an
 * alias and gets a suffix that depends only on its own deterministic key.
 */
export function propagateNames(options: PropagateNamesOptions): ShapeNames {
  const { faceCount, inherited, faceKeys, created, scope, owner, reown } = options;
  const faces: string[] = [];
  const aliases: string[][] = [];
  const owners: string[] = [];

  for (let index = 0; index < faceCount; index += 1) {
    const sources = inherited.get(index) ?? [];
    const byName = new Map<string, NameContribution>();
    for (const source of sources) {
      if (!byName.has(source.name)) byName.set(source.name, source);
    }
    const contributors = [...byName.values()];
    if (contributors.length === 1) {
      const source = contributors[0]!;
      faces.push(source.name);
      aliases.push(contributionAliases(source));
      owners.push(reown ? owner : source.owner);
      continue;
    }
    if (contributors.length > 1) {
      const names = contributors.map((source) => source.name).sort();
      const merged = scoped(scope, `merge/${stableNameHash(...names)}`);
      const all = contributors.map(contributionAliases);
      // Pieces of one face that a boolean split and a later merge joined again
      // share the name of the face they came from. That name survives edits;
      // the merge hash would change with the geometry of the pieces.
      const stable = commonAliases(all).sort((left, right) => {
        const generated = Number(generatedPath(left)) - Number(generatedPath(right));
        if (generated !== 0) return generated;
        return left.split('/').length - right.split('/').length || left.length - right.length;
      })[0];
      faces.push(stable ?? merged);
      aliases.push(unique([...all.flat(), merged]));
      owners.push(reown ? owner : contributors[0]!.owner);
      continue;
    }
    const path = created?.get(index);
    faces.push(scoped(scope, path ?? `new/${stableNameHash(faceKeys[index] ?? String(index))}`));
    aliases.push([]);
    owners.push(owner);
    // A created face answers to its canonical name too; the loop below fills
    // the alias list once the canonical name is final.
  }

  // One source that became several faces gets a suffix per piece. The key is
  // deterministic, so replaying the same operation names the same pieces.
  const groups = new Map<string, number[]>();
  for (let index = 0; index < faces.length; index += 1) {
    const name = faces[index]!;
    const group = groups.get(name);
    if (group) group.push(index);
    else groups.set(name, [index]);
  }
  for (const [name, indices] of groups) {
    if (indices.length < 2) continue;
    for (const index of indices) {
      faces[index] = `${name}/p/${stableNameHash(faceKeys[index] ?? String(index))}`;
      aliases[index] = unique([...(aliases[index] ?? []), name]);
    }
  }

  // Last resort: two genuinely indistinguishable faces still need two names.
  const used = new Map<string, number>();
  for (let index = 0; index < faces.length; index += 1) {
    const name = faces[index]!;
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) faces[index] = `${name}#${seen + 1}`;
    aliases[index] = unique([...(aliases[index] ?? []), name]);
  }

  return { faces, aliases, owners };
}

/** Names of a shape that has no history yet: every face is created. */
export function createShapeNames(
  facePaths: readonly string[],
  scope: string,
  owner: string,
): ShapeNames {
  const inherited = new Map<number, NameContribution[]>();
  return propagateNames({
    faceCount: facePaths.length,
    inherited,
    faceKeys: facePaths,
    created: new Map(facePaths.map((path, index) => [index, path])),
    scope,
    owner,
  });
}

/**
 * A 1:1 copy of a body: every face and edge keeps its path and gets the copy's
 * scope. Edge names are prefixed, never recomputed from the renamed faces —
 * otherwise the hash a stored reference uses would stop matching.
 */
export function prefixShapeNames(names: ShapeNames, prefix: string, owner?: string): ShapeNames {
  const prefixList = (list: readonly string[]): string[] =>
    list.map((name) => prefixScope(prefix, name));
  const edges = names.edges
    ? Object.fromEntries(
        Object.entries(names.edges).map(([id, name]) => [id, prefixScope(prefix, name)]),
      )
    : undefined;
  const edgeAliases = names.edgeAliases
    ? Object.fromEntries(
        Object.entries(names.edgeAliases).map(([id, list]) => [id, prefixList(list)]),
      )
    : undefined;
  return {
    faces: prefixList(names.faces),
    aliases: names.aliases.map(prefixList),
    owners: owner ? names.owners.map(() => owner) : [...names.owners],
    ...(edges ? { edges } : {}),
    ...(edgeAliases ? { edgeAliases } : {}),
  };
}

/** Name of an edge from the two faces that meet along it. */
export function edgePath(first: string, second: string, qualifier?: string): string {
  const pair = [first, second].sort();
  return `edge/${stableNameHash(...pair)}${qualifier ? `/${qualifier}` : ''}`;
}

/** Every historical name of an edge, from every historical name of its faces. */
export function edgeAliasPaths(
  first: readonly string[],
  second: readonly string[],
  qualifier?: string,
): string[] {
  const names: string[] = [];
  for (const left of unique(first)) {
    for (const right of unique(second)) names.push(edgePath(left, right, qualifier));
  }
  return unique(names);
}
