import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import type { Project } from '../shared/desktop-api.js';

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
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const data: unknown = JSON.parse(raw);
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
    const write = this.pendingWrite.then(async () => {
      const root = await realpath(folder);
      if (!(await stat(root)).isDirectory()) {
        throw new Error('Choose an existing folder.');
      }

      const projects = await this.list();
      const existing = projects.find((project) => project.root === root);
      if (existing) return existing;

      const project = { id: randomUUID(), root, name: basename(root) || root };
      await this.save([...projects, project]);
      return project;
    });

    // A failed save must not prevent later attempts.
    this.pendingWrite = write.catch(() => {});
    return write;
  }

  private async save(projects: readonly Project[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, projects }) + '\n',
        {
          mode: 0o600,
          flag: 'wx',
        },
      );
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
