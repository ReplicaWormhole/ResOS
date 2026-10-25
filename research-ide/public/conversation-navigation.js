// Follow-ups are opened from their source passages/files, not the main chat list.
export function mainConversationId(conversations, activeId) {
  const byId = new Map(conversations.map(chat => [chat.id, chat]));
  const visited = new Set();
  let chat = byId.get(activeId);
  while (chat?.parentId) {
    if (visited.has(chat.id)) return null;
    visited.add(chat.id);
    chat = byId.get(chat.parentId);
  }
  return chat && !chat.sourceFile ? chat.id : null;
}

export function mainConversations(conversations, activeId, readDraft = () => '') {
  const mainId = mainConversationId(conversations, activeId);
  return conversations.filter(chat => !chat.parentId && !chat.sourceFile && (
    chat.messages.length || chat.id === mainId || readDraft('draft:' + chat.id) ||
    conversations.some(child => child.parentId === chat.id)
  )).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}
