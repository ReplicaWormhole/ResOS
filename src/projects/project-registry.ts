import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type { Project } from '../shared/desktop-api.js';
import { readJson, replaceJson } from '../storage/local-json.js';

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

function isProject(value: unknown): value is Project {
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
    value.name.length > 0
  );
}

export class ProjectRegistry {
  private pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<readonly Project[]> {
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
      if (existing) return existing;
      const project = { id: randomUUID(), root, name: basename(root) || root };
      projects.push(project);
      return project;
    });
  }

  relink(id: string, folder: string): Promise<Project> {
    return this.mutate(async (projects) => {
      const index = projects.findIndex((project) => project.id === id);
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
    update: (projects: Project[]) => Promise<Project>,
  ): Promise<Project> {
    const write = this.pendingWrite.then(async () => {
      const previous = await this.list();
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
