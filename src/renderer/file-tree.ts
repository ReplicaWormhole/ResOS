import type { DesktopApi, Project } from '../shared/desktop-api.js';

export class FileTree {
  private project?: Project;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: DesktopApi,
    private readonly openFile: (project: Project, path: string) => void,
  ) {}

  show(project: Project): void {
    this.project = project;
    this.refresh();
  }

  refresh(): void {
    if (!this.project) return;
    const container = document.createElement('div');
    this.host.replaceChildren(container);
    void this.load(this.project, '', container);
  }

  private async load(
    project: Project,
    path: string,
    host: HTMLElement,
  ): Promise<void> {
    host.textContent = 'Loading files…';
    try {
      const entries = await this.api.listDirectory(project.id, path);
      const list = document.createElement('ul');
      list.className = 'file-list';
      for (const entry of entries) {
        const relative = path ? path + '/' + entry.name : entry.name;
        const item = document.createElement('li');
        if (entry.kind === 'directory') {
          const folder = document.createElement('details');
          const name = document.createElement('summary');
          const children = document.createElement('div');
          name.textContent = entry.name;
          folder.append(name, children);
          folder.addEventListener('toggle', () => {
            if (folder.open && !children.hasChildNodes())
              void this.load(project, relative, children);
          });
          item.append(folder);
        } else {
          const file = document.createElement('button');
          file.type = 'button';
          file.className = 'file-button';
          file.textContent = entry.name;
          file.addEventListener('click', () =>
            this.openFile(project, relative),
          );
          item.append(file);
        }
        list.append(item);
      }
      if (entries.length) host.replaceChildren(list);
      else host.textContent = 'This folder is empty.';
    } catch (error) {
      host.textContent = error instanceof Error ? error.message : String(error);
    }
  }
}
