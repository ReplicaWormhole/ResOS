import { isDeepStrictEqual } from 'node:util';
import {
  copyFileExcerpt,
  validFileExcerpt,
  validFileExcerpts,
  validFileSource,
} from '../shared/file-excerpt.js';
import { createHash, randomUUID } from 'node:crypto';
import { contextBefore } from '../notebook/chat-context.js';
import {
  addNote,
  checkText,
  discuss,
  findChat,
  revise,
  resolvePassage,
  validAddress,
} from '../notebook/discussions.js';
import type { NotebookStore } from '../notebook/notebook-store.js';
import {
  MAX_LOOKUP_QUERY,
  MAX_NOTEBOOK_LOOKUPS,
  notebookMatches,
} from '../notebook/lookup.js';
import { prepareContext } from '../notebook/prepare-context.js';
import type { ChatRequest, ChatRuntime } from '../runtime/chat-runtime.js';
import type { Project } from '../shared/desktop-api.js';
import type {
  ApprovalRequest,
  ChatJob,
  ChatTurn,
  ContextOptions,
  ContextPreview,
  HarnessCatalog,
  RunSettings,
  MessageAddress,
  Passage,
  Conversation,
  FileNote,
} from '../shared/notebook-api.js';

import { validRunSettings } from '../shared/run-settings.js';

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

function checkDraft(
  projectId: string,
  question: unknown,
  excerpts: unknown,
  passages: unknown,
) {
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > 12_000
  )
    throw new Error('Enter a question of at most 12,000 characters.');
  if (
    !validFileExcerpts(excerpts) ||
    excerpts.some((excerpt) => excerpt.projectId !== projectId)
  )
    throw new Error('Invalid file excerpt for this project.');
  if (!Array.isArray(passages) || passages.length > 5)
    throw new Error('Attach up to five chat passages.');
  return {
    question,
    excerpts: excerpts.map(copyFileExcerpt),
    passages: passages as unknown[],
  };
}

function resolveQuotes(
  chats: Conversation[],
  projectId: string,
  passages: unknown[],
): Passage[] {
  return passages.map((passage) => {
    if (!validAddress(passage)) throw new Error('Invalid passage address.');
    return resolvePassage(
      findChat(chats, projectId, passage.conversationId),
      passage as Passage,
    ).source;
  });
}

