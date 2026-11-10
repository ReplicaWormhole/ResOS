import { MAX_FILE_EXCERPTS } from '../shared/file-excerpt.js';
import {
  latestRevision,
  locateMessage,
  revisionsOf,
} from '../shared/message-history.js';
import type {
  ApprovalRequest,
  ChatApi,
  ChatJob,
  ChatTurn,
  Conversation,
  FileExcerpt,
  MessageAddress,
  MessageRevision,
} from '../shared/notebook-api.js';
import { renderRichText } from './rich-text.js';

const noExcerpts: FileExcerpt[] = [];

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
  private readonly scrollPositions = new Map<string, number>();
  private readonly openRecords = new Set<string>();
  private root = '';
  private approvals: ApprovalRequest[] = [];
  private readonly activeChat = new Map<string, string>();
  private readonly drafts = new Map<string, string>();
  private readonly draftExcerpts = new Map<string, FileExcerpt[]>();
  private readonly excerptDraft =
    document.querySelector<HTMLElement>('#draft-excerpts')!;
  private readonly excerptLinks: {
    button: HTMLButtonElement;
    excerpt: FileExcerpt;
  }[] = [];
  private excerptCheck = 0;
  private readonly requestIds = new Map<
    string,
    { question: string; excerpts: FileExcerpt[]; id: string }
  >();
  private readonly submitting = new Set<string>();
  private projectId?: string;
  private chats: Conversation[] = [];
  private available = false;
  private request = 0;

  constructor(
    private readonly api: ChatApi,
    private readonly excerptNavigation: {
      canJump(excerpt: FileExcerpt): Promise<boolean>;
      jump(excerpt: FileExcerpt): Promise<boolean>;
    },
  ) {
    window.setInterval(() => void this.refreshExcerptLinks(), 1500);
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
      this.navigate(this.selector.value);
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

  async attachExcerpt(excerpt: FileExcerpt): Promise<void> {
    const id = this.projectId;
    if (!id || id !== excerpt.projectId || !this.available)
      throw new Error('The excerpt belongs to another project.');
    let chat = this.current;
    if (!chat) {
      chat = await this.api.createChat(id);
      if (this.projectId !== id) return;
      this.activeChat.set(id, chat.id);
      await this.refresh(id);
    }
    const excerpts = this.draftExcerpts.get(chat.id) ?? noExcerpts;
    if (excerpts.length >= MAX_FILE_EXCERPTS)
      throw new Error('Remove an excerpt before adding another.');
    this.draftExcerpts.set(chat.id, [...excerpts, excerpt]);
    if (this.current?.id === chat.id) {
      this.renderDraftExcerpts();
      this.input.focus();
    }
  }

  async refreshExcerptLinks(hide = false): Promise<void> {
    const check = ++this.excerptCheck;
    await Promise.all(
      this.excerptLinks.map(async ({ button, excerpt }) => {
        if (hide) button.hidden = true;
        const matches =
          this.available && (await this.excerptNavigation.canJump(excerpt));
        if (check === this.excerptCheck && button.isConnected)
          button.hidden = !matches;
      }),
    );
  }

  private excerptCard(excerpt: FileExcerpt): HTMLElement {
    const section = document.createElement('section');
    section.className = 'file-excerpt';
    const label = document.createElement('strong');
    label.textContent =
      excerpt.path +
      ':' +
      excerpt.startLine +
      (excerpt.startLine !== excerpt.endLine ? '–' + excerpt.endLine : '') +
      (excerpt.unsaved ? ' · Unsaved buffer' : ' · Saved file');
    label.title = excerpt.capturedAt;
    const text = document.createElement('pre');
    text.textContent = excerpt.text;
    section.append(label, text);
    return section;
  }

  private renderDraftExcerpts(): void {
    this.excerptDraft.replaceChildren();
    const chat = this.current;
    if (!chat) return;
    for (const excerpt of this.draftExcerpts.get(chat.id) ?? []) {
      const card = this.excerptCard(excerpt);
      card.append(
        this.action('Remove excerpt', async () => {
          const rest = (this.draftExcerpts.get(chat.id) ?? []).filter(
            (item) => item !== excerpt,
          );
          this.draftExcerpts.set(chat.id, rest);
          this.renderDraftExcerpts();
        }),
      );
      this.excerptDraft.append(card);
    }
  }

  private renderSavedExcerpt(excerpt: FileExcerpt): HTMLElement {
    const card = this.excerptCard(excerpt);
    const button = this.action('Jump to file excerpt', async () => {
      if (!(await this.excerptNavigation.jump(excerpt))) {
        button.hidden = true;
        throw new Error(
          'The captured source no longer matches the current buffer or file.',
        );
      }
    });
    button.hidden = true;
    card.append(button);
    this.excerptLinks.push({ button, excerpt });
    return card;
  }

  show(projectId: string, root: string): void {
    this.root = root;
    if (this.projectId !== projectId) {
      this.rememberScroll();
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

  private rememberScroll(): void {
    const chat = this.current;
    if (chat) this.scrollPositions.set(chat.id, this.transcript.scrollTop);
  }

  private navigate(chatId: string): void {
    if (!this.projectId) return;
    this.rememberScroll();
    this.activeChat.set(this.projectId, chatId);
    this.error.hidden = true;
    this.render(true);
  }

  private mainChat(chat: Conversation): Conversation {
    const visited = new Set<string>();
    while (chat.source && !visited.has(chat.id)) {
      visited.add(chat.id);
      const parent = this.chats.find(
        (item) => item.id === chat.source?.conversationId,
      );
      if (!parent) break;
      chat = parent;
    }
    return chat;
  }

  private render(switched: boolean): void {
    const chat = this.current;
    const mainChats = this.chats.filter((conversation) => !conversation.source);
    const options = [...this.selector.options];
    if (
      options.length !== mainChats.length ||
      mainChats.some(
        (item, index) =>
          options[index]?.value !== item.id ||
          options[index]?.textContent !== item.title,
      )
    ) {
      this.selector.replaceChildren(
        ...mainChats.map((conversation) => {
          const option = document.createElement('option');
          option.value = conversation.id;
          option.textContent = conversation.title;
          return option;
        }),
      );
    }
    this.selector.disabled = !mainChats.length;
    if (chat) this.selector.value = this.mainChat(chat).id;

    const previousScroll = this.transcript.scrollTop;
    const atEnd =
      this.transcript.scrollHeight -
        this.transcript.clientHeight -
        previousScroll <
      24;
    this.transcript.replaceChildren();
    this.excerptLinks.length = 0;
    if (chat?.source) this.transcript.append(this.renderSource(chat));
    if (!chat?.turns.length) {
      const empty = document.createElement('p');
      empty.textContent = chat
        ? 'Send a message to start this conversation.'
        : 'Create a chat to get started.';
      this.transcript.append(empty);
    }
    for (const turn of chat?.turns ?? []) {
      this.transcript.append(this.renderMessage(chat!, turn, 'You'));
      for (const job of turn.jobs) {
        this.transcript.append(this.renderJob(chat!, turn, job));
      }
    }
    this.renderApprovals();
    this.renderSearch();
    this.renderDraftExcerpts();
    void this.refreshExcerptLinks();
    this.transcript.scrollTop = switched
      ? ((chat && this.scrollPositions.get(chat.id)) ??
        this.transcript.scrollHeight)
      : atEnd
        ? this.transcript.scrollHeight
        : previousScroll;
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
    const answer = this.renderMessage(
      chat,
      job,
      job.runtime === 'codex' ? 'Codex' : 'ResOS demo',
      job.status === 'queued'
        ? 'Queued…'
        : live
          ? 'Generating…'
          : 'No response saved.',
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
        excerpts: turn.excerpts ?? [],
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
          ...[turn, ...turn.jobs].flatMap((message) => [
            ...revisionsOf(message).map((revision) => revision.text),
            ...('question' in message
              ? (message.excerpts ?? []).map((excerpt) => excerpt.text)
              : []),
            ...(message.notes ?? []).map((note) => note.text),
          ]),
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

  private renderSource(chat: Conversation): HTMLElement {
    const source = chat.source!;
    const parent = this.chats.find((item) => item.id === source.conversationId);
    const message = parent && locateMessage(parent, source.messageId)?.message;
    const revision =
      message &&
      revisionsOf(message).find((item) => item.id === source.revisionId);
    const header = document.createElement('section');
    header.className = 'discussion-source';
    const heading = document.createElement('strong');
    heading.textContent = 'Discussion source';
    const quote = document.createElement('blockquote');
    quote.append(renderRichText(source.quote).root);
    header.append(heading, quote);
    if (parent)
      header.append(
        this.action('Back to parent', async () => this.navigate(parent.id)),
      );
    if (revision) {
      const details = document.createElement('details');
      const label = document.createElement('summary');
      label.textContent = 'Source revision';
      const raw = document.createElement('pre');
      raw.textContent = revision.text;
      details.append(label, raw);
      header.append(details);
    }
    return header;
  }

  private renderMessage(
    chat: Conversation,
    message: ChatTurn | ChatJob,
    author: string,
    empty = '',
  ): HTMLElement {
    const current = latestRevision(message);
    const address: MessageAddress = {
      conversationId: chat.id,
      messageId: message.id,
      revisionId: current.id,
    };
    const linked = this.chats.filter(
      (item) =>
        item.source?.conversationId === chat.id &&
        item.source.messageId === message.id,
    );
    const rich = renderRichText(
      current.text || empty,
      linked.flatMap((item) =>
        item.source?.revisionId === current.id ? [item.source] : [],
      ),
    );
    const article = document.createElement('article');
    article.dataset.messageId = message.id;
    article.dataset.revisionId = current.id;
    const heading = document.createElement('strong');
    heading.textContent = author;
    article.append(heading, rich.root);
    if ('question' in message) {
      for (const excerpt of message.excerpts ?? [])
        article.append(this.renderSavedExcerpt(excerpt));
    }

    for (const discussion of linked) {
      const source = discussion.source!;
      article.append(
        this.action(
          'Open discussion · ' +
            source.quote.slice(0, 48) +
            (source.revisionId === current.id ? '' : ' · earlier revision'),
          async () => this.navigate(discussion.id),
        ),
      );
    }
    for (const note of message.notes ?? []) {
      const section = document.createElement('section');
      section.className = 'chat-note';
      const label = document.createElement('strong');
      label.textContent =
        note.revisionId === current.id
          ? 'Your note'
          : 'Your note · earlier revision';
      section.append(label, renderRichText(note.text).root);
      article.append(section);
    }

    if ('status' in message && ['queued', 'running'].includes(message.status))
      return article;
    const ask = this.action('Ask about selection', async () => {
      const selected = window.getSelection();
      const range = selected?.rangeCount
        ? rich.selection(selected.getRangeAt(0))
        : undefined;
      if (!range || !current.text.slice(range.start, range.end).trim()) {
        throw new Error('Select a passage in this message first.');
      }
      this.rememberScroll();
      const discussion = await this.api.createDiscussion(chat.projectId, {
        ...address,
        ...range,
        quote: current.text.slice(range.start, range.end),
      });
      if (this.current?.id === chat.id) {
        this.activeChat.set(chat.projectId, discussion.id);
        await this.refresh(chat.projectId);
        this.input.focus();
      }
    });
    ask.addEventListener('pointerdown', (event) => event.preventDefault());
    if (current.text) article.append(ask);
    article.append(
      this.action('Edit message', async () =>
        this.editMessage(chat.projectId, address, current.text),
      ),
      this.action('Add note', async () =>
        this.editMessage(chat.projectId, address),
      ),
      this.action('Revision history', async () =>
        this.showHistory(revisionsOf(message)),
      ),
    );
    return article;
  }

  private dialog(title: string): {
    dialog: HTMLDialogElement;
    close: HTMLButtonElement;
  } {
    const dialog = document.createElement('dialog');
    dialog.className = 'message-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.append(heading);
    document.body.append(dialog);
    return { dialog, close };
  }

  private editMessage(
    projectId: string,
    address: MessageAddress,
    value?: string,
  ): void {
    const title = value === undefined ? 'Add note' : 'Edit message';
    const { dialog, close } = this.dialog(title);
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', title);
    input.value = value ?? '';
    input.rows = 7;
    input.maxLength = 120_000;
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        if (value === undefined)
          await this.api.addMessageNote(projectId, address, input.value);
        else await this.api.reviseMessage(projectId, address, input.value);
        dialog.close();
      } catch (failure) {
        error.textContent =
          failure instanceof Error ? failure.message : String(failure);
        save.disabled = false;
      }
    });
    dialog.append(input, error, save, close);
    dialog.showModal();
    input.focus();
  }

  private showHistory(revisions: MessageRevision[]): void {
    const { dialog, close } = this.dialog('Revision history');
    for (const [index, revision] of revisions.entries()) {
      const label = document.createElement('h3');
      label.textContent = 'Revision ' + (index + 1) + ' · ' + revision.author;
      const source = document.createElement('pre');
      source.textContent = revision.text;
      dialog.append(label, source);
    }
    dialog.append(close);
    dialog.showModal();
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
      if (this.projectId === id) this.rememberScroll();
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
      const excerpts = this.draftExcerpts.get(chat.id) ?? noExcerpts;
      if (request?.question !== question || request?.excerpts !== excerpts) {
        request = { question, excerpts, id: crypto.randomUUID() };
        this.requestIds.set(chat.id, request);
      }
      await this.api.sendChat(id, chat.id, question, request.id, excerpts);
      this.requestIds.delete(chat.id);
      if (this.draftExcerpts.get(chat.id) === excerpts)
        this.draftExcerpts.delete(chat.id);
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
