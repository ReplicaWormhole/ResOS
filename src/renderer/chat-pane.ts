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
  FileNote,
  FileSource,
  Passage,
  MessageAddress,
  MessageRevision,
} from '../shared/notebook-api.js';
import { renderRichText } from './rich-text.js';
import type { SelectionActions } from './selection-toolbar.js';

const noExcerpts: FileExcerpt[] = [];
const noPassages: Passage[] = [];

export class ChatPane {
  private readonly chatList = document.querySelector('#chat-list')!;
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
  private readonly parentChat =
    document.querySelector<HTMLElement>('#parent-chat')!;
  private readonly stage = document.querySelector<HTMLElement>('#chat-stage')!;
  private readonly sideActions =
    document.querySelector<HTMLElement>('#side-chat-actions')!;
  private readonly backButton =
    document.querySelector<HTMLButtonElement>('#side-chat-back')!;
  private readonly expandButton =
    document.querySelector<HTMLButtonElement>('#side-chat-expand')!;
  private readonly notesHost =
    document.querySelector<HTMLElement>('#file-notes')!;
  private readonly transcriptSignatures = new WeakMap<Element, string>();
  private readonly capturePassage = new WeakMap<
    Element,
    (range: Range) => Passage | undefined
  >();
  private readonly fileSides = new Map<
    string,
    {
      origin?: string;
      restore: () => void;
      expand: () => void;
      collapse: () => void;
    }
  >();
  private readonly expanded = new Set<string>();
  private parentSignature = '';
  private fileNotes: FileNote[] = [];
  private fileNotesSignature = '';
  private readonly draftPassages = new Map<string, Passage[]>();
  private readonly scrollPositions = new Map<string, number>();
  private readonly openRecords = new Set<string>();
  private readonly openMenus = new Set<string>();
  private root = '';
  private approvals: ApprovalRequest[] = [];
  private readonly activeChat = new Map<string, string>();
  private readonly drafts = new Map<string, string>();
  private readonly draftExcerpts = new Map<string, FileExcerpt[]>();
  private readonly excerptDraft =
    document.querySelector<HTMLElement>('#draft-excerpts')!;
  private excerptLinks: {
    button: HTMLButtonElement;
    excerpt: FileExcerpt;
  }[] = [];
  private excerptCheck = 0;
  private readonly requestIds = new Map<
    string,
    {
      question: string;
      excerpts: FileExcerpt[];
      passages: Passage[];
      id: string;
    }
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
    private readonly reveal: () => void,
    private readonly showNotes: (notes: FileNote[]) => void,
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
    this.backButton.addEventListener('click', () => {
      const chat = this.current;
      if (!chat) return;
      if (chat.source) this.navigate(chat.source.conversationId);
      else {
        const side = this.fileSides.get(chat.id);
        if (!side) return;
        this.fileSides.delete(chat.id);
        if (side.origin) this.navigate(side.origin);
        else if (this.projectId) {
          this.rememberScroll();
          this.activeChat.delete(this.projectId);
          this.render(true);
        }
        side.restore();
      }
    });
    this.expandButton.addEventListener('click', () => {
      const chat = this.current;
      if (!chat) return;
      const expand = !this.expanded.has(chat.id);
      if (expand) this.expanded.add(chat.id);
      else this.expanded.delete(chat.id);
      const fileSide = this.fileSides.get(this.mainChat(chat).id);
      this.preserveScroll(() => this.renderSide(chat));
      if (fileSide) {
        if (expand) fileSide.expand();
        else fileSide.collapse();
      }
    });
    this.search.addEventListener('input', () => this.renderSearch());
    this.newButton.addEventListener('click', () => void this.create());
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

