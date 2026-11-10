import { randomUUID } from 'node:crypto';
import { contextBefore } from '../notebook/chat-context.js';
import {
  addNote,
  discuss,
  findChat,
  revise,
  validAddress,
} from '../notebook/discussions.js';
import type { NotebookStore } from '../notebook/notebook-store.js';
import type { ChatRequest, ChatRuntime } from '../runtime/chat-runtime.js';
import type { Project } from '../shared/desktop-api.js';
import type {
  ApprovalRequest,
  ChatJob,
  ChatTurn,
  MessageAddress,
  Passage,
  Conversation,
} from '../shared/notebook-api.js';

interface ActiveJob {
  id?: string;
  readonly controller: AbortController;
  readonly approvals: Map<
    string,
    { request: ApprovalRequest; resolve: (accept: boolean) => void }
  >;
}

function attempts(chats: Conversation[]) {
  return chats.flatMap((chat) =>
    chat.turns.flatMap((turn) => turn.jobs.map((job) => ({ chat, turn, job }))),
  );
}

function nextQueueOrder(chats: Conversation[]): number {
  return (
    attempts(chats).reduce(
      (order, { job }) => Math.max(order, job.queueOrder ?? 0),
      0,
    ) + 1
  );
}

export class ChatService {
  private readonly active = new Map<string, ActiveJob>();
  private closing = false;

  constructor(
    private readonly notebook: NotebookStore,
    private readonly runtime: ChatRuntime,
    private readonly changed: (projectId: string) => void,
    private readonly runtimeMode: 'demo' | 'codex' = 'demo',
  ) {}

  list(projectId: string): Promise<Conversation[]> {
    return this.notebook.list(projectId);
  }

  create(projectId: string): Promise<Conversation> {
    return this.notebook.change((chats) => {
      const chat: Conversation = {
        id: randomUUID(),
        projectId,
        title: 'New chat',
        turns: [],
      };
      chats.push(chat);
      return chat;
    });
  }

  async reviseMessage(
    projectId: string,
    address: MessageAddress,
    text: string,
  ): Promise<void> {
    if (!validAddress(address)) throw new Error('Invalid message address.');
    await this.notebook.change((chats) =>
      revise(findChat(chats, projectId, address.conversationId), address, text),
    );
    this.changed(projectId);
  }

  async addMessageNote(
    projectId: string,
    address: MessageAddress,
    text: string,
  ): Promise<void> {
    if (!validAddress(address)) throw new Error('Invalid message address.');
    await this.notebook.change((chats) =>
      addNote(
        findChat(chats, projectId, address.conversationId),
        address,
        text,
      ),
    );
    this.changed(projectId);
  }

  async createDiscussion(
    projectId: string,
    passage: Passage,
  ): Promise<Conversation> {
    if (!validAddress(passage)) throw new Error('Invalid passage address.');
    const discussion = await this.notebook.change((chats) => {
      const branch = discuss(
        findChat(chats, projectId, passage.conversationId),
        passage,
      );
      chats.push(branch);
      return branch;
    });
    this.changed(projectId);
    return discussion;
  }

  isRunning(projectId: string): boolean {
    return this.active.has(projectId);
  }

