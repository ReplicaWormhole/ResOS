import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type { Project } from '../shared/desktop-api.js';
import { readJson, replaceJson } from '../storage/local-json.js';

interface SavedProject extends Project {
  readonly removed?: boolean;
}

function visibleProject({ id, root, name, pinned }: SavedProject): Project {
  return { id, root, name, ...(pinned === undefined ? {} : { pinned }) };
}

async function resolveFolder(folder: string): Promise<string> {
  const root = await realpath(folder);
  if (!(await stat(root)).isDirectory())
    throw new Error('Choose an existing folder.');
  return root;
}

export async function isAvailable(root: string): Promise<boolean> {
  try {
    return (await realpath(root)) === root && (await stat(root)).isDirectory();
  } catch (error) {
    if (
      ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      return false;
    throw error;
  }
}

function isProject(value: unknown): value is SavedProject {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'root' in value &&
    typeof value.root === 'string' &&
    isAbsolute(value.root) &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    (!('pinned' in value) || typeof value.pinned === 'boolean') &&
    (!('removed' in value) || typeof value.removed === 'boolean')
  );
}

export class ProjectRegistry {
  private pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<readonly Project[]> {
    return (await this.records())
      .filter((project) => !project.removed)
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
      .map(visibleProject);
  }

  private async records(): Promise<readonly SavedProject[]> {
    const data = await readJson(this.filePath);
    if (data === undefined) return [];
    if (
      typeof data !== 'object' ||
      data === null ||
      !('version' in data) ||
      data.version !== 1 ||
      !('projects' in data) ||
      !Array.isArray(data.projects) ||
      !data.projects.every(isProject)
    ) {
      throw new Error('The saved project registry has an unsupported format.');
    }
    return data.projects;
  }

  add(folder: string): Promise<Project> {
    return this.mutate(async (projects) => {
      const root = await resolveFolder(folder);
      const existing = projects.find((project) => project.root === root);
      if (existing) {
        if (!existing.removed) return existing;
        const restored = visibleProject(existing);
        projects[projects.indexOf(existing)] = restored;
        return restored;
      }
      const project = { id: randomUUID(), root, name: basename(root) || root };
      projects.push(project);
      return project;
    });
  }

  pin(id: string, pinned: boolean): Promise<Project> {
    return this.mutate(async (projects) => {
      if (typeof pinned !== 'boolean') throw new Error('Invalid pin state.');
      const index = projects.findIndex(
        (project) => project.id === id && !project.removed,
      );
      if (index < 0) throw new Error('Project not found.');
      const project = { ...visibleProject(projects[index]!), pinned };
      projects[index] = project;
      return project;
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate(async (projects) => {
      const index = projects.findIndex(
        (project) => project.id === id && !project.removed,
      );
      if (index < 0) throw new Error('Project not found.');
      const project = { ...projects[index]!, removed: true, pinned: false };
      projects[index] = project;
      return project;
    });
  }

  relink(id: string, folder: string): Promise<Project> {
    return this.mutate(async (projects) => {
      const index = projects.findIndex(
        (project) => project.id === id && !project.removed,
      );
      if (index < 0) throw new Error('Project not found.');
      const project = projects[index]!;
      if (await isAvailable(project.root))
        throw new Error('The project folder is already available.');
      const root = await resolveFolder(folder);
      if (projects.some((other) => other.id !== id && other.root === root)) {
        throw new Error('That folder is already assigned to another project.');
      }
      const updated = { ...project, root };
      projects[index] = updated;
      return updated;
    });
  }

  private mutate(
    update: (projects: SavedProject[]) => Promise<Project>,
  ): Promise<Project> {
    const write = this.pendingWrite.then(async () => {
      const previous = await this.records();
      const projects = [...previous];
      const project = await update(projects);
      if (
        projects.length !== previous.length ||
        projects.some((item, index) => item !== previous[index])
      ) {
        await replaceJson(this.filePath, { version: 1, projects });
      }
      return project;
    });
    this.pendingWrite = write.catch(() => {});
    return write;
  }
}
