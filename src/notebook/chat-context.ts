import { latestRevision } from '../shared/message-history.js';
import type { ContextEntry, Conversation } from '../shared/notebook-api.js';

export function contextBefore(
  chat: Conversation,
  index = chat.turns.length,
): ContextEntry[] {
  return [
    ...(chat.source?.context ?? []),
    ...chat.turns.slice(0, index).map((turn) => {
      const job = turn.jobs.findLast(
        (attempt) => attempt.status === 'complete',
      );
      const question = latestRevision(turn);
      const answer = job && latestRevision(job);
      return {
        conversationId: chat.id,
        turnId: turn.id,
        question: question.text,
        ...(turn.excerpts?.length ? { excerpts: turn.excerpts } : {}),
        ...(question.id !== turn.id ? { questionRevisionId: question.id } : {}),
        ...(job && answer
          ? {
              jobId: job.id,
              answer: answer.text,
              ...(answer.id !== job.id ? { answerRevisionId: answer.id } : {}),
            }
          : {}),
      };
    }),
  ];
}
