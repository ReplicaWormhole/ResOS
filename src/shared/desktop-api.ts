import type { ChatApi } from './notebook-api.js';

export interface Project {
  readonly id: string;
  readonly root: string;
  readonly name: string;
}

export interface DesktopApi extends ChatApi {
  listProjects(): Promise<readonly Project[]>;
  chooseProject(): Promise<Project | null>;
  projectAvailable(projectId: string): Promise<boolean>;
  locateProject(projectId: string): Promise<Project | null>;
  listDirectory(
    projectId: string,
    path: string,
  ): Promise<readonly WorkspaceEntry[]>;
  readFile(projectId: string, path: string): Promise<WorkspaceFile>;
  saveFile(
    projectId: string,
    path: string,
    revision: string,
    text: string,
  ): Promise<WorkspaceSave>;
}

export interface WorkspaceEntry {
  readonly name: string;
  readonly kind: 'directory' | 'file';
}

export interface WorkspaceFile {
  readonly text: string;
  readonly revision: string;
}

export type WorkspaceSave =
  | { readonly status: 'saved'; readonly revision: string }
  | { readonly status: 'conflict' };
