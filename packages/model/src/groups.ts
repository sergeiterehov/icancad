import type { Feature, FeatureGroup, Model } from './types';

/**
 * Folders of the operations strip (ADR 0032). Membership is stored on the
 * operation and on the child folder; order is never stored: a folder sits at
 * the first operation it owns, and its contents are the operations between its
 * first and its last member. Nothing here changes the build order.
 */

export interface FeatureNode {
  kind: 'feature';
  id: string;
  /** First operation of the node in the flat list. */
  start: number;
  /** Last operation of the node in the flat list. */
  end: number;
  feature: Feature;
}

export interface GroupNode {
  kind: 'group';
  id: string;
  start: number;
  end: number;
  group: FeatureGroup;
}

export type TimelineNode = FeatureNode | GroupNode;

export interface GroupRange {
  start: number;
  end: number;
}

function groupsById(model: Model): Map<string, FeatureGroup> {
  return new Map(model.groups.map((group) => [group.id, group]));
}

/** Folders from the outermost ancestor to the given folder itself. */
export function groupPath(model: Model, groupId: string | null): FeatureGroup[] {
  const groups = groupsById(model);
  const path: FeatureGroup[] = [];
  const seen = new Set<string>();
  let current = groupId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const group = groups.get(current);
    if (!group) break;
    path.unshift(group);
    current = group.parentId;
  }
  return path;
}

/** Flat range every folder covers, derived from its operations. */
export function groupRanges(model: Model): Map<string, GroupRange> {
  const groups = groupsById(model);
  const ranges = new Map<string, GroupRange>();
  model.features.forEach((feature, index) => {
    const seen = new Set<string>();
    let groupId = feature.groupId ?? null;
    while (groupId !== null && !seen.has(groupId)) {
      seen.add(groupId);
      const group = groups.get(groupId);
      if (!group) break;
      const range = ranges.get(groupId);
      ranges.set(groupId, {
        start: Math.min(range?.start ?? index, index),
        end: Math.max(range?.end ?? index, index),
      });
      groupId = group.parentId;
    }
  });
  return ranges;
}

/** Operations of a folder, including those of its nested folders, in build order. */
export function groupFeatureIds(model: Model, groupId: string): string[] {
  const groups = groupsById(model);
  if (!groups.has(groupId)) return [];
  const members = new Set<string>([groupId]);
  for (;;) {
    let added = false;
    for (const group of model.groups) {
      if (group.parentId === null || !members.has(group.parentId)) continue;
      if (members.has(group.id)) continue;
      members.add(group.id);
      added = true;
    }
    if (!added) break;
  }
  return model.features
    .filter((feature) => feature.groupId !== undefined && members.has(feature.groupId))
    .map((feature) => feature.id);
}

/**
 * One level of the strip: its own operations and its child folders, in build
 * order. A folder that lost every operation has no place to sit and is left
 * out; such a folder is pruned when operations are removed and when a project
 * is loaded.
 */
export function timelineNodes(model: Model, parentId: string | null): TimelineNode[] {
  const groups = groupsById(model);
  // A missing folder has no level of its own: the caller resets to the root.
  if (parentId !== null && !groups.has(parentId)) return [];
  const level = parentId;
  const ranges = groupRanges(model);
  const nodes: TimelineNode[] = [];
  model.features.forEach((feature, index) => {
    const owner = feature.groupId && groups.has(feature.groupId) ? feature.groupId : null;
    if (owner !== level) return;
    nodes.push({ kind: 'feature', id: feature.id, start: index, end: index, feature });
  });
  for (const group of model.groups) {
    const owner = group.parentId !== null && groups.has(group.parentId) ? group.parentId : null;
    if (owner !== level) continue;
    const range = ranges.get(group.id);
    if (!range) continue;
    nodes.push({ kind: 'group', id: group.id, start: range.start, end: range.end, group });
  }
  nodes.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  return nodes;
}

/** Deepest folder whose operations surround the position strictly. */
export function groupAtPosition(model: Model, position: number): string | null {
  const paths = new Map<string, number>();
  let found: { id: string; depth: number; span: number } | null = null;
  for (const [id, range] of groupRanges(model)) {
    if (range.start >= position || position > range.end) continue;
    const depth = paths.get(id) ?? groupPath(model, id).length;
    paths.set(id, depth);
    const span = range.end - range.start;
    if (!found || depth > found.depth || (depth === found.depth && span < found.span)) {
      found = { id, depth, span };
    }
  }
  return found?.id ?? null;
}

/**
 * Where a new operation goes. The open folder owns the insertion: a user who is
 * inside a folder and adds an operation expects it in that folder, even when the
 * cursor itself sits before or after the folder. The index is clamped into the
 * folder for the same reason — the flat order of a folder must stay one run.
 */
export function insertionPoint(
  model: Model,
  position: number,
  openGroupId: string | null,
): { index: number; groupId: string | null } {
  const open = openGroupId !== null ? groupRanges(model).get(openGroupId) : undefined;
  if (!open) return { index: position, groupId: groupAtPosition(model, position) };
  const index = Math.min(Math.max(position, open.start), open.end + 1);
  if (index > open.end) return { index, groupId: openGroupId };
  return { index, groupId: groupAtPosition(model, index) ?? openGroupId };
}

/**
 * Drops folders that no longer hold anything. A folder is a place in the
 * strip, so one without operations has nowhere to be; removing its last
 * operation removes it, and the same happens to a parent that only held it.
 */
export function pruneEmptyGroups(model: Model): Model {
  let groups = model.groups;
  for (;;) {
    const used = new Set<string>();
    for (const feature of model.features) {
      if (feature.groupId !== undefined) used.add(feature.groupId);
    }
    for (const group of groups) {
      if (group.parentId !== null) used.add(group.parentId);
    }
    const next = groups.filter((group) => used.has(group.id));
    if (next.length === groups.length) break;
    groups = next;
  }
  return groups === model.groups ? model : { ...model, groups };
}

/** Next free name for a folder, "Group 2", "Group 3", … */
export function nextGroupName(model: Model, base: string): string {
  const names = new Set(model.groups.map((group) => group.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}
