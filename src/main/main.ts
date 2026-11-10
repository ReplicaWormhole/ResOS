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
import { ProjectRegistry } from '../projects/project-registry.js';
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

  async function workspaceRoot(
    event: IpcMainInvokeEvent,
    id: unknown,
  ): Promise<string> {
    requireAppFrame(event);
    if (typeof id !== 'string' || id.length > 128)
      throw new Error('Invalid project ID.');
    const project = (await registry.list()).find((entry) => entry.id === id);
    if (!project) throw new Error('Project not found.');
    return project.root;
  }

  ipcMain.handle('workspace:list', async (event, id, path) =>
    listDirectory(await workspaceRoot(event, id), path),
  );
  ipcMain.handle('workspace:read', async (event, id, path) =>
    readFile(await workspaceRoot(event, id), path),
  );
  let pendingSave: Promise<unknown> = Promise.resolve();
  ipcMain.handle('workspace:save', async (event, id, path, revision, text) => {
    const root = await workspaceRoot(event, id);
    const write = pendingSave.then(() => saveFile(root, path, revision, text));
    pendingSave = write.catch(() => {});
    return write;
  });

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
  registerDesktopHandlers(window, registry);
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
