/**
 * Browser UI controller. The server owns saved files and conversations; this
 * module owns transient UI state (selection, drafts, open panels and scroll).
 * API/storage, text rendering, passage anchors and streamed message updates
 * live in the small modules below. See ../README.md for the flow.
 */
import { createApiClient, sessionRead, sessionWrite } from './browser-session.js';
import { escapeHtml, safeMarkdown } from './markdown.js';
import { passageText, markLinkedPassages } from './passages.js';
import { createBranchPopup } from './branch-popup.js';
import { applyConversationEvent } from './conversation-events.js';
import { mainConversations, mainConversationId } from './conversation-navigation.js';

// DOM references and transient state

const query = selector => document.querySelector(selector);
const accessUrl = new URL(window.location.href);
const accessKey = accessUrl.searchParams.get('key') || sessionRead('research-ide-access-key');
if (accessUrl.searchParams.has('key') && sessionWrite('research-ide-access-key', accessKey)) {
  history.replaceState(null, '', accessUrl.pathname);
}
let localSequence = 0;
// These IDs only reconcile optimistic browser messages. They are not credentials.
const localId = () => `local-${Date.now().toString(36)}-${++localSequence}`;
const elements = {
  workspace: query('#workspaceName'),
  agentBadge: query('#agentBadge'),
  fileTree: query('#fileTree'),
  chatTree: query('#chatTree'),
  filesTab: query('#filesTab'),
  chatsTab: query('#chatsTab'),
  fileNav: query('#fileNav'),
  chatNav: query('#chatNav'),
  editor: query('#editor'),
  editorPath: query('#editorPath'),
  editorView: query('#editorView'),
  welcome: query('#welcomeScreen'),
  save: query('#saveFile'),
  dirty: query('#dirtyMark'),
  lineNumbers: query('#lineNumbers'),
  editorStatus: query('#editorStatus'),
  transcript: query('#transcript'),
  emptyChat: query('#emptyChat'),
  chatTitle: query('#chatTitle'),
  chatOrigin: query('#chatOrigin'),
  quote: query('#selectedQuote'),
  quoteText: query('#quoteText'),
  quoteParent: query('#quoteParentLink'),
  composer: query('#composer'),
  send: query('#sendButton'),
  turnState: query('#turnState'),
  selectionAction: query('#selectionAction'),
  toast: query('#toast'),
  approvalBar: query('#approvalBar'),
  approvalDescription: query('#approvalDescription')
};
const appState = {
  conversations: [],
  workspace: '',
  agentReady: false
};

// Conversation and request state.
let activeChatId = null;
let creatingChat = false;

// File editor state; loading uses a sequence to reject stale responses.
let openedFile = null;
let fileDirty = false;
let fileEditing = false;
let fileLoadSequence = 0;
let fileNewline = '\n';

// Render/selection state and connection bookkeeping.
let selectedSpan = null;
let renderedChatId = null;
let events = null;
let booting = false;
const scrollPositions = new Map();
const pendingSends = new Set();
const pendingApprovals = [];
let toastTimeout = null;
const openDirectories = new Set(['.']);
const api = createApiClient(accessKey);
const branchPopup = createBranchPopup({
  getConversations: () => appState.conversations,
  onSelect: id => {
    if (id === activeChatId) {
      restoreDraft();
    }
    selectChat(id);
  },
  onClose: id => {
    if (id === activeChatId) restoreDraft();
  },
  onSend: (id, text) => sendMessage(text, id),
  onStop: id => stopResponse(id),
  getApproval: () => pendingApprovals.length ? elements.approvalDescription.textContent : '',
  onApproval: resolveApproval,
  onOpen: () => {
    saveDraft();
    elements.selectionAction.hidden = true;
  }
});

// Layout, drafts and connection notices

function setEditorOpen(open) {
  document.body.classList.toggle('editor-open', open);
  query('#toggleEditor').setAttribute('aria-pressed', String(open));
}

function closeNavigation() {
  document.body.classList.remove('sidebar-open');
  query('#sidebarScrim').hidden = true;
  const expanded = !document.body.classList.contains('sidebar-collapsed') && window.innerWidth > 760;
  query('#sidebarToggle').setAttribute('aria-expanded', String(expanded));
}

function saveDraft() {
  if (activeChatId) {
    sessionWrite('draft:' + activeChatId, elements.composer.value);
  }
}

function resizeComposer() {
  elements.composer.style.height = 'auto';
  elements.composer.style.height = Math.min(180, Math.max(60, elements.composer.scrollHeight)) + 'px';
}

