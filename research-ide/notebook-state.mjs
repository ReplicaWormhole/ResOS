import { randomUUID } from 'node:crypto';
import { markdownText } from './public/markdown.js';

const now = () => new Date().toISOString();
export function snapshotNode(message) {
  return { nodeId: message.id, revisionId: message.revisionId, role: message.role, author: message.revisions?.at(-1)?.author || message.role, text: message.text,
    annotations: structuredClone(message.annotations || []), status: message.status || 'complete' };
}
export function snapshotPath(chat, untilId) {
  const byId = new Map(chat.messages.map(message => [message.id, message]));
  let current = untilId ? byId.get(untilId) : chat.messages.at(-1);
  if (untilId && !current) throw new Error('Source message no longer exists.');
  const chain = [], seen = new Set();
  while (current) {
    if (seen.has(current.id)) throw new Error('The message path contains a cycle.');
    seen.add(current.id);
    if (!['streaming', 'queued'].includes(current.status) && (current.status !== 'error' || current.id === untilId)) chain.unshift(snapshotNode(current));
    current = byId.get(current.parentNodeId);
  }
  return [...structuredClone(chat.sourceContext || []), ...chain];
}
export function finalizeRevision(message, author = 'agent') {
  message.revisions ||= [];
  const revision = { id: randomUUID(), text: message.text, author, createdAt: now() };
  message.revisions.push(revision);
  message.revisionId = revision.id;
  return revision;
}
export function migrateNotebook(loaded, workspace) {
  if (!loaded || ![1, 2].includes(loaded.version) || !Array.isArray(loaded.conversations)) throw new Error('Unsupported notebook state.');
  const state = structuredClone(loaded);
  state.version = 2;
  state.jobs ||= [];
  for (const chat of state.conversations) {
    chat.workspace ||= loaded.workspace || workspace;
    chat.busy = false;
    chat.activeJobId = null;
    chat.activeTurnId = null;
    let previous = null;
    for (const message of chat.messages || []) {
      message.parentNodeId ??= previous || chat.parentMessageId || null;
      message.annotations ||= [];
      if (['streaming', 'queued'].includes(message.status)) {
        message.status = 'error';
        message.text += (message.text ? '\n\n' : '') + '[Response interrupted by restart. Use Retry response to run it again.]';
      }
      if (!message.revisionId) finalizeRevision(message, message.role === 'user' ? 'user' : 'agent');
      previous = message.id;
    }
    // Legacy sessions are provenance only: never resume or write to them again.
    if (chat.codexThreadId) chat.legacyThreadId ||= chat.codexThreadId;
    delete chat.codexThreadId;
  }
  const byId = new Map(state.conversations.map(chat => [chat.id, chat]));
  const resolving = new Set();
  function pinSource(chat) {
    if (chat.sourceContext) return;
    chat.sourceContext = [];
    if (!chat.parentId || resolving.has(chat.id)) return;
    resolving.add(chat.id);
    const parent = byId.get(chat.parentId);
    if (parent && parent.workspace === chat.workspace) {
      pinSource(parent);
      const source = parent.messages.find(message => message.id === chat.parentMessageId) ||
        [...parent.messages].reverse().find(message => message.turnId && message.turnId === chat.parentTurnId && message.role === 'assistant');
      if (source) {
        chat.parentMessageId = source.id;
        chat.parentRevisionId ||= source.revisionId;
        chat.sourceContext = snapshotPath(parent, source.id);
      }
    }
    resolving.delete(chat.id);
  }
  state.conversations.forEach(pinSource);
  for (const job of state.jobs) {
    if (['queued', 'running', 'starting'].includes(job.status)) {
      job.status = 'interrupted'; job.finishedAt = now(); job.error = 'Server restarted. Retry explicitly; tools may have partially run.';
    }
  }
  return state;
}
export function reviseNode(chat, messageId, baseRevisionId, text) {
  const message = chat.messages.find(item => item.id === messageId);
  if (!message) throw new Error('Message does not exist.');
  if (['streaming', 'queued'].includes(message.status)) throw new Error('Wait for the response to finish before editing it.');
  if (message.revisionId !== baseRevisionId) throw new Error('This message changed. Reopen the editor before saving.');
  message.text = text;
  finalizeRevision(message, 'user');
  return message;
}
export function branchChat(parent, body, id = randomUUID()) {
  const source = parent.messages.find(message => message.id === body.parentMessageId);
  if (!source) throw new Error('Select a saved message before branching.');
  if (['streaming', 'queued'].includes(source.status)) throw new Error('Wait for the response to finish before branching.');
  if (body.parentRevisionId && source.revisionId !== body.parentRevisionId) throw new Error('The source was edited. Select the passage again.');
  const text = source.role === 'assistant' ? markdownText(source.text) : source.text;
  const quote = body.selectedQuote?.trim();
  let start = body.selectedStart;
  if (!quote || quote.length > 12000) throw new Error('Select between 1 and 12,000 characters.');
  if (!Number.isInteger(start) || start < 0 || text.slice(start, start + quote.length) !== quote) {
    throw new Error('The selected passage changed. Select it again.');
  }
  return { id, workspace: parent.workspace, title: 'About: ' + quote.replace(/\s+/g, ' ').slice(0, 42),
    parentId: parent.id, parentMessageId: source.id, parentRevisionId: source.revisionId, parentTurnId: source.turnId || null,
    selectedQuote: quote, selectedStart: start, sourceContext: snapshotPath(parent, source.id),
    createdAt: now(), lastUsedAt: now(), messages: [] };
}
export function jobContext(chat, questionNode) {
  // The focal question is explicit, with the path and source quote supplied as data.
  const path = snapshotPath(chat, questionNode.id);
  const nodes = [], omitted = [];
  let budget = 90000;
  for (const node of [...path].reverse()) {
    const size = JSON.stringify(node).length;
    if (size > budget && node.nodeId !== questionNode.id) {
      omitted.push({ nodeId: node.nodeId, revisionId: node.revisionId });
      continue;
    }
    nodes.unshift(node); budget -= size;
  }
  return { version: 1, chatId: chat.id, focalNodeId: questionNode.id,
    omitted, sourceFile: chat.sourceFile || null, selectedQuote: chat.selectedQuote || '',
    source: chat.parentMessageId ? { nodeId: chat.parentMessageId, revisionId: chat.parentRevisionId || null } : null, nodes };
}
