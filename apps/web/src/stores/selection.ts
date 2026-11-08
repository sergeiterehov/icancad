import { featureBodyId, type Project } from '@icancad/model';
import type { SelectionItem } from './documentStore';

export function isDirectlySelected(
  selection: SelectionItem[],
  kind: SelectionItem['kind'],
  id: string,
): boolean {
  return selection.some((item) => item.kind === kind && item.id === id);
}

export function directBodyIds(selection: SelectionItem[]): string[] {
  return selection.filter((item) => item.kind === 'body').map((item) => item.id);
}

export function linkedBodyIds(selection: SelectionItem[], project: Project): string[] {
  const direct = new Set(directBodyIds(selection));
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind !== 'feature') continue;
    for (const body of project.bodies) {
      if (body.createdBy === item.id && !direct.has(body.id)) ids.add(body.id);
    }
  }
  return [...ids];
}

export function selectedBodyIds(selection: SelectionItem[]): string[] {
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'body') ids.add(item.id);
    else if (item.kind === 'feature') ids.add(featureBodyId(item.id));
  }
  return [...ids];
}

export function selectedFeatureIds(selection: SelectionItem[], project: Project): string[] {
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'feature') {
      ids.add(item.id);
    } else if (item.kind === 'body') {
      const body = project.bodies.find((candidate) => candidate.id === item.id);
      if (body) ids.add(body.createdBy);
    }
  }
  return [...ids];
}
