import type {
  ChatJob,
  ChatTurn,
  Conversation,
} from '../shared/notebook-api.js';
import { readJson, replaceJson } from '../storage/local-json.js';

interface NotebookData {
  version: 1;
  conversations: Conversation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPassage(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['conversationId', 'messageId', 'revisionId', 'quote'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    typeof value.start === 'number' &&
    Number.isSafeInteger(value.start) &&
    value.start >= 0 &&
    typeof value.end === 'number' &&
    Number.isSafeInteger(value.end) &&
    value.end > value.start
  );
}

function isContext(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.conversationId === 'string' &&
        typeof entry.turnId === 'string' &&
        typeof entry.question === 'string' &&
        ['answer', 'jobId', 'questionRevisionId', 'answerRevisionId'].every(
          (key) => entry[key] === undefined || typeof entry[key] === 'string',
        ) &&
        (entry.passage === undefined || isPassage(entry.passage)),
    )
  );
}

function isHistory(value: Record<string, unknown>): boolean {
  return (
    (value.revisions === undefined ||
      (Array.isArray(value.revisions) &&
        value.revisions.length > 0 &&
        value.revisions.every(
          (item) =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.text === 'string' &&
            (item.author === 'agent' || item.author === 'user') &&
            (item.createdAt === undefined ||
              typeof item.createdAt === 'string'),
        ))) &&
    (value.notes === undefined ||
      (Array.isArray(value.notes) &&
        value.notes.every(
          (note) =>
            isRecord(note) &&
            typeof note.id === 'string' &&
            typeof note.revisionId === 'string' &&
            typeof note.text === 'string',
        )))
  );
}

function isJob(value: unknown): value is ChatJob {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.cwd === 'string' &&
    typeof value.answer === 'string' &&
    (value.error === undefined || typeof value.error === 'string') &&
    ['startedAt', 'finishedAt', 'threadId', 'turnId'].every(
      (field) => value[field] === undefined || typeof value[field] === 'string',
    ) &&
    (value.runtime === undefined ||
      value.runtime === 'demo' ||
      value.runtime === 'codex') &&
    (value.requestId === undefined || typeof value.requestId === 'string') &&
    (value.queueOrder === undefined ||
      (typeof value.queueOrder === 'number' &&
        Number.isSafeInteger(value.queueOrder))) &&
    (value.retryOf === undefined || typeof value.retryOf === 'string') &&
    (value.context === undefined || isContext(value.context)) &&
    isHistory(value) &&
    (value.status === 'queued' ||
      value.status === 'running' ||
      value.status === 'complete' ||
      value.status === 'interrupted' ||
      value.status === 'failed')
  );
}

function isTurn(value: unknown): value is ChatTurn {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.question === 'string' &&
    isHistory(value) &&
    Array.isArray(value.jobs) &&
    value.jobs.length > 0 &&
    value.jobs.every(isJob)
  );
}

function isConversation(value: unknown): value is Conversation {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.title === 'string' &&
    (value.source === undefined ||
      (isRecord(value.source) &&
        isPassage(value.source) &&
        isContext(value.source.context))) &&
    Array.isArray(value.turns) &&
    value.turns.every(isTurn)
  );
}

export class NotebookStore {
  private pendingWrite: Promise<unknown> = Promise.resolve();
  private data?: NotebookData;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<NotebookData> {
    if (this.data) return this.data;
    const data = await readJson(this.filePath);
    if (data === undefined) return { version: 1, conversations: [] };
    if (
      !isRecord(data) ||
      data.version !== 1 ||
      !Array.isArray(data.conversations) ||
      !data.conversations.every(isConversation)
    ) {
      throw new Error('The saved notebook has an unsupported format.');
    }
    return { version: 1, conversations: data.conversations };
  }

  async list(projectId: string): Promise<Conversation[]> {
    await this.pendingWrite;
    return structuredClone(
      (await this.load()).conversations.filter(
        (chat) => chat.projectId === projectId,
      ),
    );
  }

  change<T>(update: (conversations: Conversation[]) => T): Promise<T> {
    const write = this.pendingWrite.then(async () => {
      const next = structuredClone(await this.load());
      const result = update(next.conversations);
      await replaceJson(this.filePath, next);
      this.data = next;
      return structuredClone(result);
    });
    this.pendingWrite = write.catch(() => {});
    return write;
  }

  async recover(): Promise<void> {
    const { conversations } = await this.load();
    if (
      !conversations.some((chat) =>
        chat.turns.some((turn) =>
          turn.jobs.some(
            (job) => job.status === 'running' || job.status === 'queued',
          ),
        ),
      )
    )
      return;
    await this.change((chats) => {
      for (const chat of chats) {
        for (const turn of chat.turns) {
          for (const job of turn.jobs) {
            if (job.status === 'running' || job.status === 'queued')
              job.status = 'interrupted';
          }
        }
      }
    });
  }
}
