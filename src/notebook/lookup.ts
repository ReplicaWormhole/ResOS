import { latestRevision } from '../shared/message-history.js';
import type { Conversation, NotebookMatch } from '../shared/notebook-api.js';

export const MAX_NOTEBOOK_LOOKUPS = 4;
export const MAX_LOOKUP_RESULTS = 5;
export const MAX_LOOKUP_QUERY = 160;

export function notebookMatches(
  chats: Conversation[],
  query: string,
  currentTurnId: string,
): NotebookMatch[] {
  const matches: NotebookMatch[] = [];
  const needle = new RegExp(query.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'iu');
  for (const chat of [...chats].reverse()) {
    for (const turn of [...chat.turns].reverse()) {
      if (turn.id === currentTurnId) continue;
      const job = turn.jobs.findLast(({ status }) => status === 'complete');
      for (const message of job ? [job, turn] : [turn]) {
        const revision = latestRevision(message);
        const index = revision.text.search(needle);
        if (index < 0) continue;
        const start = Math.max(0, index - 140);
        matches.push({
          conversationId: chat.id,
          messageId: message.id,
          revisionId: revision.id,
          author: revision.author,
          title: chat.title.slice(0, 120),
          excerpt: revision.text.slice(start, start + 600),
        });
        if (matches.length >= MAX_LOOKUP_RESULTS) return matches;
      }
    }
  }
  return matches;
}