function restoreDraft() {
  elements.composer.value = activeChatId ? sessionRead('draft:' + activeChatId) : '';
  resizeComposer();
}

function fitViewport() {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale > 1.05) {
    return;
  }
  document.documentElement.style.setProperty('--app-height', (viewport?.height || window.innerHeight) + 'px');
  document.documentElement.style.setProperty('--viewport-top', (viewport?.offsetTop || 0) + 'px');
  const expanded = window.innerWidth <= 760
    ? document.body.classList.contains('sidebar-open')
    : !document.body.classList.contains('sidebar-collapsed');
  query('#sidebarToggle').setAttribute('aria-expanded', String(expanded));
}

function connectionNotice(message = '') {
  query('#connectionNotice').hidden = !message;
  query('#connectionMessage').textContent = message;
}

// Status and workspace navigation

function showToast(text) {
  elements.toast.textContent = text;
  elements.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove('show'), 3200);
}

function setAgentReady(ready, text) {
  appState.agentReady = ready;
  elements.agentBadge.classList.toggle('ready', ready);
  const label = text || (ready ? 'Codex connected' : 'Agent offline');
  elements.agentBadge.innerHTML = '<span class="status-dot"></span><span>' + escapeHtml(label) + '</span>';
}

function currentChat() {
  return appState.conversations.find(chat => chat.id === activeChatId) || null;
}

function renderChatTree() {
  const ordered = mainConversations(appState.conversations, activeChatId, sessionRead);
  const mainId = mainConversationId(appState.conversations, activeChatId);
  if (!ordered.length) {
    elements.chatTree.innerHTML = '<div class="no-items">Start a main chat with +. Follow-ups stay with their source passages and files.</div>';
    return;
  }
  elements.chatTree.replaceChildren();
  for (const chat of ordered) {
    const button = document.createElement('button');
    button.className = 'chat-entry';
    button.classList.toggle('active', chat.id === mainId);
    button.classList.toggle('is-working', Boolean(chat.busy));
    button.setAttribute('aria-current', String(chat.id === mainId));
    button.dataset.chatId = chat.id;
    button.style.paddingLeft = '8px';
    button.title = chat.title;

    const icon = document.createElement('span');
    icon.className = 'branch-icon root';
    icon.textContent = '◦';
    const label = document.createElement('span');
    label.className = 'entry-label';
    label.textContent = chat.title;

    button.append(icon, label);
    button.addEventListener('click', () => selectChat(chat.id));
    elements.chatTree.append(button);
  }
}

async function renderDirectory(relative = '.', container = elements.fileTree, depth = 0) {
  let data;
  try {
    data = await api('/api/files?path=' + encodeURIComponent(relative));
  } catch (error) {
    container.innerHTML = '<div class="no-items">' + escapeHtml(error.message) + '</div>';
    return;
  }
  const rows = document.createDocumentFragment();
  const childDirectories = [];
  for (const entry of data.entries) {
    const isDirectory = entry.type === 'directory';
    const isOpen = openDirectories.has(entry.path);
    const button = document.createElement('button');
    button.className = 'file-entry';
    button.classList.toggle('active', openedFile === entry.path);
    button.dataset.path = entry.path;
    button.dataset.type = entry.type;
    button.style.paddingLeft = (8 + depth * 12) + 'px';

    const icon = document.createElement('span');
    icon.className = 'file-icon ' + entry.type;
    icon.textContent = isDirectory ? (isOpen ? '▾' : '▸') : '·';
    const label = document.createElement('span');
    label.className = 'entry-label';
    label.textContent = entry.name;
    button.append(icon, label);
    button.addEventListener('click', async () => {
      if (!isDirectory) {
        await openFile(entry.path);
        return;
      }
      if (openDirectories.has(entry.path)) {
        openDirectories.delete(entry.path);
      } else {
        openDirectories.add(entry.path);
      }
      await renderDirectory();
    });
    rows.append(button);

    if (isDirectory && isOpen && depth < 4) {
      const child = document.createElement('div');
      child.className = 'directory-children';
      child.dataset.parent = entry.path;
      rows.append(child);
      childDirectories.push({ path: entry.path, container: child });
    }
  }
  if (!data.entries.length && relative === '.') {
    const empty = document.createElement('div');
    empty.className = 'no-items';
    empty.textContent = 'This workspace has no visible files yet.';
    rows.append(empty);
  }
  container.replaceChildren(rows);
  for (const child of childDirectories) {
    await renderDirectory(child.path, child.container, depth + 1);
  }
}

