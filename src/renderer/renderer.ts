import type { DesktopApi, Project } from '../shared/desktop-api.js';
import { FileTree } from './file-tree.js';
import { WorkspaceEditor } from './workspace-editor.js';

declare global {
  interface Window {
    readonly resos: DesktopApi;
  }
}

const addButton = document.querySelector<HTMLButtonElement>('#add-project')!;
const list = document.querySelector<HTMLUListElement>('#projects')!;
const title = document.querySelector('#project-title')!;
const root = document.querySelector('#project-root')!;
const errorMessage = document.querySelector<HTMLElement>('#project-error')!;

let projects: readonly Project[] = [];
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const files = document.querySelector<HTMLElement>('#files')!;
const editor = new WorkspaceEditor(window.resos);
const tree = new FileTree(
  document.querySelector<HTMLElement>('#file-tree')!,
  window.resos,
  (project, path) => {
    if (workspace.dataset.expanded === 'chat') expandPane('');
    void editor.open(project, path);
  },
);
document
  .querySelector('#refresh-files')!
  .addEventListener('click', () => tree.refresh());

const paneButtons = ['editor', 'chat'].map((pane) => ({
  pane,
  button: document.querySelector<HTMLButtonElement>('#expand-' + pane)!,
}));

function expandPane(selected: string): void {
  workspace.dataset.expanded = selected;
  for (const { pane, button } of paneButtons) {
    const expanded = selected === pane;
    button.setAttribute('aria-pressed', String(expanded));
    button.textContent = expanded ? 'Restore split view' : 'Expand ' + pane;
  }
}

for (const { pane, button } of paneButtons) {
  button.addEventListener('click', () =>
    expandPane(workspace.dataset.expanded === pane ? '' : pane),
  );
}

function selectProject(project: Project): void {
  title.textContent = project.name;
  root.textContent = project.root;
  files.hidden = false;
  workspace.hidden = false;
  tree.show(project);
  editor.show(project);
  for (const button of list.querySelectorAll('button')) {
    if (button.dataset.projectId === project.id) {
      button.setAttribute('aria-current', 'true');
    } else {
      button.removeAttribute('aria-current');
    }
  }
}

function renderProjects(selected: Project | undefined): void {
  list.replaceChildren();
  for (const project of projects) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.projectId = project.id;
    button.textContent = project.name;
    button.title = project.root;
    button.addEventListener('click', () => selectProject(project));
    item.append(button);
    list.append(item);
  }
  if (selected) selectProject(selected);
}

function showError(error: unknown): void {
  errorMessage.textContent =
    error instanceof Error ? error.message : String(error);
  errorMessage.hidden = false;
}

addButton.addEventListener('click', async () => {
  addButton.disabled = true;
  errorMessage.hidden = true;
  let focusTarget = addButton;
  try {
    const project = await window.resos.chooseProject();
    if (project) {
      if (!projects.some((saved) => saved.id === project.id))
        projects = [...projects, project];
      renderProjects(project);
      focusTarget =
        list.querySelector<HTMLButtonElement>('[aria-current]') ?? addButton;
    }
  } catch (error) {
    showError(error);
  } finally {
    addButton.disabled = false;
    focusTarget.focus();
  }
});

try {
  projects = await window.resos.listProjects();
  renderProjects(projects[0]);
  addButton.disabled = false;
} catch (error) {
  showError(error);
}
