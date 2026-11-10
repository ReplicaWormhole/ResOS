import type { DesktopApi, Project } from '../shared/desktop-api.js';
import { ChatPane } from './chat-pane.js';
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
let selected: Project | undefined;
let available: boolean | undefined;
let availabilityRequest = 0;
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const files = document.querySelector<HTMLElement>('#files')!;
const editor = new WorkspaceEditor(window.resos);
const chat = new ChatPane(window.resos);
const missing = document.querySelector<HTMLElement>('#missing-project')!;
const locate = document.querySelector<HTMLButtonElement>('#locate-project')!;
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
  const changed = selected !== project;
  selected = project;
  title.textContent = project.name;
  root.textContent = project.root;
  workspace.hidden = false;
  if (changed) {
    available = undefined;
    files.hidden = true;
    missing.hidden = true;
    editor.hide();
    chat.show(project.id, project.root);
    chat.setAvailable(false);
    workspace.dataset.available = 'checking';
  }
  void refreshAvailability();
  for (const button of list.querySelectorAll('button')) {
    if (button.dataset.projectId === project.id) {
      button.setAttribute('aria-current', 'true');
    } else {
      button.removeAttribute('aria-current');
    }
  }
}

async function refreshAvailability(): Promise<void> {
  const project = selected;
  if (!project) return;
  const request = ++availabilityRequest;
  try {
    const exists = await window.resos.projectAvailable(project.id);
    if (
      selected !== project ||
      request !== availabilityRequest ||
      available === exists
    )
      return;
    available = exists;
    workspace.dataset.available = String(exists);
    files.hidden = !exists;
    missing.hidden = exists;
    chat.setAvailable(exists);
    if (exists) {
      tree.show(project);
      editor.show(project);
    } else {
      editor.hide();
      if (workspace.dataset.expanded === 'editor') expandPane('');
    }
  } catch (error) {
    if (selected === project && request === availabilityRequest)
      showError(error);
  }
}

locate.addEventListener('click', async () => {
  const original = selected;
  if (!original) return;
  locate.disabled = true;
  errorMessage.hidden = true;
  try {
    const project = await window.resos.locateProject(original.id);
    if (project) {
      projects = projects.map((item) =>
        item.id === project.id ? project : item,
      );
      renderProjects(selected === original ? project : selected);
    }
  } catch (error) {
    if (selected === original) showError(error);
  } finally {
    locate.disabled = false;
  }
});
window.addEventListener('focus', () => void refreshAvailability());
window.setInterval(() => void refreshAvailability(), 1500);

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
