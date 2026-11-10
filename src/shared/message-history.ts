import type {
  ChatJob,
  ChatTurn,
  Conversation,
  MessageHistory,
  MessageRevision,
} from './notebook-api.js';

export function revisionsOf(
  message: MessageHistory & (ChatTurn | ChatJob),
): MessageRevision[] {
  if (message.revisions?.length) return message.revisions;
  if ('question' in message)
    return [{ id: message.id, text: message.question, author: 'user' }];
  return [{ id: message.id, text: message.answer, author: 'agent' }];
}

export function latestRevision(message: ChatTurn | ChatJob): MessageRevision {
  return revisionsOf(message).at(-1)!;
}

export function locateMessage(chat: Conversation, messageId: string) {
  for (const [index, turn] of chat.turns.entries()) {
    if (turn.id === messageId) return { turn, index, message: turn };
    const job = turn.jobs.find((attempt) => attempt.id === messageId);
    if (job) return { turn, index, message: job };
  }
}
