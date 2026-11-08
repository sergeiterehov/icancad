import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseProject, ProjectFileError, type Project } from '@icancad/model';

export interface ProjectFileContents {
  project: Project;
  assets: Map<string, Uint8Array>;
}

const DOCUMENT_ENTRY = 'document.json';
const ASSET_PREFIX = 'assets/';

export function serializeProjectFile(
  project: Project,
  assets: Map<string, Uint8Array> = new Map(),
): Blob {
  const files: Record<string, Uint8Array> = {
    [DOCUMENT_ENTRY]: strToU8(JSON.stringify(project, null, 2)),
  };
  for (const [id, data] of assets) {
    files[`${ASSET_PREFIX}${id}`] = data;
  }
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export function parseProjectFile(data: Uint8Array): ProjectFileContents {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (error) {
    throw new ProjectFileError('INVALID_PROJECT', 'Project file is not a valid ZIP archive', {
      cause: error,
    });
  }

  const documentBytes = files[DOCUMENT_ENTRY];
  if (!documentBytes) {
    throw new ProjectFileError('INVALID_PROJECT', 'Project file has no document.json');
  }

  let document: unknown;
  try {
    document = JSON.parse(strFromU8(documentBytes));
  } catch (error) {
    throw new ProjectFileError('INVALID_PROJECT', 'document.json is not valid JSON', {
      cause: error,
    });
  }

  const projectsAssets = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith(ASSET_PREFIX)) {
      projectsAssets.set(name.slice(ASSET_PREFIX.length), bytes);
    }
  }

  return { project: parseProject(document), assets: projectsAssets };
}

export function projectFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'project'}.icad`;
}