// File reading and editing

function updateGutter() {
  const count = Math.max(1, elements.editor.value.split('\n').length);
  elements.lineNumbers.textContent = Array.from({
    length: count
  }, (_, i) => i + 1).join('\n');
}

function renderFilePreview() {
  if (!openedFile || fileEditing) {
    return;
  }
  const preview = query('#filePreview');
  const children = appState.conversations.filter(chat => chat.sourceFile?.path === openedFile);
  const signature = JSON.stringify([openedFile, elements.editor.value, children.map(chat => [chat.id, chat.selectedQuote, chat.selectedStart])]);
  if (preview.dataset.signature === signature) {
    return;
  }
  preview.dataset.signature = signature;
  preview.textContent = elements.editor.value;
  const unmatched = markLinkedPassages(preview, {
    id: 'file:' + openedFile
  }, children.filter(chat => chat.selectedQuote), branchPopup.open);
  const links = query('#fileFollowups');
  links.replaceChildren();
  for (const chat of children) {
    const button = document.createElement('button');
    button.className = 'text-button';
    button.textContent = '↳ ' + chat.title + (unmatched.includes(chat) ? ' (passage changed)' : '');
    button.onclick = () => branchPopup.open([chat.id]);
    links.append(button);
  }
}

function showEditor() {
  elements.welcome.hidden = Boolean(openedFile);
  elements.editorView.hidden = !openedFile || !fileEditing;
  query('#fileReading').hidden = !openedFile || fileEditing;
  query('#toggleFileEdit').disabled = !openedFile;
  query('#toggleFileEdit').textContent = fileEditing ? 'Read' : 'Edit';
  query('#askFile').disabled = !openedFile || fileDirty || creatingChat;
  const hasSelection = fileEditing
    ? elements.editor.selectionEnd > elements.editor.selectionStart
    : selectedSpan?.filePath === openedFile;
  query('#askFile').textContent = hasSelection ? 'Ask about selection ↗' : 'Ask about file ↗';
  query('#askFile').title = fileDirty ? 'Save your edits before asking about this file' : '';
  elements.save.hidden = !fileEditing;
  renderFilePreview();
  elements.editorPath.textContent = openedFile || 'Welcome';
  elements.save.disabled = !openedFile || !fileDirty;
  elements.dirty.hidden = !fileDirty;
  elements.editorStatus.textContent = fileDirty ? 'Modified' : 'Ready';
}

async function openFile(relative, reveal = true) {
  if (fileDirty && openedFile !== relative && !window.confirm('Discard unsaved changes to ' + openedFile + '?')) {
    return;
  }
  if (fileDirty && openedFile === relative) {
    if (reveal) {
      setEditorOpen(true);
      closeNavigation();
    }
    return;
  }
  // Ignore older loads and preserve edits typed while this request is in flight.
  const loadSequence = ++fileLoadSequence;
  const previousFile = openedFile,
    previousText = elements.editor.value;
  try {
    const file = await api('/api/file?path=' + encodeURIComponent(relative));
    if (loadSequence !== fileLoadSequence) {
      return;
    }
    if (openedFile === previousFile && elements.editor.value !== previousText) {
      showToast('File opening cancelled to preserve your latest edits.');
      return;
    }
    selectedSpan = null;
    elements.selectionAction.hidden = true;
    openedFile = file.path;
    fileEditing = false;
    fileNewline = file.content.includes('\r\n') ? '\r\n' : '\n';
    elements.editor.value = file.content;
    fileDirty = false;
    showEditor();
    if (reveal) {
      setEditorOpen(true);
      closeNavigation();
    }
    updateGutter();
    await renderDirectory();
  } catch (error) {
    showToast(error.message);
  }
}

async function saveFile() {
  if (!openedFile || !fileDirty) {
    return;
  }
  try {
    await api('/api/file', {
      method: 'PUT',
      body: JSON.stringify({
        path: openedFile,
        content: fileNewline === '\r\n' ? elements.editor.value.replace(/\n/g, '\r\n') : elements.editor.value
      })
    });
    fileDirty = false;
    showEditor();
    showToast('Saved ' + openedFile);
  } catch (error) {
    showToast(error.message);
  }
}

// Conversation rendering and navigation

function openChatSource() {
  const chat = currentChat();
  if (chat?.sourceFile) {
    openFile(chat.sourceFile.path);
  } else if (chat?.parentId) {
    selectChat(chat.parentId);
  }
}

