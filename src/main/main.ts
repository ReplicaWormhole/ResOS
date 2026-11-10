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
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectRegistry } from '../projects/project-registry.js';

const homeUrl = 'resos://app/index.html';
const assets = new Set(['/index.html', '/styles.css', '/renderer.js']);

protocol.registerSchemesAsPrivileged([
  { scheme: 'resos', privileges: { standard: true, secure: true } },
]);

function registerProjectHandlers(
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
  protocol.handle('resos', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || !assets.has(url.pathname)) {
      return new Response(null, { status: 404 });
    }
    return net.fetch(
      pathToFileURL(join(import.meta.dirname, '../renderer', url.pathname))
        .href,
    );
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
  registerProjectHandlers(window, registry);
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
