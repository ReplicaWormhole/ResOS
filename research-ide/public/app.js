const $ = selector => document.querySelector(selector);
const accessUrl = new URL(window.location.href);
function sessionRead(key, fallback = '') { try { return sessionStorage.getItem(key) || fallback; } catch { return fallback; } }
function sessionWrite(key, value) { try { sessionStorage.setItem(key, value); return true; } catch { return false; } }
const accessKey = accessUrl.searchParams.get('key') || sessionRead('research-ide-access-key');
if (accessUrl.searchParams.has('key') && sessionWrite('research-ide-access-key', accessKey)) history.replaceState(null, '', accessUrl.pathname);
let localSequence = 0;
// These IDs only reconcile optimistic browser messages. They are not credentials.
const localId = () => 'local-' + Date.now().toString(36) + '-' + (++localSequence);
const el = {
  workspace: $('#workspaceName'), agentBadge: $('#agentBadge'), fileTree: $('#fileTree'),
  chatTree: $('#chatTree'), filesTab: $('#filesTab'), chatsTab: $('#chatsTab'),
  fileNav: $('#fileNav'), chatNav: $('#chatNav'), editor: $('#editor'),
  editorPath: $('#editorPath'), editorView: $('#editorView'), welcome: $('#welcomeScreen'),
  save: $('#saveFile'), dirty: $('#dirtyMark'), lineNumbers: $('#lineNumbers'),
  editorStatus: $('#editorStatus'), transcript: $('#transcript'), emptyChat: $('#emptyChat'),
  chatTitle: $('#chatTitle'), chatOrigin: $('#chatOrigin'), quote: $('#selectedQuote'),
  quoteText: $('#quoteText'), quoteParent: $('#quoteParentLink'),
  composer: $('#composer'), send: $('#sendButton'), turnState: $('#turnState'),
  selectionAction: $('#selectionAction'), toast: $('#toast'), approvalBar: $('#approvalBar'),
  approvalDescription: $('#approvalDescription'),
};
let appState = { conversations: [], workspace: '', agentReady: false };
let activeChatId = null;
let creatingChat = false;
let openedFile = null;
let fileDirty = false;
let fileEditing = false;
let fileLoadSequence = 0;
let fileNewline = '\n';
let selectedSpan = null;
let renderedChatId = null;
let events = null;
let booting = false;
const scrollPositions = new Map();
const pendingSends = new Set();
const pendingApprovals = [];
let toastTimeout = null;
const openDirectories = new Set(['.']);

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(accessKey ? { 'x-access-key': accessKey } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed (' + response.status + ').');
  return body;
}
function setEditorOpen(open) {
  document.body.classList.toggle('editor-open', open);
  $('#toggleEditor').setAttribute('aria-pressed', String(open));
}
function closeNavigation() {
  document.body.classList.remove('sidebar-open');
  $('#sidebarScrim').hidden = true;
  $('#sidebarToggle').setAttribute('aria-expanded', String(!document.body.classList.contains('sidebar-collapsed') && window.innerWidth > 760));
}
function saveDraft() {
  if (activeChatId) sessionWrite('draft:' + activeChatId, el.composer.value);
}
function resizeComposer() {
  el.composer.style.height = 'auto';
  el.composer.style.height = Math.min(180, Math.max(60, el.composer.scrollHeight)) + 'px';
}
function restoreDraft() {
  el.composer.value = activeChatId ? sessionRead('draft:' + activeChatId) : '';
  resizeComposer();
}
function fitViewport() {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale > 1.05) return;
  document.documentElement.style.setProperty('--app-height', (viewport?.height || window.innerHeight) + 'px');
  document.documentElement.style.setProperty('--viewport-top', (viewport?.offsetTop || 0) + 'px');
  $('#sidebarToggle').setAttribute('aria-expanded', String(window.innerWidth <= 760 ? document.body.classList.contains('sidebar-open') : !document.body.classList.contains('sidebar-collapsed')));
}
function connectionNotice(message = '') {
  $('#connectionNotice').hidden = !message;
  $('#connectionMessage').textContent = message;
}
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function safeMarkdown(value) {
  const fences = [];
  let text = escapeHtml(value).replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, code) => {
    const token = '\u0000FENCE' + fences.length + '\u0000';
    fences.push('<pre><code>' + code.trimEnd() + '</code></pre>');
    return token;
  });
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, title) => {
    const level = Math.min(hashes.length + 2, 5);
    return '<h' + level + '>' + title + '</h' + level + '>';
  });
  return text.replace(/\n/g, '<br>').replace(/\u0000FENCE(\d+)\u0000/g, (_, index) => fences[Number(index)] || '');
}
// A single text coordinate system for selections and rendered Markdown, including line breaks.
function passageText(root) {
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType === Node.TEXT_NODE) text += walker.currentNode.data;
    else if (walker.currentNode.nodeName === 'BR') text += '\n';
  }
  return text;
}
function passageRange(text, chat, message) {
  const quote = chat.selectedQuote || '';
  if (!quote) return null;
  if (Number.isInteger(chat.selectedStart) && chat.parentMessageId === message.id &&
      text.slice(chat.selectedStart, chat.selectedStart + quote.length) === quote) {
    return [chat.selectedStart, chat.selectedStart + quote.length];
  }
  const start = text.indexOf(quote);
  if (chat.sourceFile && start !== text.lastIndexOf(quote)) return null;
  if (start >= 0) return [start, start + quote.length];
  // Older selections may use browser-inserted newlines or raw Markdown.
  const normalized = [], positions = [];
  for (let i = 0; i < text.length; i++) {
    const char = /\s/.test(text[i]) ? ' ' : text[i];
    if (char === ' ' && normalized.at(-1) === ' ') continue;
    normalized.push(char); positions.push(i);
  }
  const needle = quote.replace(/\s+/g, ' ').trim();
  const index = normalized.join('').indexOf(needle);
  return index < 0 || !needle ? null : [positions[index], positions[index + needle.length - 1] + 1];
}
let popupChatIds = [];
let popupChatId = null;
function renderBranchPopup() {
  const dialog = $('#branchPopup');
  if (!dialog.open) return;
  const chats = popupChatIds.map(id => appState.conversations.find(chat => chat.id === id)).filter(Boolean);
  const chat = chats.find(chat => chat.id === popupChatId) || chats[0];
  if (!chat) { dialog.close(); return; }
  popupChatId = chat.id;
  $('#branchPopupTitle').textContent = chat.title;
  const choices = $('#branchPopupChoices');
  const choiceSignature = JSON.stringify([chats.map(item => [item.id, item.title]), chat.id]);
  if (choices.dataset.signature !== choiceSignature) {
    choices.dataset.signature = choiceSignature;
    choices.replaceChildren();
    if (chats.length > 1) for (const item of chats) {
      const button = document.createElement('button');
      button.className = 'button button-small';
      button.textContent = item.title;
      button.setAttribute('aria-pressed', String(item.id === chat.id));
      button.onclick = () => { popupChatId = item.id; renderBranchPopup(); };
      choices.append(button);
    }
  }
  $('#branchPopupQuote').textContent = chat.selectedQuote;
  const transcript = $('#branchPopupTranscript');
  const oldScrollTop = transcript.scrollTop;
  const bottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
  const signature = JSON.stringify([chat.id, chat.messages, chat.busy]);
  if (transcript.dataset.signature !== signature) {
    const switched = transcript.dataset.chatId !== chat.id;
    transcript.dataset.signature = signature;
    transcript.dataset.chatId = chat.id;
    transcript.replaceChildren();
    for (const message of chat.messages) {
      const article = document.createElement('article');
      article.className = 'chat-message ' + message.role;
      const body = document.createElement('div');
      body.className = message.role === 'assistant' ? 'message-body' : 'message-bubble';
      if (message.role === 'assistant') body.innerHTML = safeMarkdown(message.text || (chat.busy ? 'Thinking…' : ''));
      else body.textContent = message.text;
      article.append(body); transcript.append(article);
    }
    if (!chat.messages.length) transcript.textContent = 'No messages yet. Open this chat to ask your question.';
    transcript.scrollTop = switched || bottom ? transcript.scrollHeight : oldScrollTop;
  }
}
function openBranchPopup(ids) {
  popupChatIds = ids;
  popupChatId = ids[0];
  el.selectionAction.hidden = true;
  const dialog = $('#branchPopup');
  if (!dialog.open) dialog.showModal();
  renderBranchPopup();
}
function markLinkedPassages(body, message, children) {
  if (!children.length) return [];
  const text = passageText(body);
  const ranges = children.map(chat => ({ chat, range: passageRange(text, chat, message) })).filter(item => item.range);
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) { nodes.push({ node, start: offset }); offset += node.length; }
    else if (node.nodeName === 'BR') offset++;
  }
  for (const { node, start } of nodes) {
    const cuts = new Set([0, node.length]);
    for (const { range: [a, b] } of ranges) {
      if (a < start + node.length && b > start) { cuts.add(Math.max(0, a - start)); cuts.add(Math.min(node.length, b - start)); }
    }
    const points = [...cuts].sort((a, b) => a - b);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const linked = ranges.filter(item => item.range[0] < start + b && item.range[1] > start + a);
      const textNode = document.createTextNode(node.data.slice(a, b));
      if (!linked.length) { fragment.append(textNode); continue; }
      const mark = document.createElement('mark');
      mark.className = 'linked-passage';
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
      mark.setAttribute('aria-haspopup', 'dialog');
      mark.title = 'View ' + linked.length + ' linked chat' + (linked.length > 1 ? 's' : '');
      mark.setAttribute('aria-label', mark.title + ': ' + textNode.data);
      const open = event => {
        event.preventDefault(); event.stopPropagation();
        if (window.getSelection()?.toString()) return;
        openBranchPopup(linked.map(item => item.chat.id));
      };
      mark.addEventListener('click', open);
      mark.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { window.getSelection()?.removeAllRanges(); open(event); }
      });
      mark.append(textNode); fragment.append(mark);
    }
    node.replaceWith(fragment);
  }
  return children.filter(chat => !ranges.some(item => item.chat.id === chat.id));
}
function showToast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.toast.classList.remove('show'), 3200);
}
function setAgentReady(ready, text) {
  appState.agentReady = ready;
  el.agentBadge.classList.toggle('ready', ready);
  el.agentBadge.innerHTML = '<span class="status-dot"></span><span>' + escapeHtml(text || (ready ? 'Codex connected' : 'Agent offline')) + '</span>';
}
function currentChat() { return appState.conversations.find(chat => chat.id === activeChatId) || null; }
function chatDepth(chat, byId = new Map(appState.conversations.map(item => [item.id, item]))) {
  let depth = 0, current = chat;
  while (current?.parentId && depth < 10) { current = byId.get(current.parentId); if (!current) break; depth++; }
  return depth;
}
function renderChatTree() {
  const visibleChats = appState.conversations.filter(chat => chat.messages.length || chat.id === activeChatId || sessionRead('draft:' + chat.id) || appState.conversations.some(child => child.parentId === chat.id));
  const ordered = [], visited = new Set();
  const append = chat => {
    if (visited.has(chat.id)) return;
    visited.add(chat.id);
    ordered.push(chat);
    visibleChats.filter(item => item.parentId === chat.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach(append);
  };
  visibleChats.filter(chat => !chat.parentId).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)).forEach(append);
  visibleChats.forEach(append);
  if (!ordered.length) {
    el.chatTree.innerHTML = '<div class="no-items">Start a chat to begin an investigation.</div>';
    return;
  }
  el.chatTree.innerHTML = ordered.map(chat => {
    const indent = Math.min(chatDepth(chat), 5) * 13;
    return '<button class="chat-entry ' + (chat.id === activeChatId ? 'active ' : '') + (chat.busy ? 'is-working' : '') + '" aria-current="' + (chat.id === activeChatId ? 'true' : 'false') + '" data-chat-id="' + escapeHtml(chat.id) + '" style="padding-left:' + (8 + indent) + 'px" title="' + escapeHtml(chat.title) + '">' +
      '<span class="branch-icon ' + (!chat.parentId ? 'root' : '') + '">' + (chat.parentId ? '↳' : '◦') + '</span><span class="entry-label">' + escapeHtml(chat.title) + '</span></button>';
  }).join('');
  for (const button of el.chatTree.querySelectorAll('[data-chat-id]')) button.addEventListener('click', () => selectChat(button.dataset.chatId));
}
async function renderDirectory(relative = '.', container = el.fileTree, depth = 0) {
  let data;
  try { data = await api('/api/files?path=' + encodeURIComponent(relative)); }
  catch (error) { container.innerHTML = '<div class="no-items">' + escapeHtml(error.message) + '</div>'; return; }
  const rows = [];
  for (const entry of data.entries) {
    const isOpen = openDirectories.has(entry.path);
    const icon = entry.type === 'directory' ? (isOpen ? '▾' : '▸') : '·';
    rows.push('<button class="file-entry ' + (openedFile === entry.path ? 'active' : '') + '" data-path="' + escapeHtml(entry.path) + '" data-type="' + entry.type + '" style="padding-left:' + (8 + depth * 12) + 'px"><span class="file-icon ' + entry.type + '">' + icon + '</span><span class="entry-label">' + escapeHtml(entry.name) + '</span></button>');
    if (entry.type === 'directory' && isOpen && depth < 4) rows.push('<div class="directory-children" data-parent="' + escapeHtml(entry.path) + '"></div>');
  }
  if (!rows.length && relative === '.') rows.push('<div class="no-items">This workspace has no visible files yet.</div>');
  container.innerHTML = rows.join('');
  for (const button of container.querySelectorAll(':scope > .file-entry')) {
    button.addEventListener('click', async () => {
      if (button.dataset.type === 'directory') {
        if (openDirectories.has(button.dataset.path)) openDirectories.delete(button.dataset.path);
        else openDirectories.add(button.dataset.path);
        await renderDirectory();
      } else await openFile(button.dataset.path);
    });
  }
  for (const child of container.querySelectorAll(':scope > .directory-children')) await renderDirectory(child.dataset.parent, child, depth + 1);
}
function updateGutter() {
  const count = Math.max(1, el.editor.value.split('\n').length);
  el.lineNumbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}
