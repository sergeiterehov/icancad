import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '@icancad/model';

interface ICadDatabase extends DBSchema {
  projects: { key: string; value: Project };
  assets: { key: string; value: Blob };
  settings: { key: string; value: string };
}

let databasePromise: Promise<IDBPDatabase<ICadDatabase>> | null = null;

export function openDatabase(): Promise<IDBPDatabase<ICadDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<ICadDatabase>('icancad', 1, {
      upgrade(database) {
        database.createObjectStore('projects', { keyPath: 'id' });
        database.createObjectStore('assets');
        database.createObjectStore('settings');
      },
    });
  }
  return databasePromise;
}

export async function saveProject(project: Project): Promise<void> {
  const database = await openDatabase();
  await database.put('projects', project);
}

export async function loadProject(id: string): Promise<Project | null> {
  const database = await openDatabase();
  return (await database.get('projects', id)) ?? null;
}

export async function listProjects(): Promise<Project[]> {
  const database = await openDatabase();
  return database.getAll('projects');
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  await database.delete('projects', id);
}

export async function saveAsset(id: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await database.put('assets', blob, id);
}

export async function loadAsset(id: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  return database.get('assets', id);
}

export async function getSetting(key: string): Promise<string | null> {
  const database = await openDatabase();
  return (await database.get('settings', key)) ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const database = await openDatabase();
  await database.put('settings', value, key);
}