function previewId(
  cwd: string,
  prepared: ReturnType<typeof prepareContext>,
  settings?: RunSettings,
): string {
  return createHash('sha256')
    .update(JSON.stringify([cwd, prepared, settings]))
    .digest('hex');
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

  async createFileChat(
    projectId: string,
    source: unknown,
  ): Promise<Conversation> {
    if (
      !validFileSource(source) ||
      (source.excerpt && source.excerpt.projectId !== projectId)
    )
      throw new Error('Invalid file source for this project.');
    const { path, excerpt } = source;
    const chat = await this.notebook.change((chats) => {
      const created: Conversation = {
        id: randomUUID(),
        projectId,
        title: path.split('/').at(-1)!,
        turns: [],
        fileSource: {
          path,
          ...(excerpt ? { excerpt: copyFileExcerpt(excerpt) } : {}),
        },
      };
      chats.push(created);
      return created;
    });
    this.changed(projectId);
    return chat;
  }

  listFileNotes(projectId: string): Promise<FileNote[]> {
    return this.notebook.listFileNotes(projectId);
  }

  async addFileNote(
    projectId: string,
    excerpt: unknown,
    text: unknown,
  ): Promise<void> {
    checkText(text);
    if (!validFileExcerpt(excerpt) || excerpt.projectId !== projectId)
      throw new Error('Invalid file excerpt for this project.');
    await this.notebook.change((_chats, notes) => {
      notes.push({ id: randomUUID(), excerpt: copyFileExcerpt(excerpt), text });
    });
    this.changed(projectId);
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
    passage?: Passage,
  ): Promise<void> {
    if (!validAddress(address)) throw new Error('Invalid message address.');
    await this.notebook.change((chats) =>
      addNote(
        findChat(chats, projectId, address.conversationId),
        address,
        text,
        passage,
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

  async harnessCatalog(cwd: string): Promise<HarnessCatalog> {
    const models = this.runtime.listModels
      ? await this.runtime.listModels(cwd)
      : [];
    if (this.runtime.listModels && !models.length)
      throw new Error(
        'Codex did not advertise any text models. Check the CLI sign-in and refresh the catalog.',
      );
    return {
      harness: this.runtimeMode,
      modes: this.runtimeMode === 'codex' ? ['ask', 'agent'] : ['ask'],
      models,
      supportsNotebookLookup: this.supportsNotebookLookup(),
    };
  }

  private runSettings(value: unknown): RunSettings | undefined {
    if (value === undefined) return;
    if (!validRunSettings(value) || value.harness !== this.runtimeMode)
      throw new Error('The requested harness or run settings are unavailable.');
    const { harness, mode, model, effort } = value;
    return {
      harness,
      mode,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    };
  }

  supportsNotebookLookup(): boolean {
    return this.runtime.supportsNotebookLookup === true;
  }

  private defaultSettings(): RunSettings {
    return {
      harness: this.runtimeMode,
      mode: this.runtimeMode === 'codex' ? 'agent' : 'ask',
    };
  }

  private contextOptions(
    value: unknown,
  ): ContextOptions & { settings: RunSettings } {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid context settings.');
    const options = value as ContextOptions;
    if (
      typeof options.lookupEnabled !== 'boolean' ||
      (options.previewId !== undefined &&
        (typeof options.previewId !== 'string' ||
          !/^[a-f0-9]{64}$/.test(options.previewId)))
    )
      throw new Error('Invalid context settings.');
    if (options.lookupEnabled && !this.supportsNotebookLookup())
      throw new Error('This harness does not support notebook lookup.');
    return {
      lookupEnabled: options.lookupEnabled,
      previewId: options.previewId,
      settings: this.runSettings(options.settings) ?? this.defaultSettings(),
    };
  }

  async preview(
    project: Project,
    conversationId: string,
    question: unknown,
    excerpts: unknown,
    passages: unknown,
    rawOptions: unknown,
  ): Promise<ContextPreview> {
    const options = this.contextOptions(rawOptions);
    const draft = checkDraft(project.id, question, excerpts, passages);
    const chats = await this.notebook.list(project.id);
    const chat = findChat(chats, project.id, conversationId);
    const savedPassages = resolveQuotes(chats, project.id, draft.passages);
    const prepared = prepareContext(
      {
        question: draft.question,
        excerpts: draft.excerpts,
        context: contextBefore(chat),
        passages: savedPassages.length ? savedPassages : undefined,
        fileSource: chat.fileSource,
      },
      options.lookupEnabled,
      this.runtime.inputLimitBytes,
    );
    return {
      ...prepared.input,
      context: prepared.context,
      cwd: project.root,
      previewId: previewId(project.root, prepared, options.settings),
      settings: options.settings,
    };
  }

  async send(
    project: Project,
    conversationId: string,
    question: string,
    requestId: string,
    excerpts: unknown = [],
    passages: unknown = [],
    rawOptions: unknown = { lookupEnabled: false },
  ): Promise<void> {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128)
      throw new Error('Invalid request ID.');
    const options = this.contextOptions(rawOptions);
    const draft = checkDraft(project.id, question, excerpts, passages);
    const savedExcerpts = draft.excerpts;
    await this.notebook.change((chats) => {
      const chat = findChat(chats, project.id, conversationId);
      const savedPassages = resolveQuotes(chats, project.id, draft.passages);
      const existing = chat.turns.find(
        (turn) => turn.jobs[0]?.requestId === requestId,
      );
      if (existing) {
        if (
          existing.question !== question ||
          !isDeepStrictEqual(existing.excerpts ?? [], savedExcerpts) ||
          !isDeepStrictEqual(existing.passages ?? [], savedPassages) ||
          (existing.jobs[0]?.input?.lookupEnabled ?? false) !==
            options.lookupEnabled ||
          !isDeepStrictEqual(
            existing.jobs[0]?.settings ?? this.defaultSettings(),
            options.settings,
          )
        )
          throw new Error(
            'This request ID was already used for different input.',
          );
        return;
      }
      const prepared = prepareContext(
        {
          question,
          context: contextBefore(chat),
          excerpts: savedExcerpts,
          passages: savedPassages.length ? savedPassages : undefined,
          fileSource: chat.fileSource,
        },
        options.lookupEnabled,
        this.runtime.inputLimitBytes,
      );
      if (
        options.previewId &&
        options.previewId !==
          previewId(project.root, prepared, options.settings)
      )
        throw new Error(
          'The input changed after the preview. Review the refreshed context and send again.',
        );
      if (!chat.turns.length && !chat.source)
        chat.title = question.trim().split(/\s+/).join(' ').slice(0, 60);
      chat.turns.push({
        id: randomUUID(),
        question,
        ...(savedExcerpts.length ? { excerpts: savedExcerpts } : {}),
        ...(savedPassages.length ? { passages: savedPassages } : {}),
        jobs: [
          {
            id: randomUUID(),
            cwd: project.root,
            status: 'queued',
            runtime: this.runtimeMode,
            answer: '',
            requestId,
            queueOrder: nextQueueOrder(chats),
            context: prepared.context,
            input: prepared.input,
            settings: options.settings,
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
    rawSettings?: unknown,
  ): Promise<void> {
    const overrides = this.runSettings(rawSettings);
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
      if (original.input?.lookupEnabled && !this.supportsNotebookLookup())
        throw new Error(
          'This harness no longer supports the saved notebook lookup setting.',
        );
      if (
        !overrides &&
        original.runtime &&
        original.runtime !== this.runtimeMode
      )
        throw new Error(
          'The saved harness is unavailable. Choose available settings and start a new run.',
        );
      const saved =
        overrides ??
        this.runSettings(original.settings) ??
        this.defaultSettings();
      const model =
        saved.model ??
        (overrides ? undefined : original.effectiveSettings?.model);
      const effort =
        saved.effort ??
        (overrides ? undefined : original.effectiveSettings?.effort);
      const settings = model
        ? { ...saved, model, ...(effort ? { effort } : {}) }
        : saved;
      const savedContext = original.context ?? contextBefore(chat, index);
      const prepared = original.input
        ? { context: savedContext, input: original.input }
        : prepareContext(
            {
              question: turn.question,
              context: savedContext,
              excerpts: turn.excerpts,
              passages: turn.passages,
              fileSource: chat.fileSource,
            },
            false,
            this.runtime.inputLimitBytes,
          );
      turn.jobs.push({
        id: randomUUID(),
        cwd: project.root,
        status: 'queued',
        runtime: this.runtimeMode,
        answer: '',
        retryOf: original.id,
        queueOrder: nextQueueOrder(chats),
        context: prepared.context,
        input: prepared.input,
        settings,
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
      ...(turn.excerpts?.length ? { excerpts: turn.excerpts } : {}),
      ...(turn.passages?.length ? { passages: turn.passages } : {}),
      ...(chat.fileSource ? { fileSource: chat.fileSource } : {}),
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
    let lookupCount = 0;
    try {
      this.changed(projectId);
      for await (const chunk of this.runtime.stream(request, {
        signal,
        initialInput: job.input?.initialText,
        settings: job.settings ?? this.defaultSettings(),
        ...(job.input?.lookupEnabled && this.supportsNotebookLookup()
          ? {
              lookupNotebook: async (rawQuery: string) => {
                signal.throwIfAborted();
                const query = rawQuery.trim();
                if (!query || query.length > MAX_LOOKUP_QUERY)
                  throw new Error(
                    'Enter a notebook query of at most 160 characters.',
                  );
                if (lookupCount >= MAX_NOTEBOOK_LOOKUPS)
                  throw new Error(
                    'This run reached its notebook lookup limit.',
                  );
                lookupCount++;
                const matches = notebookMatches(
                  await this.notebook.list(projectId),
                  query,
                  turn.id,
                );
                signal.throwIfAborted();
                await update((entry) =>
                  (entry.lookups ??= []).push({ query, matches }),
                );
                signal.throwIfAborted();
                return matches;
              },
            }
          : {}),
        identify: (threadId, turnId, effective) =>
          update((entry) => {
            entry.threadId = threadId;
            entry.turnId = turnId;
            if (effective) entry.effectiveSettings = effective;
            if (job.input) entry.submittedAt = new Date().toISOString();
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
