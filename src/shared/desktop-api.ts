export interface Project {
  readonly id: string;
  readonly root: string;
  readonly name: string;
}

export interface DesktopApi {
  listProjects(): Promise<readonly Project[]>;
  chooseProject(): Promise<Project | null>;
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