function renderQuote(chat) {
  const hasSource = Boolean(chat?.selectedQuote || chat?.sourceFile);
  elements.quote.hidden = !hasSource;
  elements.chatOrigin.hidden = !hasSource;
  if (!hasSource) {
    return;
  }
  elements.quoteText.textContent = chat.selectedQuote || 'Question about the whole file.';
  query('#quoteLabel').textContent = chat.sourceFile ? 'SOURCE FILE' : 'BRANCHED FROM SELECTION';
  elements.quoteParent.textContent = chat.sourceFile ? 'Open file ↗' : 'Open parent ↗';
  const parent = appState.conversations.find(item => item.id === chat.parentId);
  const source = chat.sourceFile
    ? chat.sourceFile.path + (chat.sourceFile.line ? ':' + chat.sourceFile.line : '')
    : parent?.title || 'parent chat';
  const originButton = document.createElement('button');
  originButton.type = 'button';
  originButton.id = 'originParent';
  originButton.textContent = source;
  originButton.addEventListener('click', openChatSource);
  elements.chatOrigin.replaceChildren(chat.sourceFile ? 'From ' : 'Branched from ', originButton);
}

function renderEmptyChat(chat, empty) {
  elements.emptyChat.hidden = !empty;
  const title = elements.emptyChat.querySelector('h3');
  const description = elements.emptyChat.querySelector('p');
  const prompts = elements.emptyChat.querySelector('.starter-prompts');
  prompts.hidden = Boolean(chat?.sourceFile);
  if (chat?.sourceFile) {
    title.textContent = 'What would you like to know about this file?';
    description.textContent = chat.selectedQuote
      ? 'The file path and selected passage are attached to this conversation. Ask your question below.'
      : 'The file path is attached to this conversation. Ask your question below.';
  } else {
    title.textContent = 'What are you working on?';
    description.textContent = 'Talk to your agent. Select part of any answer to ask about it in a linked conversation.';
  }
}

function renderChat(forceScroll = false) {
  const chat = currentChat();
  const changedChat = renderedChatId !== activeChatId;
  const stickToBottom = forceScroll || elements.transcript.scrollHeight - elements.transcript.scrollTop - elements.transcript.clientHeight < 100;
  elements.chatTitle.textContent = chat?.title || 'Research chat';
  elements.turnState.textContent = chat?.busy ? 'Agent working…' : 'Ready';
  elements.send.disabled = !chat || chat.busy || creatingChat;
  elements.send.hidden = Boolean(chat?.busy);
  query('#stopButton').hidden = !chat?.busy;
  elements.composer.disabled = !chat || creatingChat;
  elements.composer.placeholder = chat?.busy ? 'Write your next message…' : 'Ask anything about your research…';
  renderQuote(chat);
  const messages = chat?.messages || [];
  renderEmptyChat(chat, messages.length === 0);
  if (changedChat) {
    elements.transcript.querySelectorAll('.chat-message').forEach(node => node.remove());
  }
  const existing = new Map([...elements.transcript.querySelectorAll('.chat-message')].map(node => [node.dataset.messageId, node]));
  const retained = new Set();
  for (const message of messages) {
    let wrapper = existing.get(message.id);
    const isNew = !wrapper;
    if (isNew) {
      wrapper = document.createElement('article');
    }
    retained.add(message.id);
    wrapper.className = 'chat-message ' + message.role + (message.status === 'error' ? ' error' : '');
    wrapper.dataset.messageId = message.id;
    const children = appState.conversations.filter(child => (
      child.parentId === chat?.id &&
      child.parentTurnId === message.turnId &&
      (!child.parentMessageId || child.parentMessageId === message.id)
    ));
    const signature = JSON.stringify([
      message.text, message.status, message.turnId,
      children.map(child => [child.id, child.selectedQuote, child.selectedStart])
    ]);
    if (!isNew && wrapper.dataset.signature === signature) {
      continue;
    }
    wrapper.dataset.signature = signature;
    wrapper.replaceChildren();
    if (message.role === 'assistant') {
      if (message.turnId) {
        wrapper.dataset.turnId = message.turnId;
      }
      const body = document.createElement('div');
      body.className = 'message-body';
      body.innerHTML = safeMarkdown(message.text || (message.status === 'streaming' ? '…' : ''));
      const unmatched = markLinkedPassages(body, message, children, branchPopup.open);
      wrapper.append(body);
      for (const child of unmatched) {
        const link = document.createElement('button');
        link.className = 'text-button';
        link.textContent = '↳ Follow-up: ' + child.selectedQuote.slice(0, 80);
        link.onclick = () => branchPopup.open([child.id]);
        wrapper.append(link);
      }
      if (message.status === 'streaming') {
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = 'Thinking';
        wrapper.append(meta);
      } else if (message.turnId && message.text && message.status !== 'error') {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        const branch = document.createElement('button');
        branch.type = 'button';
        branch.textContent = 'Ask about this ↗';
        branch.addEventListener('click', () => {
          if (selectedSpan?.messageId !== message.id) {
            const text = passageText(body);
            selectedSpan = {
              turnId: message.turnId,
              messageId: message.id,
              start: text.length - text.trimStart().length,
              quote: text.trim().slice(0, 12000)
            };
          }
          branchFromSelection();
        });
        actions.append(branch);
        wrapper.append(actions);
      }
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.textContent = message.text;
      wrapper.append(bubble);
    }
    if (isNew) {
      elements.transcript.insertBefore(wrapper, elements.emptyChat);
    }
  }
  for (const [id, node] of existing) {
    if (!retained.has(id)) {
      node.remove();
    }
  }
  renderedChatId = activeChatId;
  if (changedChat) {
    elements.transcript.scrollTop = scrollPositions.get(activeChatId) ?? elements.transcript.scrollHeight;
  } else if (stickToBottom) {
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
  }
  renderChatTree();
  branchPopup.render();
  renderFilePreview();
}

