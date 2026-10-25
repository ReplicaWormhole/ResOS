import { safeMarkdown, safePlainMath } from './markdown.js';
import { markLinkedPassages } from './passages.js';

// Both views render the same saved nodes and expose the same notebook actions.
export function linkedChats(conversations, chat, message) {
  return conversations.filter(child => child.parentId === chat.id &&
    (child.parentMessageId ? child.parentMessageId === message.id : child.parentTurnId && child.parentTurnId === message.turnId));
}
export function renderMessage(article, { chat, message, conversations, onOpen, onAsk, onEdit, onRetry }) {
  article.className = 'chat-message ' + message.role + (message.status === 'error' ? ' error' : '');
  article.dataset.messageId = message.id;
  article.dataset.chatId = chat.id;
  article.dataset.revisionId = message.revisionId || '';
  if (message.turnId) article.dataset.turnId = message.turnId;
  const body = document.createElement('div');
  body.className = message.role === 'assistant' ? 'message-body' : 'message-bubble';
  if (message.role === 'assistant') body.innerHTML = safeMarkdown(message.text || (message.status === 'queued' ? 'Queued…' : 'Thinking…'));
  else body.innerHTML = safePlainMath(message.text);
  const children = linkedChats(conversations, chat, message);
  const unmatched = markLinkedPassages(body, message, children, onOpen);
  article.append(body);
  for (const child of unmatched) {
    const link = document.createElement('button');
    link.className = 'text-button';
    link.textContent = '↳ Follow-up: ' + child.selectedQuote.slice(0, 80) +
      (child.parentRevisionId && child.parentRevisionId !== message.revisionId ? ' (earlier revision)' : '');
    link.onclick = () => onOpen([child.id]);
    article.append(link);
  }
  for (const note of message.annotations || []) {
    const aside = document.createElement('aside');
    aside.className = 'node-annotation';
    const label = document.createElement('strong');
    label.textContent = 'Your note' + (note.revisionId !== message.revisionId ? ' · earlier revision' : '');
    const text = document.createElement('div'); text.innerHTML = safePlainMath(note.text);
    aside.append(label, text); article.append(aside);
  }
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const action = (label, handler) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = handler; actions.append(button);
  };
  if (!['streaming', 'queued'].includes(message.status)) {
    if (message.text) action('Ask about this ↗', () => onAsk(chat, message, body));
    if (message.revisionId) {
      action('Edit', () => onEdit(chat, message, 'revise'));
      action('Add note', () => onEdit(chat, message, 'annotate'));
      action('History' + ((message.revisions?.length || 0) > 1 ? ' (' + message.revisions.length + ')' : ''), () => onEdit(chat, message, 'history'));
    }
    if (message.jobId) action('Run context', () => onEdit(chat, message, 'job'));
    if (message.jobId && ['error', 'stopped'].includes(message.status)) action('Retry response', () => onRetry(chat, message));
    if (message.revisions?.at(-1)?.author === 'user' && message.role === 'assistant') {
      const label = document.createElement('span'); label.className = 'message-meta'; label.textContent = 'Edited by you'; actions.append(label);
    }
  } else {
    const label = document.createElement('span'); label.className = 'message-meta'; label.textContent = message.status === 'queued' ? 'Queued' : 'Agent working…'; actions.append(label);
  }
  article.append(actions);
}
