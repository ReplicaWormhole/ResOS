import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/desktop-api.js';

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  chooseProject: () => ipcRenderer.invoke('projects:choose'),
};

contextBridge.exposeInMainWorld('resos', api);
