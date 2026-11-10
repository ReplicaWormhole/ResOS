import type { DesktopApi, Project } from '../shared/desktop-api.js';

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

function selectProject(project: Project): void {
  title.textContent = project.name;
  root.textContent = project.root;
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
