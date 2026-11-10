import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChatService } from '../jobs/chat-service.js';
import { NotebookStore } from '../notebook/notebook-store.js';
import { isAvailable, ProjectRegistry } from '../projects/project-registry.js';
import { demoRuntime } from '../runtime/demo-runtime.js';
import type { Project } from '../shared/desktop-api.js';
import {
  listDirectory,
  readFile,
  saveFile,
} from '../workspace/workspace-files.js';

const homeUrl = 'resos://app/index.html';
const assets = new Set(['/index.html', '/styles.css', '/renderer.js']);

protocol.registerSchemesAsPrivileged([
  { scheme: 'resos', privileges: { standard: true, secure: true } },
]);

function registerDesktopHandlers(
  window: BrowserWindow,
  registry: ProjectRegistry,
  chats: ChatService,
): void {
  function requireAppFrame(event: IpcMainInvokeEvent): void {
    const frame = event.senderFrame;
    if (
      event.sender !== window.webContents ||
      frame?.parent !== null ||
      frame.url !== homeUrl
    ) {
      throw new Error('Request did not originate from the ResOS window.');
    }
  }

  async function projectFor(
    event: IpcMainInvokeEvent,
    id: unknown,
  ): Promise<Project> {
    requireAppFrame(event);
    if (typeof id !== 'string' || id.length > 128)
      throw new Error('Invalid project ID.');
    const project = (await registry.list()).find((entry) => entry.id === id);
    if (!project) throw new Error('Project not found.');
    return project;
  }

  async function availableProject(
    event: IpcMainInvokeEvent,
    id: unknown,
  ): Promise<Project> {
    const project = await projectFor(event, id);
    if (!(await isAvailable(project.root)))
      throw new Error('Locate the project folder before continuing.');
    return project;
  }

  let pendingWorkspaceChange: Promise<unknown> = Promise.resolve();
  function changeWorkspace<T>(operation: () => Promise<T>): Promise<T> {
    const change = pendingWorkspaceChange.then(operation);
    pendingWorkspaceChange = change.catch(() => {});
    return change;
  }

  ipcMain.handle('workspace:list', async (event, id, path) =>
    listDirectory((await availableProject(event, id)).root, path),
  );
  ipcMain.handle('workspace:read', async (event, id, path) =>
    readFile((await availableProject(event, id)).root, path),
  );
  ipcMain.handle('workspace:save', (event, id, path, revision, text) =>
    changeWorkspace(async () =>
      saveFile((await availableProject(event, id)).root, path, revision, text),
    ),
  );

  ipcMain.handle('projects:available', async (event, id) =>
    isAvailable((await projectFor(event, id)).root),
  );
  ipcMain.handle('projects:locate', async (event, id) => {
    const project = await projectFor(event, id);
    if (chats.isRunning(project.id))
      throw new Error('Wait for the running response before relinking.');
    const choice = await dialog.showOpenDialog(window, {
      title: 'Locate Project Folder',
      properties: ['openDirectory'],
    });
    const folder = choice.filePaths[0];
    if (choice.canceled || !folder) return null;
    return changeWorkspace(() => {
      if (chats.isRunning(project.id))
        throw new Error('Wait for the running response before relinking.');
      return registry.relink(project.id, folder);
    });
  });

  ipcMain.handle('chats:list', async (event, id) =>
    chats.list((await projectFor(event, id)).id),
  );
  ipcMain.handle('chats:create', async (event, id) =>
    chats.create((await projectFor(event, id)).id),
  );
  ipcMain.handle('chats:send', (event, id, chatId, question) =>
    changeWorkspace(async () => {
      if (typeof chatId !== 'string' || chatId.length > 128)
        throw new Error('Invalid chat ID.');
      await chats.send(await availableProject(event, id), chatId, question);
    }),
  );

  ipcMain.handle('projects:list', (event) => {
    requireAppFrame(event);
    return registry.list();
  });
  ipcMain.handle('projects:choose', async (event) => {
    requireAppFrame(event);
    const choice = await dialog.showOpenDialog(window, {
      title: 'Add Project',
      properties: ['openDirectory'],
    });
    const folder = choice.filePaths[0];
    return choice.canceled || !folder ? null : registry.add(folder);
  });
}

async function openWindow(): Promise<void> {
  await app.whenReady();
  const styleNonce = randomBytes(18).toString('base64');
  protocol.handle('resos', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || !assets.has(url.pathname)) {
      return new Response(null, { status: 404 });
    }
    const response = await net.fetch(
      pathToFileURL(join(import.meta.dirname, '../renderer', url.pathname))
        .href,
    );
    if (url.pathname !== '/index.html' || !response.ok) return response;
    const html = (await response.text()).replaceAll(
      '__RESOS_STYLE_NONCE__',
      styleNonce,
    );
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  });

  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  const window = new BrowserWindow({
    title: 'ResOS',
    width: 1050,
    height: 700,
    minWidth: 640,
    minHeight: 420,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  const registry = new ProjectRegistry(
    join(app.getPath('userData'), 'projects.json'),
  );
  const notebook = new NotebookStore(
    join(app.getPath('userData'), 'notebook.json'),
  );
  await notebook.recover();
  const chats = new ChatService(notebook, demoRuntime, (id) => {
    if (!window.isDestroyed()) window.webContents.send('chats:changed', id);
  });
  registerDesktopHandlers(window, registry, chats);
  await window.loadURL(homeUrl);
}

if (app.requestSingleInstanceLock()) {
  app.on('window-all-closed', () => app.quit());
  void openWindow().catch((error: unknown) => {
    dialog.showErrorBox('Could not start ResOS', String(error));
    app.exit(1);
  });
} else {
  app.quit();
}