function renderFilePreview() {
  if (!openedFile || fileEditing) return;
  const preview = $('#filePreview');
  const children = appState.conversations.filter(chat => chat.sourceFile?.path === openedFile);
  const signature = JSON.stringify([openedFile, el.editor.value, children.map(chat => [chat.id, chat.selectedQuote, chat.selectedStart])]);
  if (preview.dataset.signature === signature) return;
  preview.dataset.signature = signature;
  preview.textContent = el.editor.value;
  const unmatched = markLinkedPassages(preview, { id: 'file:' + openedFile }, children.filter(chat => chat.selectedQuote));
  const links = $('#fileFollowups');
  links.replaceChildren();
  for (const chat of children) {
    const button = document.createElement('button');
    button.className = 'text-button';
    button.textContent = '↳ ' + chat.title + (unmatched.includes(chat) ? ' (passage changed)' : '');
    button.onclick = () => openBranchPopup([chat.id]);
    links.append(button);
  }
}
function showEditor() {
  el.welcome.hidden = Boolean(openedFile);
  el.editorView.hidden = !openedFile || !fileEditing;
  $('#fileReading').hidden = !openedFile || fileEditing;
  $('#toggleFileEdit').disabled = !openedFile;
  $('#toggleFileEdit').textContent = fileEditing ? 'Read' : 'Edit';
  $('#askFile').disabled = !openedFile || fileDirty || creatingChat;
  $('#askFile').textContent = (fileEditing ? el.editor.selectionEnd > el.editor.selectionStart : selectedSpan?.filePath === openedFile) ? 'Ask about selection ↗' : 'Ask about file ↗';
  $('#askFile').title = fileDirty ? 'Save your edits before asking about this file' : '';
  el.save.hidden = !fileEditing;
  renderFilePreview();
  el.editorPath.textContent = openedFile || 'Welcome';
  el.save.disabled = !openedFile || !fileDirty;
  el.dirty.hidden = !fileDirty;
  el.editorStatus.textContent = openedFile ? (fileDirty ? 'Modified' : 'Ready') : 'Ready';
}
async function openFile(relative, reveal = true) {
  if (fileDirty && openedFile !== relative && !window.confirm('Discard unsaved changes to ' + openedFile + '?')) return;
  if (fileDirty && openedFile === relative) { if (reveal) { setEditorOpen(true); closeNavigation(); } return; }
  const loadSequence = ++fileLoadSequence;
  const previousFile = openedFile, previousText = el.editor.value;
  try {
    const file = await api('/api/file?path=' + encodeURIComponent(relative));
    if (loadSequence !== fileLoadSequence) return;
    if (openedFile === previousFile && el.editor.value !== previousText) { showToast('File opening cancelled to preserve your latest edits.'); return; }
    selectedSpan = null;
    el.selectionAction.hidden = true;
    openedFile = file.path;
    fileEditing = false;
    fileNewline = file.content.includes('\r\n') ? '\r\n' : '\n';
    el.editor.value = file.content;
    fileDirty = false;
    showEditor();
    if (reveal) { setEditorOpen(true); closeNavigation(); }
    updateGutter();
    await renderDirectory();
  } catch (error) { showToast(error.message); }
}
async function saveFile() {
  if (!openedFile || !fileDirty) return;
  try {
    await api('/api/file', { method: 'PUT', body: JSON.stringify({ path: openedFile, content: fileNewline === '\r\n' ? el.editor.value.replace(/\n/g, '\r\n') : el.editor.value }) });
    fileDirty = false;
    showEditor();
    showToast('Saved ' + openedFile);
  } catch (error) { showToast(error.message); }
}
function openChatSource() {
  const chat = currentChat();
  if (chat?.sourceFile) openFile(chat.sourceFile.path);
  else if (chat?.parentId) selectChat(chat.parentId);
}
function renderQuote(chat) {
  const hasSource = Boolean(chat?.selectedQuote || chat?.sourceFile);
  el.quote.hidden = !hasSource;
  el.chatOrigin.hidden = !hasSource;
  if (!hasSource) return;
  el.quoteText.textContent = chat.selectedQuote || 'Question about the whole file.';
  $('#quoteLabel').textContent = chat.sourceFile ? 'SOURCE FILE' : 'BRANCHED FROM SELECTION';
  el.quoteParent.textContent = chat.sourceFile ? 'Open file ↗' : 'Open parent ↗';
  const parent = appState.conversations.find(item => item.id === chat.parentId);
  const source = chat.sourceFile ? chat.sourceFile.path + (chat.sourceFile.line ? ':' + chat.sourceFile.line : '') : parent?.title || 'parent chat';
  el.chatOrigin.innerHTML = (chat.sourceFile ? 'From ' : 'Branched from ') + '<button type="button" id="originParent">' + escapeHtml(source) + '</button>';
  $('#originParent').addEventListener('click', openChatSource);
}
function renderChat(forceScroll = false) {
  const chat = currentChat();
  const changedChat = renderedChatId !== activeChatId;
  const stickToBottom = forceScroll || el.transcript.scrollHeight - el.transcript.scrollTop - el.transcript.clientHeight < 100;
  el.chatTitle.textContent = chat?.title || 'Research chat';
  el.turnState.textContent = chat?.busy ? 'Agent working…' : 'Ready';
  el.send.disabled = !chat || chat.busy || creatingChat;
  el.send.hidden = Boolean(chat?.busy);
  $('#stopButton').hidden = !chat?.busy;
  el.composer.disabled = !chat || creatingChat;
  el.composer.placeholder = chat?.busy ? 'Write your next message…' : 'Ask anything about your research…';
  renderQuote(chat);
  const messages = chat?.messages || [];
  el.emptyChat.hidden = messages.length > 0;
  el.emptyChat.querySelector('h3').textContent = chat?.sourceFile ? 'What would you like to know about this file?' : 'What are you working on?';
  el.emptyChat.querySelector('p').textContent = chat?.sourceFile ? (chat.selectedQuote ? 'The file path and selected passage are attached to this conversation. Ask your question below.' : 'The file path is attached to this conversation. Ask your question below.') : 'Talk to your agent. Select part of any answer to ask about it in a linked conversation.';
  el.emptyChat.querySelector('.starter-prompts').hidden = Boolean(chat?.sourceFile);
  if (changedChat) el.transcript.querySelectorAll('.chat-message').forEach(node => node.remove());
  const existing = new Map([...el.transcript.querySelectorAll('.chat-message')].map(node => [node.dataset.messageId, node]));
  const retained = new Set();
  for (const message of messages) {
    let wrapper = existing.get(message.id);
    const isNew = !wrapper;
    if (isNew) wrapper = document.createElement('article');
    retained.add(message.id);
    wrapper.className = 'chat-message ' + message.role + (message.status === 'error' ? ' error' : '');
    wrapper.dataset.messageId = message.id;
    const children = appState.conversations.filter(child => child.parentId === chat?.id && child.parentTurnId === message.turnId && (!child.parentMessageId || child.parentMessageId === message.id));
    const signature = JSON.stringify([message.text, message.status, message.turnId, children.map(child => [child.id, child.selectedQuote, child.selectedStart])]);
    if (!isNew && wrapper.dataset.signature === signature) continue;
    wrapper.dataset.signature = signature;
    wrapper.replaceChildren();
    if (message.role === 'assistant') {
      if (message.turnId) wrapper.dataset.turnId = message.turnId;
      const body = document.createElement('div');
      body.className = 'message-body';
      body.innerHTML = safeMarkdown(message.text || (message.status === 'streaming' ? '…' : ''));
      const unmatched = markLinkedPassages(body, message, children);
      wrapper.append(body);
      for (const child of unmatched) {
        const link = document.createElement('button');
        link.className = 'text-button';
        link.textContent = '↳ Follow-up: ' + child.selectedQuote.slice(0, 80);
        link.onclick = () => openBranchPopup([child.id]);
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
            selectedSpan = { turnId: message.turnId, messageId: message.id, start: text.length - text.trimStart().length, quote: text.trim().slice(0, 12000) };
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
    if (isNew) el.transcript.insertBefore(wrapper, el.emptyChat);
  }
  for (const [id, node] of existing) if (!retained.has(id)) node.remove();
  renderedChatId = activeChatId;
  if (changedChat) el.transcript.scrollTop = scrollPositions.get(activeChatId) ?? el.transcript.scrollHeight;
  else if (stickToBottom) el.transcript.scrollTop = el.transcript.scrollHeight;
  renderChatTree();
  renderBranchPopup();
  renderFilePreview();
}
async function selectChat(id) {
  $('#branchPopup').close();
  saveDraft();
  if (activeChatId) scrollPositions.set(activeChatId, el.transcript.scrollTop);
  activeChatId = id;
  const chat = currentChat();
  if (!chat) return;
  chat.lastUsedAt = new Date().toISOString();
  sessionWrite('activeChatId', id);
  selectedSpan = null;
  el.selectionAction.hidden = true;
  restoreDraft();
  setEditorOpen(false);
  closeNavigation();
  renderChat();
}
function activateNav(which) {
  const files = which === 'files';
  el.filesTab.classList.toggle('selected', files);
  el.chatsTab.classList.toggle('selected', !files);
  el.filesTab.setAttribute('aria-selected', String(files));
  el.chatsTab.setAttribute('aria-selected', String(!files));
  el.fileNav.hidden = !files;
  el.chatNav.hidden = files;
}
async function createChat() {
  if (creatingChat) return;
  saveDraft();
  const previousChatId = activeChatId;
  creatingChat = true;
  activeChatId = null;
  renderChat();
  try {
    const result = await api('/api/chat/new', { method: 'POST', body: '{}' });
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
    if (activeChatId) el.composer.focus();
  }
}
async function askAboutFile() {
  if (!openedFile || fileDirty || creatingChat) return;
  let span = selectedSpan?.filePath === openedFile ? selectedSpan : null;
  if (fileEditing && el.editor.selectionEnd > el.editor.selectionStart) {
    const start = el.editor.selectionStart, end = el.editor.selectionEnd;
    span = { filePath: openedFile, start, end, quote: el.editor.value.slice(start, end).trim() };
  }
  if (span && (!span.quote || span.quote.length > 12000)) { showToast('Select between 1 and 12,000 characters.'); return; }
  saveDraft();
  const path = openedFile;
  creatingChat = true;
  selectedSpan = null;
  el.selectionAction.hidden = true;
  renderChat(); showEditor();
  try {
    const result = await api('/api/chat/file', { method: 'POST', body: JSON.stringify({ path, wholeFile: !span,
      start: span?.start, end: span?.end, selectedQuote: span?.quote }) });
    appState.conversations.push(result.chat);
    await selectChat(result.chat.id);
    activateNav('chats');
    showToast('File linked. Ask your question below.');
  } catch (error) { showToast(error.message); }
  finally { creatingChat = false; renderChat(); showEditor(); el.composer.focus(); }
}
async function branchFromSelection() {
  if (selectedSpan?.filePath) { await askAboutFile(); return; }
  if (!selectedSpan || !activeChatId || creatingChat) return;
  saveDraft();
  const parentId = activeChatId;
  const span = selectedSpan;
  selectedSpan = null;
  el.selectionAction.hidden = true;
  creatingChat = true;
  renderChat();
  el.turnState.textContent = 'Opening linked chat…';
  try {
    const result = await api('/api/chat/branch', {
      method: 'POST',
      body: JSON.stringify({ parentId, turnId: span.turnId, selectedQuote: span.quote, parentMessageId: span.messageId, selectedStart: span.start }),
    });
    appState.conversations.push(result.chat);
    activeChatId = result.chat.id;
    sessionWrite('activeChatId', activeChatId);
    restoreDraft();
    setEditorOpen(false);
    closeNavigation();
    activateNav('chats');
    showToast('New linked chat. Ask your question below.');
  } catch (error) { showToast(error.message); }
  finally {
    creatingChat = false;
    renderChat();
    el.composer.focus();
  }
}
async function sendMessage(text = el.composer.value) {
  const chat = currentChat();
  if (!chat || chat.busy || creatingChat || !text.trim()) return;
  const question = text.trim();
  if (chat.title === 'New chat') chat.title = question.replace(/\s+/g, ' ').slice(0, 48) || 'Research chat';
  el.composer.value = '';
  sessionWrite('draft:' + chat.id, '');
  resizeComposer();
  chat.messages.push({ id: localId(), role: 'user', text: question, createdAt: new Date().toISOString() });
  chat.messages.push({ id: localId(), role: 'assistant', text: '', status: 'streaming' });
  chat.busy = true;
  pendingSends.add(chat.id);
  renderChat(true);
  try { await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ chatId: chat.id, text: question }) }); }
  catch (error) {
    chat.busy = false;
    const last = chat.messages.at(-1);
    if (last?.role === 'assistant') { last.status = 'error'; last.text = error.message; }
    showToast(error.message);
    if (activeChatId === chat.id && !el.composer.value) { el.composer.value = question; saveDraft(); resizeComposer(); }
    renderChat();
  } finally {
    pendingSends.delete(chat.id);
    refreshState().catch(() => {});
  }
}
async function stopResponse() {
  const chat = currentChat();
  if (!chat?.busy) return;
  try { await api('/api/chat/stop', { method: 'POST', body: JSON.stringify({ chatId: chat.id }) }); }
  catch (error) { showToast(error.message); }
}
function handleEvent(event) {
  if (event.type === 'agent-status') setAgentReady(event.ready, event.message || (event.ready ? 'Codex connected' : 'Agent offline'));
  if (event.type === 'agent-delta') {
    const chat = appState.conversations.find(item => item.id === event.chatId);
    if (chat) {
      let message = [...chat.messages].reverse().find(item => item.role === 'assistant' && (!item.turnId || item.turnId === event.turnId));
      if (!message) {
        message = { id: event.messageId || localId(), role: 'assistant', text: '', turnId: event.turnId, status: 'streaming' };
        chat.messages.push(message);
      }
      message.turnId = event.turnId;
      message.text += event.delta || '';
      message.status = 'streaming';
      if (chat.id === activeChatId) renderChat();
    }
  }
  if (event.type === 'message-started') {
    const chat = appState.conversations.find(item => item.id === event.chatId);
    if (chat) {
      const message = [...chat.messages].reverse().find(item => item.role === 'assistant' && item.status === 'streaming' && !item.turnId);
      if (message) { message.id = event.assistantMessageId; message.turnId = event.turnId; }
    }
  }
  if (event.type === 'turn-completed') {
    const chat = appState.conversations.find(item => item.id === event.chatId);
    if (chat) {
      chat.busy = false;
      const message = [...chat.messages].reverse().find(item => item.role === 'assistant' && (!event.turnId || item.turnId === event.turnId));
      if (message) message.status = event.status === 'completed' ? 'complete' : event.status === 'interrupted' ? 'stopped' : 'error';
      if (chat.id === activeChatId) renderChat();
    }
    refreshState().catch(() => {});
  }
  if (event.type === 'workspace-changed') {
    renderDirectory();
    if (openedFile && !fileDirty) openFile(openedFile, false);
  }
  if (event.type === 'approval-needed') {
    if (!pendingApprovals.some(item => item.id === event.id)) pendingApprovals.push(event);
    renderApproval();
  }
  renderBranchPopup();
  if (event.type === 'agent-log' && !appState.agentReady) setAgentReady(false, 'Agent starting…');
}
function renderApproval() {
  const current = pendingApprovals[0];
  el.approvalBar.hidden = !current;
  if (!current) return;
  const requested = current.params?.permissions ? 'Requested permissions: ' + JSON.stringify(current.params.permissions) : '';
  const command = current.params?.command?.join?.(' ') || current.params?.reason || current.params?.grantRoot || requested || current.method;
  el.approvalDescription.textContent = String(command || 'The agent requested permission to use a tool.').slice(0, 180);
}
async function resolveApproval(decision) {
  const current = pendingApprovals[0];
  if (!current) return;
  try {
    await api('/api/approval/' + encodeURIComponent(current.id), { method: 'POST', body: JSON.stringify({ decision }) });
    pendingApprovals.shift();
    renderApproval();
  } catch (error) { showToast(error.message); }
}
async function refreshState() {
  const latest = await api('/api/state');
  appState.workspace = latest.workspace;
  const old = new Map(appState.conversations.map(chat => [chat.id, chat]));
  appState.conversations = latest.conversations.map(chat => {
    const local = old.get(chat.id);
    if (local && pendingSends.has(chat.id)) return local;
    return chat;
  });
  el.workspace.textContent = latest.workspace;
  setAgentReady(latest.agentReady);
  renderChat();
}
function showSelectionAction() {
  if ($('#branchPopup').open) { el.selectionAction.hidden = true; return; }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    selectedSpan = null;
    $('#askFile').textContent = 'Ask about file ↗';
    el.selectionAction.hidden = true;
    return;
  }
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const preview = $('#filePreview');
  if (preview.contains(range.startContainer) && preview.contains(range.endContainer)) {
    if (fileDirty) { el.selectionAction.hidden = true; return; }
    const prefix = document.createRange();
    prefix.selectNodeContents(preview); prefix.setEnd(range.startContainer, range.startOffset);
    const start = passageText(prefix.cloneContents()).length;
    const raw = passageText(range.cloneContents());
    selectedSpan = { filePath: openedFile, start, end: start + raw.length, quote: raw.trim() };
    const rect = range.getBoundingClientRect();
    el.selectionAction.hidden = false;
    el.selectionAction.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 200)) + 'px';
    el.selectionAction.style.top = Math.max(8, rect.top - 44) + 'px';
    $('#askFile').textContent = 'Ask about selection ↗';
    return;
  }
  const message = node.nodeType === Node.ELEMENT_NODE ? node.closest?.('.chat-message.assistant') : node.parentElement?.closest('.chat-message.assistant');
  if (!message?.dataset.turnId || !message.closest('#transcript')) {
    el.selectionAction.hidden = true;
    return;
  }
  const rect = range.getBoundingClientRect();
  const body = message.querySelector('.message-body');
  if (!body?.contains(range.startContainer) || !body.contains(range.endContainer)) { el.selectionAction.hidden = true; return; }
  const prefix = document.createRange();
  prefix.selectNodeContents(body);
  prefix.setEnd(range.startContainer, range.startOffset);
  const raw = passageText(range.cloneContents());
  const quote = raw.trim().slice(0, 12000);
  if (!quote) { el.selectionAction.hidden = true; return; }
  selectedSpan = { quote, turnId: message.dataset.turnId, messageId: message.dataset.messageId,
    start: passageText(prefix.cloneContents()).length + raw.length - raw.trimStart().length };
  el.selectionAction.hidden = false;
  el.selectionAction.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 170)) + 'px';
  el.selectionAction.style.top = Math.max(8, rect.top - 39) + 'px';
}

