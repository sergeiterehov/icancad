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
  return selection
    .filter((item) => item.kind === 'body' || item.kind === 'mesh')
    .map((item) => item.id);
}

export function linkedBodyIds(selection: SelectionItem[], project: Project): string[] {
  const direct = new Set(directBodyIds(selection));
  const ids = new Set<string>();
  const featureIds = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'feature') featureIds.add(item.id);
  }
  for (const body of project.bodies) {
    if (featureIds.has(body.createdBy) && !direct.has(body.id)) ids.add(body.id);
  }
  return [...ids];
}

export function selectedBodyIds(selection: SelectionItem[], project: Project): string[] {
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'body') {
      const body = project.bodies.find((candidate) => candidate.id === item.id);
      if (body && body.kind !== 'mesh') ids.add(item.id);
    } else if (item.kind === 'feature') {
      const feature = project.features.find((candidate) => candidate.id === item.id);
      if (feature && feature.type !== 'import-mesh') ids.add(featureBodyId(item.id));
    }
  }
  return [...ids];
}

export function selectedMeshIds(selection: SelectionItem[]): string[] {
  return selection.filter((item) => item.kind === 'mesh').map((item) => item.id);
}

export function selectedSketchIds(selection: SelectionItem[]): string[] {
  return selection.filter((item) => item.kind === 'sketch').map((item) => item.id);
}

export function selectedFaceIds(selection: SelectionItem[]): string[] {
  return selection.filter((item) => item.kind === 'face').map((item) => item.id);
}

export function selectedFeatureIds(selection: SelectionItem[], project: Project): string[] {
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'feature' || item.kind === 'sketch') {
      ids.add(item.id);
    } else if (item.kind === 'face') {
      ids.add(item.id.split('#')[0] ?? item.id);
    } else if (item.kind === 'body' || item.kind === 'mesh') {
      const body = project.bodies.find((candidate) => candidate.id === item.id);
      if (body) ids.add(body.createdBy);
    }
  }
  return [...ids];
}
