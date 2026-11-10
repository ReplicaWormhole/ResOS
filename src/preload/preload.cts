import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/desktop-api.js';

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  chooseProject: () => ipcRenderer.invoke('projects:choose'),
  projectAvailable: (id) => ipcRenderer.invoke('projects:available', id),
  locateProject: (id) => ipcRenderer.invoke('projects:locate', id),
  listChats: (id) => ipcRenderer.invoke('chats:list', id),
  createChat: (id) => ipcRenderer.invoke('chats:create', id),
  sendChat: (id, chatId, question) =>
    ipcRenderer.invoke('chats:send', id, chatId, question),
  onChatChanged: (listener) => {
    const receive = (_event: unknown, projectId: string) => listener(projectId);
    ipcRenderer.on('chats:changed', receive);
    return () => ipcRenderer.removeListener('chats:changed', receive);
  },
  listDirectory: (id, path) => ipcRenderer.invoke('workspace:list', id, path),
  readFile: (id, path) => ipcRenderer.invoke('workspace:read', id, path),
  saveFile: (id, path, revision, text) =>
    ipcRenderer.invoke('workspace:save', id, path, revision, text),
};

contextBridge.exposeInMainWorld('resos', api);
