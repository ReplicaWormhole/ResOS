export interface Project {
  readonly id: string;
  readonly root: string;
  readonly name: string;
}

export interface DesktopApi {
  listProjects(): Promise<readonly Project[]>;
  chooseProject(): Promise<Project | null>;
}
