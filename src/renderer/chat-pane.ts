import type {
  ApprovalRequest,
  ChatApi,
  ChatJob,
  ChatTurn,
  Conversation,
} from '../shared/notebook-api.js';

export class ChatPane {
  private readonly selector =
    document.querySelector<HTMLSelectElement>('#chat-list')!;
  private readonly transcript =
    document.querySelector<HTMLElement>('#chat-transcript')!;
  private readonly input =
    document.querySelector<HTMLTextAreaElement>('#chat-input')!;
  private readonly sendButton =
    document.querySelector<HTMLButtonElement>('#chat-send')!;
  private readonly newButton =
    document.querySelector<HTMLButtonElement>('#new-chat')!;
  private readonly status =
    document.querySelector<HTMLElement>('#chat-status')!;
  private readonly error = document.querySelector<HTMLElement>('#chat-error')!;
  private readonly search =
    document.querySelector<HTMLInputElement>('#chat-search')!;
  private readonly results = document.querySelector<HTMLElement>(
    '#chat-search-results',
  )!;
  private readonly approvalPanel =
    document.querySelector<HTMLElement>('#chat-approvals')!;
  private readonly openRecords = new Set<string>();
  private root = '';
  private approvals: ApprovalRequest[] = [];
  private readonly activeChat = new Map<string, string>();
  private readonly drafts = new Map<string, string>();
  private readonly requestIds = new Map<
    string,
    { question: string; id: string }
  >();
  private readonly submitting = new Set<string>();
  private projectId?: string;
  private chats: Conversation[] = [];
  private available = false;
  private request = 0;

  constructor(private readonly api: ChatApi) {
    void api
      .chatRuntime()
      .then((mode) => {
        document.querySelector('#chat-runtime')!.textContent =
          mode === 'demo'
            ? 'Demo runtime · Responses are generated locally.'
            : 'Codex · Messages and saved context are sent to your configured model service.';
        this.render(false);
      })
      .catch((error: unknown) => this.showError(error));
    this.search.addEventListener('input', () => this.renderSearch());
    this.newButton.addEventListener('click', () => void this.create());
    this.selector.addEventListener('change', () => {
      if (!this.projectId) return;
      this.activeChat.set(this.projectId, this.selector.value);
      this.error.hidden = true;
      this.render(true);
    });
    this.input.addEventListener('input', () => {
      if (this.current) this.drafts.set(this.current.id, this.input.value);
      this.renderComposer();
    });
    document
      .querySelector('#chat-composer')!
      .addEventListener('submit', (event) => {
        event.preventDefault();
        void this.send();
      });
    api.onChatChanged((id) => {
      if (this.projectId === id) void this.refresh(id);
    });
  }

  show(projectId: string, root: string): void {
    this.root = root;
    if (this.projectId !== projectId) {
      this.projectId = projectId;
      this.available = false;
      this.chats = [];
      this.approvals = [];
      this.search.value = '';
      this.error.hidden = true;
      this.render(true);
    }
    void this.refresh(projectId);
  }

  setAvailable(available: boolean): void {
    this.available = available;
    this.render(false);
  }

  private get current(): Conversation | undefined {
    const id = this.projectId && this.activeChat.get(this.projectId);
    return this.chats.find((chat) => chat.id === id);
  }

  private async refresh(projectId: string): Promise<void> {
    const request = ++this.request;
    try {
      const [chats, approvals] = await Promise.all([
        this.api.listChats(projectId),
        this.api.listApprovals(projectId),
      ]);
      if (this.projectId !== projectId || request !== this.request) return;
      const previous = this.current?.id;
      this.chats = chats;
      this.approvals = approvals;
      if (!this.current && chats[0])
        this.activeChat.set(projectId, chats[0].id);
      this.render(previous !== this.current?.id);
    } catch (error) {
      if (this.projectId === projectId && request === this.request)
        this.showError(error);
    }
  }