  async send(
    project: Project,
    conversationId: string,
    question: string,
    requestId: string,
  ): Promise<void> {
    if (
      typeof question !== 'string' ||
      !question.trim() ||
      question.length > 12_000
    ) {
      throw new Error('Enter a question of at most 12,000 characters.');
    }
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128) {
      throw new Error('Invalid request ID.');
    }
    await this.notebook.change((chats) => {
      const chat = findChat(chats, project.id, conversationId);
      const existing = chat.turns.find(
        (turn) => turn.jobs[0]?.requestId === requestId,
      );
      if (existing) {
        if (existing.question !== question)
          throw new Error(
            'This request ID was already used for different input.',
          );
        return;
      }
      if (!chat.turns.length && !chat.source)
        chat.title = question.trim().split(/\s+/).join(' ').slice(0, 60);
      chat.turns.push({
        id: randomUUID(),
        question,
        jobs: [
          {
            id: randomUUID(),
            cwd: project.root,
            status: 'queued',
            runtime: this.runtimeMode,
            answer: '',
            requestId,
            queueOrder: nextQueueOrder(chats),
            context: contextBefore(chat),
          },
        ],
      });
    });
    this.start(project.id);
  }

  async retry(
    project: Project,
    chatId: string,
    jobId: string,
    confirmRelink: boolean,
  ): Promise<void> {
    await this.notebook.change((chats) => {
      const chat = findChat(chats, project.id, chatId);
      const index = chat.turns.findIndex(
        (turn) => turn.jobs.at(-1)?.id === jobId,
      );
      const turn = chat.turns[index];
      const original = turn?.jobs.at(-1);
      if (
        !turn ||
        !original ||
        !['failed', 'interrupted'].includes(original.status)
      ) {
        throw new Error(
          'Only the latest failed or interrupted attempt for a question can be retried.',
        );
      }
      if (project.root !== original.cwd && confirmRelink !== true) {
        throw new Error('Confirm the new project folder before retrying.');
      }
      turn.jobs.push({
        id: randomUUID(),
        cwd: project.root,
        status: 'queued',
        runtime: this.runtimeMode,
        answer: '',
        retryOf: original.id,
        queueOrder: nextQueueOrder(chats),
        context: original.context ?? contextBefore(chat, index),
      });
    });
    this.start(project.id);
  }

  async stop(projectId: string, jobId: string): Promise<void> {
    const stopActive = () => {
      const active = this.active.get(projectId);
      if (active?.id !== jobId) return false;
      active.controller.abort();
      this.clearApprovals(active);
      this.changed(projectId);
      return true;
    };
    if (stopActive()) return;
    const promoted = await this.notebook.change((chats) => {
      const entry = attempts(
        chats.filter((chat) => chat.projectId === projectId),
      ).find(({ job }) => job.id === jobId);
      if (entry?.job.status === 'running') return true;
      if (entry?.job.status !== 'queued')
        throw new Error('This job is no longer pending.');
      entry.job.status = 'interrupted';
      entry.job.finishedAt = new Date().toISOString();
      return false;
    });
    if (promoted) stopActive();
    else this.changed(projectId);
  }

  listApprovals(projectId: string): ApprovalRequest[] {
    return [...(this.active.get(projectId)?.approvals.values() ?? [])].map(
      ({ request }) => request,
    );
  }

  decideApproval(projectId: string, id: string, accept: boolean): void {
    const active = this.active.get(projectId);
    const approval = active?.approvals.get(id);
    if (!active || !approval)
      throw new Error(
        'This approval request is no longer pending in the selected project.',
      );
    active.approvals.delete(id);
    approval.resolve(accept);
    this.changed(projectId);
  }

  close(): void {
    this.closing = true;
    for (const active of this.active.values()) {
      active.controller.abort();
      this.clearApprovals(active);
    }
  }

  private clearApprovals(active: ActiveJob): void {
    for (const approval of active.approvals.values()) approval.resolve(false);
    active.approvals.clear();
  }

  private start(projectId: string): void {
    this.changed(projectId);
    if (this.active.has(projectId) || this.closing) return;
    const active: ActiveJob = {
      controller: new AbortController(),
      approvals: new Map(),
    };
    this.active.set(projectId, active);
    void this.drain(projectId, active).catch((error: unknown) =>
      console.error('Could not process the project queue:', error),
    );
  }

  private async drain(projectId: string, active: ActiveJob): Promise<void> {
    let drained = false;
    try {
      while (!this.closing) {
        const queued = attempts(await this.notebook.list(projectId))
          .filter(({ job }) => job.status === 'queued')
          .sort((a, b) => (a.job.queueOrder ?? 0) - (b.job.queueOrder ?? 0))[0];
        if (!queued) {
          drained = true;
          return;
        }
        const { chat, turn, job } = queued;
        const started = await this.notebook.change((chats) => {
          const live = findChat(chats, projectId, chat.id)
            .turns.find((item) => item.id === turn.id)
            ?.jobs.find((item) => item.id === job.id);
          if (live?.status !== 'queued') return false;
          live.status = 'running';
          live.startedAt = new Date().toISOString();
          active.id = job.id;
          return true;
        });
        if (!started) continue;
        await this.run(projectId, active, chat, turn, job);
        active = { controller: new AbortController(), approvals: new Map() };
        this.active.set(projectId, active);
      }
    } finally {
      this.active.delete(projectId);
      this.changed(projectId);
      if (
        drained &&
        !this.closing &&
        attempts(await this.notebook.list(projectId)).some(
          ({ job }) => job.status === 'queued',
        )
      ) {
        this.start(projectId);
      }
    }
  }

  private async run(
    projectId: string,
    active: ActiveJob,
    chat: Conversation,
    turn: ChatTurn,
    job: ChatJob,
  ): Promise<void> {
    const request: ChatRequest = {
      projectId,
      conversationId: chat.id,
      question: turn.question,
      cwd: job.cwd,
      context: job.context ?? [],
    };
    const update = async (apply: (entry: ChatJob) => void) => {
      await this.notebook.change((chats) => {
        const entry = findChat(chats, projectId, chat.id)
          .turns.find((item) => item.id === turn.id)
          ?.jobs.find((item) => item.id === job.id);
        if (!entry) throw new Error('Saved chat response is missing.');
        apply(entry);
      });
      this.changed(projectId);
    };
    const { signal } = active.controller;
    try {
      this.changed(projectId);
      for await (const chunk of this.runtime.stream(request, {
        signal,
        identify: (threadId, turnId) =>
          update((entry) => {
            entry.threadId = threadId;
            entry.turnId = turnId;
          }),
        approve: (detail, expires) => {
          if (signal.aborted || expires?.aborted) return Promise.resolve(false);
          const id = randomUUID();
          const cancel = () => {
            const pending = active.approvals.get(id);
            if (!pending) return;
            active.approvals.delete(id);
            pending.resolve(false);
            this.changed(projectId);
          };
          return new Promise<boolean>((resolve) => {
            active.approvals.set(id, {
              request: { ...detail, id, jobId: job.id, chatId: chat.id },
              resolve,
            });
            expires?.addEventListener('abort', cancel, { once: true });
            this.changed(projectId);
          }).finally(() => expires?.removeEventListener('abort', cancel));
        },
      })) {
        await update((entry) => {
          entry.answer += chunk;
        });
      }
      await update((entry) => {
        entry.status = signal.aborted ? 'interrupted' : 'complete';
        entry.finishedAt = new Date().toISOString();
      });
    } catch (error) {
      await update((entry) => {
        entry.finishedAt = new Date().toISOString();
        entry.status =
          signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
            ? 'interrupted'
            : 'failed';
        if (entry.status === 'failed')
          entry.error = error instanceof Error ? error.message : String(error);
      });
    } finally {
      this.clearApprovals(active);
      this.changed(projectId);
    }
  }
}