  selection(range: Range): SelectionActions | undefined {
    const id = this.projectId;
    const start = range.startContainer;
    const root = (
      start instanceof Element ? start : start.parentElement
    )?.closest('.chat-rich');
    const passage = root && this.capturePassage.get(root)?.(range);
    if (!id || !passage) return;
    return {
      annotate: async () => this.editMessage(id, passage, undefined, passage),
      ask: async () => {
        const origin = this.current?.id;
        const discussion = await this.api.createDiscussion(id, passage);
        if (this.projectId !== id || this.current?.id !== origin) return;
        await this.openCreated(discussion);
      },
      add: async () => {
        if (!this.available || this.projectId !== id)
          throw new Error(
            'Locate the project folder before attaching a passage.',
          );
        const chat = this.current;
        if (!chat) return;
        const passages = this.draftPassages.get(chat.id) ?? noPassages;
        if (passages.length >= 5)
          throw new Error('Remove a passage before adding another.');
        this.draftPassages.set(chat.id, [...passages, passage]);
        this.renderDraftExcerpts();
        this.input.focus();
      },
    };
  }

  annotateFile(excerpt: FileExcerpt): void {
    this.editText(
      'Annotate file selection',
      '',
      (text) => this.api.addFileNote(excerpt.projectId, excerpt, text),
      excerpt.text,
    );
  }

  async openFile(
    projectId: string,
    source: FileSource,
    side: { restore: () => void; expand: () => void; collapse: () => void },
  ): Promise<void> {
    const origin = this.current?.id;
    const fileChat = await this.api.createFileChat(projectId, source);
    if (
      this.projectId !== projectId ||
      (this.current?.id !== origin && this.current?.id !== fileChat.id)
    )
      return;
    this.fileSides.set(fileChat.id, { ...side, origin });
    side.collapse();
    await this.openCreated(fileChat);
  }

  private async openCreated(chat: Conversation): Promise<void> {
    this.rememberScroll();
    this.activeChat.set(chat.projectId, chat.id);
    if (!this.chats.some(({ id }) => id === chat.id)) this.chats.push(chat);
    this.render(true);
    await this.refresh(chat.projectId);
    if (this.current?.id === chat.id) this.input.focus();
  }