async function selectChat(id) {
  branchPopup.close();
  saveDraft();
  if (activeChatId) {
    scrollPositions.set(activeChatId, elements.transcript.scrollTop);
  }
  activeChatId = id;
  const chat = currentChat();
  if (!chat) {
    return;
  }
  chat.lastUsedAt = new Date().toISOString();
  sessionWrite('activeChatId', id);
  selectedSpan = null;
  elements.selectionAction.hidden = true;
  restoreDraft();
  setEditorOpen(false);
  closeNavigation();
  renderChat();
}

function activateNav(which) {
  const files = which === 'files';
  elements.filesTab.classList.toggle('selected', files);
  elements.chatsTab.classList.toggle('selected', !files);
  elements.filesTab.setAttribute('aria-selected', String(files));
  elements.chatsTab.setAttribute('aria-selected', String(!files));
  elements.fileNav.hidden = !files;
  elements.chatNav.hidden = files;
}

// Chat creation, branching and sending

async function createChat() {
  if (creatingChat) {
    return;
  }
  saveDraft();
  const previousChatId = activeChatId;
  creatingChat = true;
  activeChatId = null;
  renderChat();
  try {
    const result = await api('/api/chat/new', {
      method: 'POST',
      body: '{}'
    });
    appState.conversations.push(result.chat);
    activeChatId = result.chat.id;
    sessionWrite('activeChatId', activeChatId);
    restoreDraft();
    setEditorOpen(false);
    closeNavigation();
    activateNav('chats');
  } catch (error) {
    activeChatId = previousChatId;
    showToast(error.message);
  } finally {
    creatingChat = false;
    renderChat();
    if (activeChatId) {
      elements.composer.focus();
    }
  }
}

async function askAboutFile() {
  if (!openedFile || fileDirty || creatingChat) {
    return;
  }
  let span = selectedSpan?.filePath === openedFile ? selectedSpan : null;
  if (fileEditing && elements.editor.selectionEnd > elements.editor.selectionStart) {
    const start = elements.editor.selectionStart;
    const end = elements.editor.selectionEnd;
    span = {
      filePath: openedFile,
      start,
      end,
      quote: elements.editor.value.slice(start, end).trim()
    };
  }
  if (span && (!span.quote || span.quote.length > 12000)) {
    showToast('Select between 1 and 12,000 characters.');
    return;
  }
  saveDraft();
  const path = openedFile;
  creatingChat = true;
  selectedSpan = null;
  elements.selectionAction.hidden = true;
  renderChat();
  showEditor();
  try {
    const result = await api('/api/chat/file', {
      method: 'POST',
      body: JSON.stringify({
        path,
        wholeFile: !span,
        start: span?.start,
        end: span?.end,
        selectedQuote: span?.quote
      })
    });
    appState.conversations.push(result.chat);
    await selectChat(result.chat.id);
    activateNav('chats');
    showToast('File linked. Ask your question below.');
  } catch (error) {
    showToast(error.message);
  } finally {
    creatingChat = false;
    renderChat();
    showEditor();
    elements.composer.focus();
  }
}