  private render(scrollToEnd: boolean): void {
    const chat = this.current;
    const options = [...this.selector.options];
    if (
      options.length !== this.chats.length ||
      this.chats.some(
        (item, index) =>
          options[index]?.value !== item.id ||
          options[index]?.textContent !== item.title,
      )
    ) {
      this.selector.replaceChildren(
        ...this.chats.map((conversation) => {
          const option = document.createElement('option');
          option.value = conversation.id;
          option.textContent = conversation.title;
          return option;
        }),
      );
    }
    this.selector.disabled = !this.chats.length;
    if (chat) this.selector.value = chat.id;

    const previousScroll = this.transcript.scrollTop;
    const atEnd =
      this.transcript.scrollHeight -
        this.transcript.clientHeight -
        previousScroll <
      24;
    this.transcript.replaceChildren();
    if (!chat?.turns.length) {
      const empty = document.createElement('p');
      empty.textContent = chat
        ? 'Send a message to start this conversation.'
        : 'Create a chat to get started.';
      this.transcript.append(empty);
    }
    for (const turn of chat?.turns ?? []) {
      this.transcript.append(this.message('You', turn.question));
      for (const job of turn.jobs) {
        this.transcript.append(this.renderJob(chat!, turn, job));
      }
    }
    this.renderApprovals();
    this.renderSearch();
    this.transcript.scrollTop =
      scrollToEnd || atEnd ? this.transcript.scrollHeight : previousScroll;
    const draft = (chat && this.drafts.get(chat.id)) || '';
    if (this.input.value !== draft) this.input.value = draft;
    this.renderComposer();
  }

