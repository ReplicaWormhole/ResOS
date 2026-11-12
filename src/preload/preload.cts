import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/desktop-api.js';

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  chooseProject: () => ipcRenderer.invoke('projects:choose'),
  pinProject: (id, pinned) => ipcRenderer.invoke('projects:pin', id, pinned),
  removeProject: (id) => ipcRenderer.invoke('projects:remove', id),
  projectAvailable: (id) => ipcRenderer.invoke('projects:available', id),
  locateProject: (id) => ipcRenderer.invoke('projects:locate', id),
  listChats: (id) => ipcRenderer.invoke('chats:list', id),
  createChat: (id) => ipcRenderer.invoke('chats:create', id),
  createFileChat: (id, source) =>
    ipcRenderer.invoke('chats:create-file', id, source),
  listFileNotes: (id) => ipcRenderer.invoke('chats:file-notes', id),
  addFileNote: (id, excerpt, text) =>
    ipcRenderer.invoke('chats:file-note', id, excerpt, text),
  harnessCatalog: (id) => ipcRenderer.invoke('chats:harness-catalog', id),
  supportsNotebookLookup: () => ipcRenderer.invoke('chats:lookup-supported'),
  previewContext: (id, chatId, question, excerpts, passages, options) =>
    ipcRenderer.invoke(
      'chats:preview-context',
      id,
      chatId,
      question,
      excerpts,
      passages,
      options,
    ),
  sendChat: (id, chatId, question, requestId, excerpts, passages, options) =>
    ipcRenderer.invoke(
      'chats:send',
      id,
      chatId,
      question,
      requestId,
      excerpts,
      passages,
      options,
    ),
  stopChat: (id, jobId) => ipcRenderer.invoke('chats:stop', id, jobId),
  retryChat: (id, chatId, jobId, confirm, settings) =>
    ipcRenderer.invoke('chats:retry', id, chatId, jobId, confirm, settings),
  listApprovals: (id) => ipcRenderer.invoke('chats:approvals', id),
  decideApproval: (id, approvalId, accept) =>
    ipcRenderer.invoke('chats:approval', id, approvalId, accept),
  chatRuntime: () => ipcRenderer.invoke('chats:runtime'),
  reviseMessage: (id, address, text) =>
    ipcRenderer.invoke('chats:revise', id, address, text),
  addMessageNote: (id, address, text, passage) =>
    ipcRenderer.invoke('chats:note', id, address, text, passage),
  createDiscussion: (id, passage) =>
    ipcRenderer.invoke('chats:discuss', id, passage),
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