async function branchFromSelection() {
  if (selectedSpan?.filePath) {
    await askAboutFile();
    return;
  }
  if (!selectedSpan || !activeChatId || creatingChat) {
    return;
  }
  saveDraft();
  const parentId = activeChatId;
  const span = selectedSpan;
  selectedSpan = null;
  elements.selectionAction.hidden = true;
  creatingChat = true;
  renderChat();
  elements.turnState.textContent = 'Opening linked chat…';
  try {
    const result = await api('/api/chat/branch', {
      method: 'POST',
      body: JSON.stringify({
        parentId,
        turnId: span.turnId,
        selectedQuote: span.quote,
        parentMessageId: span.messageId,
        selectedStart: span.start
      })
    });
    appState.conversations.push(result.chat);
    activeChatId = result.chat.id;
    sessionWrite('activeChatId', activeChatId);
    restoreDraft();
    setEditorOpen(false);
    closeNavigation();
    activateNav('chats');
    showToast('New linked chat. Ask your question below.');
  } catch (error) {
    showToast(error.message);
  } finally {
    creatingChat = false;
    renderChat();
    elements.composer.focus();
  }
}

async function sendMessage(text = elements.composer.value, chatId = activeChatId) {
  const chat = appState.conversations.find(item => item.id === chatId);
  if (!chat || chat.busy || pendingSends.has(chatId) || creatingChat || !text.trim()) {
    return false;
  }
  const question = text.trim();
  if (chat.title === 'New chat') {
    chat.title = question.replace(/\s+/g, ' ').slice(0, 48) || 'Research chat';
  }
  if (activeChatId === chat.id) {
    elements.composer.value = '';
    resizeComposer();
  }
  sessionWrite('draft:' + chat.id, '');
  chat.messages.push({
    id: localId(),
    role: 'user',
    text: question,
    createdAt: new Date().toISOString()
  });
  chat.messages.push({
    id: localId(),
    role: 'assistant',
    text: '',
    status: 'streaming'
  });
  chat.busy = true;
  pendingSends.add(chat.id);
  renderChat(true);
  try {
    await api('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({
        chatId: chat.id,
        text: question
      })
    });
    return true;
  } catch (error) {
    chat.busy = false;
    const last = chat.messages.at(-1);
    if (last?.role === 'assistant') {
      last.status = 'error';
      last.text = error.message;
    }
    showToast(error.message);
    if (activeChatId === chat.id && !elements.composer.value && !sessionRead('draft:' + chat.id)) {
      elements.composer.value = question;
      saveDraft();
      resizeComposer();
    }
    renderChat();
    return false;
  } finally {
    pendingSends.delete(chat.id);
    refreshState().catch(() => {});
  }
}

async function stopResponse(chatId = activeChatId) {
  const chat = appState.conversations.find(item => item.id === chatId);
  if (!chat?.busy) {
    return;
  }
  try {
    await api('/api/chat/stop', {
      method: 'POST',
      body: JSON.stringify({
        chatId: chat.id
      })
    });
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  }
}

// Live server updates and permission requests

function handleEvent(event) {
  if (event.type === 'agent-status') {
    setAgentReady(event.ready, event.message || (event.ready ? 'Codex connected' : 'Agent offline'));
  }
  const updatedChat = applyConversationEvent(appState.conversations, event, localId);
  if (updatedChat?.id === activeChatId) {
    renderChat();
  }
  if (event.type === 'turn-completed') {
    refreshState().catch(() => {});
  }
  if (event.type === 'workspace-changed') {
    renderDirectory();
    if (openedFile && !fileDirty) {
      openFile(openedFile, false);
    }
  }
  if (event.type === 'approval-needed') {
    if (!pendingApprovals.some(item => item.id === event.id)) {
      pendingApprovals.push(event);
    }
    renderApproval();
  }
  branchPopup.render();
  if (event.type === 'agent-log' && !appState.agentReady) {
    setAgentReady(false, 'Agent starting…');
  }
}

function renderApproval() {
  const current = pendingApprovals[0];
  elements.approvalBar.hidden = !current;
  if (!current) {
    branchPopup.render();
    return;
  }
  const requested = current.params?.permissions ? 'Requested permissions: ' + JSON.stringify(current.params.permissions) : '';
  const command = current.params?.command?.join?.(' ') || current.params?.reason || current.params?.grantRoot || requested || current.method;
  elements.approvalDescription.textContent = String(command || 'The agent requested permission to use a tool.').slice(0, 180);
  branchPopup.render();
}