  private action(label: string, run: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      this.error.hidden = true;
      try {
        await run();
      } catch (error) {
        this.showError(error);
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  private renderJob(
    chat: Conversation,
    turn: ChatTurn,
    job: ChatJob,
  ): HTMLElement {
    const live = job.status === 'queued' || job.status === 'running';
    const answer = this.message(
      job.runtime === 'codex' ? 'Codex' : 'ResOS demo',
      job.answer ||
        (job.status === 'queued'
          ? 'Queued…'
          : live
            ? 'Generating…'
            : 'No response saved.'),
    );
    answer.dataset.status = job.status;
    if (job.status === 'interrupted' || job.status === 'failed') {
      const note = document.createElement('p');
      note.textContent = job.error ?? 'Response interrupted.';
      answer.append(note);
      if (this.available && turn.jobs.at(-1) === job) {
        answer.append(
          this.action('Retry response', async () => {
            const moved = this.root !== job.cwd;
            if (
              moved &&
              !window.confirm(
                'Run this attempt in the new project folder?\n' + this.root,
              )
            )
              return;
            await this.api.retryChat(chat.projectId, chat.id, job.id, moved);
          }),
        );
      }
    }
    if (live)
      answer.append(
        this.action('Stop response', () =>
          this.api.stopChat(chat.projectId, job.id),
        ),
      );

    const record = document.createElement('details');
    const label = document.createElement('summary');
    const data = document.createElement('pre');
    label.textContent = 'Run context';
    record.open = this.openRecords.has(job.id);
    record.addEventListener('toggle', () => {
      if (record.open) this.openRecords.add(job.id);
      else this.openRecords.delete(job.id);
    });
    data.textContent = JSON.stringify(
      {
        cwd: job.cwd,
        runtime: job.runtime ?? 'demo',
        status: job.status,
        requestId: job.requestId,
        retryOf: job.retryOf,
        threadId: job.threadId,
        turnId: job.turnId,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        question: turn.question,
        context: job.context ?? [],
      },
      null,
      2,
    );
    record.append(label, data);
    answer.append(record);
    return answer;
  }

  private renderApprovals(): void {
    const id = this.projectId;
    this.approvalPanel.replaceChildren();
    if (!id) return;
    for (const request of this.approvals) {
      const chat = this.chats.find((item) => item.id === request.chatId);
      const approval = this.message(
        'Approval requested · ' + request.kind,
        (chat ? 'Conversation: ' + chat.title + '\n' : '') + request.detail,
      );
      approval.append(
        this.action('Approve once', () =>
          this.api.decideApproval(id, request.id, true),
        ),
        this.action('Decline', () =>
          this.api.decideApproval(id, request.id, false),
        ),
      );
      this.approvalPanel.append(approval);
    }
  }

  private renderSearch(): void {
    this.results.replaceChildren();
    const query = this.search.value.trim().toLowerCase();
    const id = this.projectId;
    if (!query || !id) return;
    for (const chat of this.chats) {
      for (const turn of chat.turns) {
        const text = [
          turn.question,
          ...turn.jobs.map((job) => job.answer),
        ].find((value) => value.toLowerCase().includes(query));
        if (text === undefined) continue;
        const item = document.createElement('li');
        const index = text.toLowerCase().indexOf(query);
        item.append(
          this.action(
            chat.title +
              ' · ' +
              text.slice(Math.max(0, index - 24), index + 65),
            async () => {
              this.activeChat.set(id, chat.id);
              this.render(true);
            },
          ),
        );
        this.results.append(item);
        if (this.results.childElementCount === 20) return;
      }
    }
    if (!this.results.childElementCount) {
      const item = document.createElement('li');
      item.textContent = 'No matches in this project.';
      this.results.append(item);
    }
  }

  private message(author: string, text: string): HTMLElement {
    const article = document.createElement('article');
    const heading = document.createElement('strong');
    const body = document.createElement('p');
    heading.textContent = author;
    body.textContent = text;
    article.append(heading, body);
    return article;
  }

  private renderComposer(): void {
    const id = this.projectId;
    const busy = this.chats.some((chat) =>
      chat.turns.some((turn) =>
        turn.jobs.some(
          (job) => job.status === 'running' || job.status === 'queued',
        ),
      ),
    );
    this.input.disabled = !this.current;
    this.sendButton.disabled =
      !this.current ||
      !this.available ||
      Boolean(id && this.submitting.has(id)) ||
      !this.input.value.trim();
    this.status.textContent = !this.available
      ? 'Locate the project folder to send messages.'
      : busy
        ? 'Response in progress. New messages will queue.'
        : '';
  }

  private async create(): Promise<void> {
    const id = this.projectId;
    if (!id) return;
    this.newButton.disabled = true;
    this.error.hidden = true;
    try {
      const chat = await this.api.createChat(id);
      this.activeChat.set(id, chat.id);
      if (this.projectId === id) {
        await this.refresh(id);
        if (this.projectId === id) this.input.focus();
      }
    } catch (error) {
      if (this.projectId === id) this.showError(error);
    } finally {
      this.newButton.disabled = false;
    }
  }

  private async send(): Promise<void> {
    const id = this.projectId;
    const chat = this.current;
    const question = this.input.value;
    if (!id || !chat || this.sendButton.disabled) return;
    this.submitting.add(id);
    this.error.hidden = true;
    this.renderComposer();
    try {
      let request = this.requestIds.get(chat.id);
      if (request?.question !== question) {
        request = { question, id: crypto.randomUUID() };
        this.requestIds.set(chat.id, request);
      }
      await this.api.sendChat(id, chat.id, question, request.id);
      this.requestIds.delete(chat.id);
      if (this.drafts.get(chat.id) === question) this.drafts.delete(chat.id);
    } catch (error) {
      if (this.projectId === id) this.showError(error);
    } finally {
      this.submitting.delete(id);
      if (this.projectId === id) await this.refresh(id);
    }
  }

  private showError(error: unknown): void {
    this.error.textContent =
      error instanceof Error ? error.message : String(error);
    this.error.hidden = false;
  }
}