$('#closeBranchPopup').addEventListener('click', () => $('#branchPopup').close());
$('#openBranchChat').addEventListener('click', () => { if (popupChatId) selectChat(popupChatId); });
$('#branchPopup').addEventListener('click', event => { if (event.target === $('#branchPopup')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });

$('#askFile').addEventListener('pointerdown', event => event.preventDefault());
$('#askFile').addEventListener('click', askAboutFile);
$('#toggleFileEdit').addEventListener('click', () => { fileEditing = !fileEditing; selectedSpan = null; el.selectionAction.hidden = true; showEditor(); });
for (const event of ['select', 'keyup', 'pointerup']) el.editor.addEventListener(event, () => {
  $('#askFile').textContent = el.editor.selectionEnd > el.editor.selectionStart ? 'Ask about selection ↗' : 'Ask about file ↗';
});
el.filesTab.addEventListener('click', () => activateNav('files'));
el.chatsTab.addEventListener('click', () => activateNav('chats'));
$('#refreshFiles').addEventListener('click', () => renderDirectory());
el.save.addEventListener('click', saveFile);
el.editor.addEventListener('input', () => { fileDirty = true; showEditor(); updateGutter(); });
el.editor.addEventListener('scroll', () => { el.lineNumbers.scrollTop = el.editor.scrollTop; });
$('#newChatButton').addEventListener('click', createChat);
$('#chatNewButton').addEventListener('click', createChat);
$('#chatNavNew').addEventListener('click', createChat);
$('#welcomeNewChat').addEventListener('click', createChat);
$('#welcomeOpenFile').addEventListener('click', () => activateNav('files'));
el.quoteParent.addEventListener('click', openChatSource);
$('#composerForm').addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
el.composer.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !currentChat()?.busy) { event.preventDefault(); sendMessage(); }
});
el.composer.addEventListener('input', () => { saveDraft(); resizeComposer(); });
$('#stopButton').addEventListener('click', stopResponse);
$('#closeEditor').addEventListener('click', () => setEditorOpen(false));
$('#toggleEditor').addEventListener('click', () => {
  const open = !document.body.classList.contains('editor-open');
  setEditorOpen(open);
  if (open) {
    activateNav('files');
    if (window.innerWidth <= 760) { document.body.classList.add('sidebar-open'); $('#sidebarScrim').hidden = false; }
    else document.body.classList.remove('sidebar-collapsed');
  }
});
$('#sidebarToggle').addEventListener('click', () => {
  const mobile = window.innerWidth <= 760;
  document.body.classList.toggle(mobile ? 'sidebar-open' : 'sidebar-collapsed');
  $('#sidebarScrim').hidden = !mobile || !document.body.classList.contains('sidebar-open');
  $('#sidebarToggle').setAttribute('aria-expanded', String(mobile ? document.body.classList.contains('sidebar-open') : !document.body.classList.contains('sidebar-collapsed')));
});
$('#sidebarScrim').addEventListener('click', closeNavigation);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeNavigation(); setEditorOpen(false); } });
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
window.addEventListener('resize', fitViewport);
fitViewport();
closeNavigation();
for (const prompt of document.querySelectorAll('[data-prompt]')) prompt.addEventListener('click', () => sendMessage(prompt.dataset.prompt));
el.selectionAction.addEventListener('pointerdown', event => event.preventDefault());
el.selectionAction.addEventListener('click', branchFromSelection);
$('#allowApproval').addEventListener('click', () => resolveApproval('allow'));
$('#declineApproval').addEventListener('click', () => resolveApproval('deny'));
document.addEventListener('selectionchange', showSelectionAction);
document.addEventListener('scroll', () => { el.selectionAction.hidden = true; }, true);

async function boot() {
  if (booting) return;
  booting = true;
  try {
  const latest = await api('/api/state');
  appState.workspace = latest.workspace;
  appState.conversations = latest.conversations;
  el.workspace.textContent = latest.workspace;
  setAgentReady(latest.agentReady);
  await renderDirectory();
  renderChatTree();
  showEditor();
  activateNav('chats');
  const selected = appState.conversations.find(chat => chat.id === sessionRead('activeChatId')) || [...appState.conversations].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0];
  if (selected) activeChatId = selected.id;
  else await createChat();
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
    try { handleEvent(JSON.parse(event.data)); }
    catch (error) { console.error('Could not handle app event', error); }
  };
  } catch (error) {
    setAgentReady(false, 'Connection error');
    connectionNotice(error.message);
  } finally { booting = false; }
}
$('#reconnectButton').addEventListener('click', boot);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshState().catch(error => connectionNotice(error.message));
});
boot();