async function resolveApproval(decision) {
  const current = pendingApprovals[0];
  if (!current) {
    return;
  }
  try {
    await api('/api/approval/' + encodeURIComponent(current.id), {
      method: 'POST',
      body: JSON.stringify({
        decision
      })
    });
    pendingApprovals.shift();
    renderApproval();
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  }
}

async function refreshState() {
  const latest = await api('/api/state');
  appState.workspace = latest.workspace;
  // A snapshot can lag a send; keep its optimistic messages until the POST settles.
  const old = new Map(appState.conversations.map(chat => [chat.id, chat]));
  appState.conversations = latest.conversations.map(chat => {
    const local = old.get(chat.id);
    if (local && pendingSends.has(chat.id)) {
      return local;
    }
    return chat;
  });
  elements.workspace.textContent = latest.workspace;
  setAgentReady(latest.agentReady);
  renderChat();
}

// Selection coordinates and contextual actions

function showSelectionAction() {
  if (branchPopup.isOpen) {
    elements.selectionAction.hidden = true;
    return;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    selectedSpan = null;
    query('#askFile').textContent = 'Ask about file ↗';
    elements.selectionAction.hidden = true;
    return;
  }
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const preview = query('#filePreview');
  if (preview.contains(range.startContainer) && preview.contains(range.endContainer)) {
    if (fileDirty) {
      elements.selectionAction.hidden = true;
      return;
    }
    const prefix = document.createRange();
    prefix.selectNodeContents(preview);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = passageText(prefix.cloneContents()).length;
    const raw = passageText(range.cloneContents());
    selectedSpan = {
      filePath: openedFile,
      start,
      end: start + raw.length,
      quote: raw.trim()
    };
    const rect = range.getBoundingClientRect();
    elements.selectionAction.hidden = false;
    elements.selectionAction.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 200)) + 'px';
    elements.selectionAction.style.top = Math.max(8, rect.top - 44) + 'px';
    query('#askFile').textContent = 'Ask about selection ↗';
    return;
  }
  const message = node.nodeType === Node.ELEMENT_NODE
    ? node.closest?.('.chat-message.assistant')
    : node.parentElement?.closest('.chat-message.assistant');
  if (!message?.dataset.turnId || !message.closest('#transcript')) {
    elements.selectionAction.hidden = true;
    return;
  }
  const rect = range.getBoundingClientRect();
  const body = message.querySelector('.message-body');
  if (!body?.contains(range.startContainer) || !body.contains(range.endContainer)) {
    elements.selectionAction.hidden = true;
    return;
  }
  const prefix = document.createRange();
  prefix.selectNodeContents(body);
  prefix.setEnd(range.startContainer, range.startOffset);
  const raw = passageText(range.cloneContents());
  const quote = raw.trim().slice(0, 12000);
  if (!quote) {
    elements.selectionAction.hidden = true;
    return;
  }
  selectedSpan = {
    quote,
    turnId: message.dataset.turnId,
    messageId: message.dataset.messageId,
    start: passageText(prefix.cloneContents()).length + raw.length - raw.trimStart().length
  };
  elements.selectionAction.hidden = false;
  elements.selectionAction.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 170)) + 'px';
  elements.selectionAction.style.top = Math.max(8, rect.top - 39) + 'px';
}

// Event registration by feature

function bindFileEvents() {
  query('#askFile').addEventListener('pointerdown', event => event.preventDefault());
  query('#askFile').addEventListener('click', askAboutFile);
  query('#toggleFileEdit').addEventListener('click', () => {
    fileEditing = !fileEditing;
    selectedSpan = null;
    elements.selectionAction.hidden = true;
    showEditor();
  });
  for (const event of ['select', 'keyup', 'pointerup']) {
    elements.editor.addEventListener(event, () => {
      const hasSelection = elements.editor.selectionEnd > elements.editor.selectionStart;
      query('#askFile').textContent = hasSelection ? 'Ask about selection ↗' : 'Ask about file ↗';
    });
  }
  elements.filesTab.addEventListener('click', () => activateNav('files'));
  elements.chatsTab.addEventListener('click', () => activateNav('chats'));
  query('#refreshFiles').addEventListener('click', () => renderDirectory());
  elements.save.addEventListener('click', saveFile);
  elements.editor.addEventListener('input', () => {
    fileDirty = true;
    showEditor();
    updateGutter();
  });
  elements.editor.addEventListener('scroll', () => {
    elements.lineNumbers.scrollTop = elements.editor.scrollTop;
  });
}

