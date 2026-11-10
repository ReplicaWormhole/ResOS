import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/desktop-api.js';

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  chooseProject: () => ipcRenderer.invoke('projects:choose'),
  listDirectory: (id, path) => ipcRenderer.invoke('workspace:list', id, path),
  readFile: (id, path) => ipcRenderer.invoke('workspace:read', id, path),
  saveFile: (id, path, revision, text) =>
    ipcRenderer.invoke('workspace:save', id, path, revision, text),
};

contextBridge.exposeInMainWorld('resos', api);