  async attachExcerpt(excerpt: FileExcerpt): Promise<void> {
    const id = this.projectId;
    if (!id || id !== excerpt.projectId || !this.available)
      throw new Error('The excerpt belongs to another project.');
    let chat = this.current;
    if (!chat) {
      chat = await this.api.createChat(id);
      if (this.projectId !== id) return;
      await this.openCreated(chat);
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

  private passageCard(passage: Passage): HTMLElement {
    const section = document.createElement('section');
    section.className = 'file-excerpt';
    const label = document.createElement('strong');
    label.textContent =
      'Chat quote · ' +
      (this.chats.find((chat) => chat.id === passage.conversationId)?.title ??
        'Saved revision');
    const quote = document.createElement('blockquote');
    quote.append(renderRichText(passage.quote).root);
    section.append(label, quote);
    return section;
  }

  private renderDraftExcerpts(): void {
    this.excerptDraft.replaceChildren();
    const chat = this.current;
    if (!chat) return;
    for (const passage of this.draftPassages.get(chat.id) ?? []) {
      const card = this.passageCard(passage);
      card.append(
        this.action('Remove quote', async () => {
          this.draftPassages.set(
            chat.id,
            (this.draftPassages.get(chat.id) ?? []).filter(
              (item) => item !== passage,
            ),
          );
          this.renderDraftExcerpts();
        }),
      );
      this.excerptDraft.append(card);
    }
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
      this.fileNotes = [];
      this.showNotes(this.fileNotes);
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
      const [chats, approvals, notes] = await Promise.all([
        this.api.listChats(projectId),
        this.api.listApprovals(projectId),
        this.api.listFileNotes(projectId),
      ]);
      if (this.projectId !== projectId || request !== this.request) return;
      const previous = this.current?.id;
      this.chats = chats;
      this.approvals = approvals;
      this.fileNotes = notes;
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
    if (chat && this.transcript.clientHeight)
      this.scrollPositions.set(chat.id, this.transcript.scrollTop);
  }

  preserveScroll(updateLayout: () => void): void {
    this.rememberScroll();
    updateLayout();
    if (this.current && this.transcript.clientHeight) {
      this.transcript.scrollTop =
        this.scrollPositions.get(this.current.id) ??
        this.transcript.scrollHeight;
    }
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
    const buttons = this.chatList.querySelectorAll('button');
    if (
      buttons.length !== mainChats.length ||
      mainChats.some(
        (item, index) =>
          buttons[index]?.dataset.chatId !== item.id ||
          buttons[index]?.dataset.title !== item.title,
      )
    ) {
      this.chatList.replaceChildren(
        ...mainChats.map((conversation) => {
          const item = document.createElement('li');
          const button = this.action(conversation.title, async () => {
            this.reveal();
            this.fileSides.delete(conversation.id);
            this.navigate(conversation.id);
          });
          button.dataset.chatId = conversation.id;
          button.dataset.title = conversation.title;
          if (conversation.fileSource) {
            const badge = document.createElement('small');
            badge.className = 'file-badge';
            badge.textContent = 'File';
            button.setAttribute(
              'aria-label',
              conversation.title + ' · File chat',
            );
            button.append(badge);
          }
          button.title = conversation.title;
          item.append(button);
          return item;
        }),
      );
    }
    const mainId = chat && this.mainChat(chat).id;
    for (const button of this.chatList.querySelectorAll('button')) {
      if (button.dataset.chatId === mainId)
        button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }

    const previousScroll = this.transcript.scrollTop;
    const atEnd =
      this.transcript.scrollHeight -
        this.transcript.clientHeight -
        previousScroll <
      24;
    const selection = document.getSelection();
    const selecting =
      !!selection?.anchorNode &&
      !selection.isCollapsed &&
      this.transcript.contains(selection.anchorNode);
    this.renderTranscript(chat);
    this.renderSide(chat);
    this.renderFileNotes();
    this.excerptLinks = this.excerptLinks.filter(
      ({ button }) => button.isConnected,
    );
    this.renderApprovals();
    this.renderSearch();
    this.renderDraftExcerpts();
    void this.refreshExcerptLinks();
    this.transcript.scrollTop = switched
      ? ((chat && this.scrollPositions.get(chat.id)) ??
        this.transcript.scrollHeight)
      : atEnd && !selecting
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

  private linkedDiscussions(chatId: string, messageId: string): Conversation[] {
    return this.chats.filter(
      ({ source }) =>
        source?.conversationId === chatId && source.messageId === messageId,
    );
  }

  private renderTranscript(chat?: Conversation): void {
    const previous = new Map(
      [...this.transcript.children].map((node) => [
        (node as HTMLElement).dataset.row,
        node,
      ]),
    );
    let cursor = this.transcript.firstElementChild;
    const row = (name: string, data: unknown, create: () => HTMLElement) => {
      const key = (chat?.id ?? '') + ':' + name;
      const signature = JSON.stringify(data);
      const old = previous.get(key);
      let node = old;
      if (!node || this.transcriptSignatures.get(node) !== signature) {
        const created = create();
        created.dataset.row = key;
        this.transcriptSignatures.set(created, signature);
        if (old) {
          if (cursor === old) cursor = created;
          old.replaceWith(created);
        }
        node = created;
      }
      if (node === cursor) cursor = cursor.nextElementSibling;
      else this.transcript.insertBefore(node, cursor);
    };

    if (chat?.source) row('source', chat.source, () => this.renderSource(chat));
    if (chat?.fileSource)
      row('file', chat.fileSource, () =>
        this.renderFileSource(chat.fileSource!),
      );
    if (!chat?.turns.length)
      row('empty', null, () => {
        const empty = document.createElement('p');
        empty.textContent = chat
          ? 'Send a message to start this conversation.'
          : 'Create a chat to get started.';
        return empty;
      });
    for (const turn of chat?.turns ?? []) {
      row(
        'question:' + turn.id,
        [
          turn.question,
          turn.revisions,
          turn.notes,
          turn.excerpts,
          turn.passages,
          this.linkedDiscussions(chat!.id, turn.id).map(({ source }) => source),
        ],
        () => this.renderMessage(chat!, turn, 'You'),
      );
      for (const job of turn.jobs) {
        row(
          'job:' + job.id,
          [
            job,
            turn.question,
            turn.excerpts,
            turn.passages,
            this.available,
            turn.jobs.at(-1)?.id,
            this.linkedDiscussions(chat!.id, job.id).map(
              ({ source }) => source,
            ),
          ],
          () => this.renderJob(chat!, turn, job),
        );
      }
    }
    while (cursor) {
      const next = cursor.nextElementSibling;
      cursor.remove();
      cursor = next;
    }
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
        passages: turn.passages,
        fileSource: chat.fileSource,
        context: job.context ?? [],
      },
      null,
      2,
    );
    record.append(label, data);
    (answer.querySelector('.message-actions') ?? answer).append(record);
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
              this.reveal();
              this.navigate(chat.id);
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

  private renderFileNotes(): void {
    const signature = JSON.stringify(this.fileNotes);
    if (signature === this.fileNotesSignature) return;
    this.fileNotesSignature = signature;
    this.showNotes(this.fileNotes);
    this.notesHost.replaceChildren();
    if (!this.fileNotes.length) this.notesHost.textContent = 'No file notes.';
    for (const note of this.fileNotes) {
      const details = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = note.excerpt.path + ':' + note.excerpt.startLine;
      const body = document.createElement('p');
      body.textContent = note.text;
      details.append(title, this.renderSavedExcerpt(note.excerpt), body);
      this.notesHost.append(details);
    }
  }

  private renderFileSource(source: FileSource): HTMLElement {
    if (source.excerpt) return this.renderSavedExcerpt(source.excerpt);
    const card = document.createElement('p');
    card.className = 'discussion-source';
    card.textContent =
      'Saved file · ' + source.path + ' · Reads the current on-disk file';
    return card;
  }

  private renderSide(chat?: Conversation): void {
    const side = chat && (chat.source || this.fileSides.has(chat.id));
    const expanded = !!chat && this.expanded.has(chat.id);
    const parent =
      chat?.source &&
      this.chats.find(
        (candidate) => candidate.id === chat.source?.conversationId,
      );
    this.sideActions.hidden = !side;
    this.backButton.textContent = chat?.source
      ? 'Back to parent'
      : 'Back to file';
    this.expandButton.textContent = expanded ? 'Restore side chat' : 'Expand';
    this.parentChat.hidden = !parent || expanded;
    this.stage.dataset.side = String(!this.parentChat.hidden);
    if (!parent || expanded) {
      this.parentSignature = '';
      this.parentChat.replaceChildren();
      return;
    }
    const signature = JSON.stringify([
      parent,
      this.chats
        .filter((item) => item.source?.conversationId === parent.id)
        .map((item) => item.source),
    ]);
    if (signature === this.parentSignature) return;
    this.parentSignature = signature;
    const heading = document.createElement('h2');
    heading.textContent = parent.title;
    this.parentChat.replaceChildren(heading);
    if (parent.source) {
      const quote = document.createElement('blockquote');
      quote.append(renderRichText(parent.source.quote).root);
      this.parentChat.append(quote);
    }
    for (const turn of parent.turns) {
      this.parentChat.append(this.renderMessage(parent, turn, 'You', '', true));
      for (const job of turn.jobs) {
        this.parentChat.append(
          this.renderMessage(
            parent,
            job,
            job.runtime === 'codex' ? 'Codex' : 'ResOS demo',
            '',
            true,
          ),
        );
      }
    }
    this.parentChat.scrollTop = this.scrollPositions.get(parent.id) ?? 0;
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
    preview = false,
  ): HTMLElement {
    const current = latestRevision(message);
    const address: MessageAddress = {
      conversationId: chat.id,
      messageId: message.id,
      revisionId: current.id,
    };
    const linked = this.linkedDiscussions(chat.id, message.id);
    const rich = renderRichText(current.text || empty, [
      ...linked.flatMap((item) =>
        item.source?.revisionId === current.id ? [item.source] : [],
      ),
      ...(message.notes ?? []).flatMap((note) =>
        note.passage?.revisionId === current.id ? [note.passage] : [],
      ),
    ]);
    const article = document.createElement('article');
    article.dataset.messageId = message.id;
    article.dataset.revisionId = current.id;
    article.dataset.role = 'question' in message ? 'user' : 'assistant';
    const heading = document.createElement('strong');
    heading.textContent = author;
    article.append(heading, rich.root);
    if ('question' in message) {
      for (const excerpt of message.excerpts ?? [])
        article.append(
          preview
            ? this.excerptCard(excerpt)
            : this.renderSavedExcerpt(excerpt),
        );
      for (const passage of message.passages ?? [])
        article.append(this.passageCard(passage));
      for (const passage of message.passages ?? [])
        article.append(this.passageCard(passage));
    }

    const marked = this.linkHighlights(
      rich,
      linked.filter((item) => item.source?.revisionId === current.id),
    );
    for (const discussion of linked) {
      if (marked.has(discussion.id)) continue;
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
      section.append(label);
      if (note.passage) {
        const quote = document.createElement('blockquote');
        quote.append(renderRichText(note.passage.quote).root);
        section.append(quote);
      }
      section.append(renderRichText(note.text).root);
      article.append(section);
    }

    if ('status' in message && ['queued', 'running'].includes(message.status))
      return article;
    this.capturePassage.set(rich.root, (range) => {
      const span = rich.selection(range);
      if (!span) return;
      const quote = current.text.slice(span.start, span.end);
      if (!quote.trim() || quote.length > 12_000) return;
      return { ...address, ...span, quote };
    });
    if (!preview) {
      const menu = document.createElement('details');
      menu.className = 'message-actions';
      menu.open = this.openMenus.has(message.id);
      menu.addEventListener('toggle', () => {
        if (menu.open) this.openMenus.add(message.id);
        else this.openMenus.delete(message.id);
      });
      const label = document.createElement('summary');
      label.textContent = 'Message actions';
      menu.append(
        label,
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
      article.append(menu);
    }
    return article;
  }

  private linkHighlights(
    rich: ReturnType<typeof renderRichText>,
    linked: Conversation[],
  ): Set<string> {
    const marked = new Set<string>();
    for (const mark of rich.root.querySelectorAll('mark')) {
      const span = rich.spanOf(mark);
      if (!span) continue;
      const options = linked.filter(
        ({ source }) =>
          source && source.start < span.end && source.end > span.start,
      );
      if (!options.length) continue;
      for (const option of options) marked.add(option.id);
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
      mark.setAttribute('aria-label', 'Open linked discussion');
      const open = () => {
        if (options.length === 1) this.navigate(options[0]!.id);
        else {
          const { dialog, close } = this.dialog('Choose a discussion');
          for (const option of options)
            dialog.append(
              this.action(option.title, async () => {
                dialog.close();
                this.navigate(option.id);
              }),
            );
          dialog.append(close);
          dialog.showModal();
        }
      };
      mark.addEventListener('click', () => {
        if (document.getSelection()?.isCollapsed !== false) open();
      });
      mark.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    }
    return marked;
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
    passage?: Passage,
  ): void {
    this.editText(
      passage
        ? 'Annotate passage'
        : value === undefined
          ? 'Add note'
          : 'Edit message',
      value ?? '',
      (text) =>
        value === undefined
          ? this.api.addMessageNote(projectId, address, text, passage)
          : this.api.reviseMessage(projectId, address, text),
      passage?.quote,
    );
  }

  private editText(
    title: string,
    value: string,
    apply: (text: string) => Promise<void>,
    quote?: string,
  ): void {
    const { dialog, close } = this.dialog(title);
    if (quote) {
      const source = document.createElement('blockquote');
      source.textContent = quote;
      dialog.append(source);
    }
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', title);
    input.value = value;
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
        await apply(input.value);
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
        if (this.projectId === id) {
          this.reveal();
          this.input.focus();
        }
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
      const passages = this.draftPassages.get(chat.id) ?? noPassages;
      if (
        request?.question !== question ||
        request?.excerpts !== excerpts ||
        request?.passages !== passages
      ) {
        request = { question, excerpts, passages, id: crypto.randomUUID() };
        this.requestIds.set(chat.id, request);
      }
      await this.api.sendChat(
        id,
        chat.id,
        question,
        request.id,
        excerpts,
        passages,
      );
      this.requestIds.delete(chat.id);
      if (this.draftExcerpts.get(chat.id) === excerpts)
        this.draftExcerpts.delete(chat.id);
      if (this.draftPassages.get(chat.id) === passages)
        this.draftPassages.delete(chat.id);
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
