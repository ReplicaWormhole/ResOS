import type { DesktopApi, Project } from '../shared/desktop-api.js';
import { ChatPane } from './chat-pane.js';
import { FileTree } from './file-tree.js';
import { SelectionToolbar } from './selection-toolbar.js';
import type { FileSource } from '../shared/notebook-api.js';
import { WorkspaceEditor } from './workspace-editor.js';

declare global {
  interface Window {
    readonly resos: DesktopApi;
  }
}

const addButton = document.querySelector<HTMLButtonElement>('#add-project')!;
const list = document.querySelector<HTMLUListElement>('#projects')!;
const title = document.querySelector('#project-title')!;
const root = document.querySelector<HTMLElement>('#project-root')!;
const errorMessage = document.querySelector<HTMLElement>('#project-error')!;

let projects: readonly Project[] = [];
let selected: Project | undefined;
let available: boolean | undefined;
let availabilityRequest = 0;
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const files = document.querySelector<HTMLElement>('#files')!;
const chats = document.querySelector<HTMLElement>('#chats')!;
const views = document.querySelector<HTMLElement>('#workspace-views')!;
type View = 'chat' | 'editor' | 'split';
const projectViews = new Map<string, View>();
const sidebarState = new Map<string, boolean>();
const viewButtons = views.querySelectorAll('button');
const editor = new WorkspaceEditor(window.resos);
const themeToggle = document.querySelector<HTMLInputElement>('#theme-toggle')!;
themeToggle.checked = document.documentElement.dataset.theme === 'dark';
themeToggle.addEventListener('change', () => {
  const theme = themeToggle.checked ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  editor.setTheme(themeToggle.checked);
  try {
    localStorage.setItem('resos:theme', theme);
  } catch {
    // The preference still applies for this session.
  }
});
themeToggle.disabled = false;
const chat = new ChatPane(
  window.resos,
  {
    canJump: (excerpt) => editor.canJump(excerpt),
    jump: async (excerpt) => {
      if (!selected || selected.id !== excerpt.projectId || !available)
        return false;
      setView('split');
      return editor.jump(selected, excerpt);
    },
  },
  () => {
    if (workspace.dataset.view === 'editor') setView('chat');
  },
  (notes) => editor.setNotes(notes),
);
editor.onBufferChange(() => void chat.refreshExcerptLinks(true));

function openFileDiscussion(
  projectId: string,
  source: FileSource,
): Promise<void> {
  const previous = (workspace.dataset.view ?? 'editor') as View;
  const setForProject = (view: View) => {
    if (selected?.id === projectId) setView(view);
  };
  return chat.openFile(projectId, source, {
    restore: () => setForProject(previous),
    expand: () => setForProject('chat'),
    collapse: () => setForProject('split'),
  });
}

const selectionToolbar = new SelectionToolbar((range) => {
  const capture = editor.captureSelection(range);
  if (!capture) return chat.selection(range);
  return {
    annotate: async () => {
      const excerpt = await capture();
      if (selected?.id === excerpt.projectId) chat.annotateFile(excerpt);
    },
    ask: async () => {
      const excerpt = await capture();
      if (selected?.id === excerpt.projectId)
        await openFileDiscussion(excerpt.projectId, {
          path: excerpt.path,
          excerpt,
        });
    },
    add: async () => {
      const excerpt = await capture();
      if (selected?.id !== excerpt.projectId) return;
      setView('split');
      await chat.attachExcerpt(excerpt);
    },
  };
}, showError);

document.querySelector('#ask-file')!.addEventListener('click', () => {
  const source = editor.fileSource();
  if (!source) return;
  if (
    source.unsaved &&
    !window.confirm(
      'Ask about the saved file on disk? Unsaved edits will stay in the editor.',
    )
  )
    return;
  void openFileDiscussion(source.projectId, { path: source.path }).catch(
    showError,
  );
});
const missing = document.querySelector<HTMLElement>('#missing-project')!;
const locate = document.querySelector<HTMLButtonElement>('#locate-project')!;
const tree = new FileTree(
  document.querySelector<HTMLElement>('#file-tree')!,
  window.resos,
  (project, path) => {
    if (selected?.id !== project.id || !available) return;
    if (workspace.dataset.view === 'chat') setView('editor');
    void editor.open(project, path);
  },
);
document
  .querySelector('#refresh-files')!
  .addEventListener('click', () => tree.refresh());

function renderView(): void {
  const view =
    available && selected ? (projectViews.get(selected.id) ?? 'chat') : 'chat';
  if (workspace.dataset.view !== view) {
    selectionToolbar.hide();
    chat.preserveScroll(() => {
      workspace.dataset.view = view;
    });
  }
  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
    button.disabled = !available && button.dataset.view !== 'chat';
  }
}

function setView(view: View): void {
  if (selected && (available || view === 'chat'))
    projectViews.set(selected.id, view);
  renderView();
}

for (const button of viewButtons) {
  button.addEventListener('click', () => setView(button.dataset.view as View));
}

const disclosures = [files, chats].map((section) => {
  const button = section.querySelector<HTMLButtonElement>('.disclosure')!;
  const content = document.getElementById(
    button.getAttribute('aria-controls')!,
  )!;
  const show = (open: boolean) => {
    button.setAttribute('aria-expanded', String(open));
    content.hidden = !open;
  };
  const storageKey = (projectId: string) =>
    'resos:sidebar:' + projectId + ':' + section.id;
  button.addEventListener('click', () => {
    if (!selected) return;
    const open = Boolean(content.hidden);
    const key = storageKey(selected.id);
    sidebarState.set(key, open);
    try {
      localStorage.setItem(key, String(open));
    } catch {
      // The preference still applies for this session.
    }
    show(open);
  });
  return (projectId: string) => {
    const key = storageKey(projectId);
    let open = sidebarState.get(key);
    if (open === undefined) {
      try {
        open = localStorage.getItem(key) !== 'false';
      } catch {
        open = true;
      }
    }
    show(open);
  };
});

function selectProject(project: Project): void {
  const changed = selected !== project;
  selected = project;
  title.textContent = project.name;
  root.textContent = project.root;
  root.title = project.root;
  workspace.hidden = false;
  views.hidden = false;
  chats.hidden = false;
  if (changed) {
    selectionToolbar.hide();
    available = undefined;
    for (const restore of disclosures) restore(project.id);
    files.hidden = true;
    missing.hidden = true;
    editor.hide();
    chat.show(project.id, project.root);
    chat.setAvailable(false);
    workspace.dataset.available = 'checking';
    renderView();
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
    } else editor.hide();
    renderView();
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