function bindChatEvents() {
  query('#newChatButton').addEventListener('click', createChat);
  query('#chatNewButton').addEventListener('click', createChat);
  query('#chatNavNew').addEventListener('click', createChat);
  query('#welcomeNewChat').addEventListener('click', createChat);
  query('#welcomeOpenFile').addEventListener('click', () => activateNav('files'));
  elements.quoteParent.addEventListener('click', openChatSource);
  query('#composerForm').addEventListener('submit', event => {
    event.preventDefault();
    sendMessage();
  });
  elements.composer.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !currentChat()?.busy) {
      event.preventDefault();
      sendMessage();
    }
  });
  elements.composer.addEventListener('input', () => {
    saveDraft();
    resizeComposer();
  });
  query('#stopButton').addEventListener('click', () => stopResponse());
}

function bindLayoutEvents() {
  query('#closeEditor').addEventListener('click', () => setEditorOpen(false));
  query('#toggleEditor').addEventListener('click', () => {
    const open = !document.body.classList.contains('editor-open');
    setEditorOpen(open);
    if (open) {
      activateNav('files');
      if (window.innerWidth <= 760) {
        document.body.classList.add('sidebar-open');
        query('#sidebarScrim').hidden = false;
      } else {
        document.body.classList.remove('sidebar-collapsed');
      }
    }
  });
  query('#sidebarToggle').addEventListener('click', () => {
    const mobile = window.innerWidth <= 760;
    document.body.classList.toggle(mobile ? 'sidebar-open' : 'sidebar-collapsed');
    query('#sidebarScrim').hidden = !mobile || !document.body.classList.contains('sidebar-open');
    const expanded = mobile
      ? document.body.classList.contains('sidebar-open')
      : !document.body.classList.contains('sidebar-collapsed');
    query('#sidebarToggle').setAttribute('aria-expanded', String(expanded));
  });
  query('#sidebarScrim').addEventListener('click', closeNavigation);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeNavigation();
      setEditorOpen(false);
    }
  });
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  window.addEventListener('resize', fitViewport);
}

function bindSelectionAndApprovalEvents() {
  for (const prompt of document.querySelectorAll('[data-prompt]')) {
    prompt.addEventListener('click', () => sendMessage(prompt.dataset.prompt));
  }
  elements.selectionAction.addEventListener('pointerdown', event => event.preventDefault());
  elements.selectionAction.addEventListener('click', branchFromSelection);
  query('#allowApproval').addEventListener('click', () => resolveApproval('allow'));
  query('#declineApproval').addEventListener('click', () => resolveApproval('deny'));
  document.addEventListener('selectionchange', showSelectionAction);
  document.addEventListener('scroll', () => {
    elements.selectionAction.hidden = true;
  }, true);
}

// Initial load and event-stream connection

async function boot() {
  if (booting) {
    return;
  }
  booting = true;
  try {
    const latest = await api('/api/state');
    appState.workspace = latest.workspace;
    appState.conversations = latest.conversations;
    elements.workspace.textContent = latest.workspace;
    setAgentReady(latest.agentReady);
    await renderDirectory();
    renderChatTree();
    showEditor();
    activateNav('chats');
    const savedChatId = sessionRead('activeChatId');
    const selected = appState.conversations.find(chat => chat.id === savedChatId) ||
      [...appState.conversations].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0];
    if (selected) {
      activeChatId = selected.id;
    } else {
      await createChat();
    }
    restoreDraft();
    renderChat();
    connectionNotice();
    events?.close();
    events = new EventSource('/api/events' + (accessKey ? '?key=' + encodeURIComponent(accessKey) : ''));
    events.onopen = () => {
      pendingApprovals.length = 0;
      renderApproval();
      connectionNotice();
      refreshState().catch(error => connectionNotice(error.message));
    };
    events.onerror = () => connectionNotice('Connection lost. Reconnecting… Your draft is kept in this tab.');
    events.onmessage = event => {
      try {
        handleEvent(JSON.parse(event.data));
      } catch (error) {
        console.error('Could not handle app event', error);
      }
    };
  } catch (error) {
    setAgentReady(false, 'Connection error');
    connectionNotice(error.message);
  } finally {
    booting = false;
  }
}

// Register UI handlers once; reconnects only reload data and replace the event stream.
function initialize() {
  bindFileEvents();
  bindChatEvents();
  bindLayoutEvents();
  bindSelectionAndApprovalEvents();
  query('#reconnectButton').addEventListener('click', boot);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshState().catch(error => connectionNotice(error.message));
    }
  });
  fitViewport();
  closeNavigation();
  boot();
}

initialize();
