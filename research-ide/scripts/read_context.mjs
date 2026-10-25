import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultStatePath = path.join(here, '..', '.local', 'state.json');
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
const statePath = option('--state') || defaultStatePath;
const nodeId = option('--node-id');
const revisionId = option('--revision-id');
const chatId = option('--chat-id');
const query = option('--query');
const includeAncestors = args.includes('--ancestors');
if (!chatId || (!query && !includeAncestors && !nodeId)) {
  console.error('Usage: node research-ide/scripts/read_context.mjs --chat-id <id> [--state <state.json>] [--ancestors] [--query <words>] [--node-id <id> --revision-id <id>]');
  process.exitCode = 2;
} else {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const chats = Array.isArray(state.conversations) ? state.conversations : [];
    const byId = new Map(chats.map(chat => [chat.id, chat]));
    const active = byId.get(chatId);
    if (!active) throw new Error('No saved chat matches the supplied ID.');
    const result = { requestedChat: { id: active.id, title: active.title }, ancestors: [], matches: [] };
    if (nodeId) {
      const owner = chats.find(chat => chat.workspace === active.workspace && chat.messages?.some(node => node.id === nodeId));
      const node = owner?.messages.find(node => node.id === nodeId);
      if (!node) throw new Error('No saved node matches this ID in the workspace.');
      const revision = revisionId ? node.revisions?.find(item => item.id === revisionId) : null;
      if (revisionId && !revision) throw new Error('No revision matches this ID.');
      result.node = { chatId: owner.id, nodeId, role: node.role, revisionId: revision?.id || node.revisionId,
        text: revision?.text ?? node.text, annotations: node.annotations || [], revisions: node.revisions || [] };
    }
    if (includeAncestors) {
      const chain = [];
      let current = active;
      const seen = new Set([active.id]);
      while (current.parentId && chain.length < 20) {
        const parent = byId.get(current.parentId);
        if (!parent || parent.workspace !== active.workspace || seen.has(parent.id)) break;
        seen.add(parent.id);
        chain.push(parent);
        current = parent;
      }
      result.ancestors = chain.reverse().slice(-5).map(chat => ({
        id: chat.id,
        title: chat.title,
        selectedQuote: chat.selectedQuote || '',
        sourceFile: chat.sourceFile || null,
        messages: (chat.messages || []).slice(-6).map(message => ({ nodeId: message.id, revisionId: message.revisionId, annotations: message.annotations || [], role: message.role, text: String(message.text || '').slice(0, 1500), turnId: message.turnId || null })),
      }));
    }
    if (query) {
      const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const candidates = [];
      for (const chat of chats) {
        if (chat.workspace && chat.workspace !== active.workspace) continue;
        const parentTitles = [];
        let parent = byId.get(chat.parentId);
        const seen = new Set([chat.id]);
        while (parent && parentTitles.length < 12 && !seen.has(parent.id)) {
          seen.add(parent.id);
          parentTitles.unshift(parent.title);
          parent = byId.get(parent.parentId);
        }
        const haystacks = [chat.sourceFile?.path || '', chat.title, chat.selectedQuote || '', ...(chat.messages || []).flatMap(message => [message.text || '', ...(message.annotations || []).map(note => note.text)])];
        const score = terms.reduce((sum, term) => sum + (haystacks.some(value => String(value).toLocaleLowerCase().includes(term)) ? 1 : 0), 0);
        if (!score) continue;
        const excerpts = (chat.messages || []).filter(message => terms.some(term => String(message.text || '').toLocaleLowerCase().includes(term)))
          .slice(-3).map(message => ({ nodeId: message.id, revisionId: message.revisionId, annotations: message.annotations || [], role: message.role, text: String(message.text || '').slice(0, 1500), turnId: message.turnId || null }));
        candidates.push({ id: chat.id, title: chat.title, parentPath: parentTitles, sourceFile: chat.sourceFile || null, selectedQuote: chat.selectedQuote || '', score, excerpts });
      }
      result.matches = candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 6);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
