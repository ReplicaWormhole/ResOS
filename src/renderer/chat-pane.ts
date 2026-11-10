import type { ChatApi, Conversation } from '../shared/notebook-api.js';

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
  private readonly activeChat = new Map<string, string>();
  private readonly drafts = new Map<string, string>();
  private readonly submitting = new Set<string>();
  private projectId?: string;
  private chats: Conversation[] = [];
  private available = false;
  private request = 0;

  constructor(private readonly api: ChatApi) {
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

  show(projectId: string): void {
    if (this.projectId !== projectId) {
      this.projectId = projectId;
      this.available = false;
      this.chats = [];
      this.error.hidden = true;
      this.render(true);
    }
    void this.refresh(projectId);
  }

  setAvailable(available: boolean): void {
    this.available = available;
    this.renderComposer();
  }

  private get current(): Conversation | undefined {
    const id = this.projectId && this.activeChat.get(this.projectId);
    return this.chats.find((chat) => chat.id === id);
  }

  private async refresh(projectId: string): Promise<void> {
    const request = ++this.request;
    try {
      const chats = await this.api.listChats(projectId);
      if (this.projectId !== projectId || request !== this.request) return;
      const previous = this.current?.id;
      this.chats = chats;
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
      const job = turn.jobs.at(-1)!;
      const answer = this.message(
        'ResOS demo',
        job.answer ||
          (job.status === 'running' ? 'Generating…' : 'No response saved.'),
      );
      answer.dataset.status = job.status;
      if (job.status === 'interrupted' || job.status === 'failed') {
        const note = document.createElement('p');
        note.textContent = job.error ?? 'Response interrupted.';
        answer.append(note);
      }
      this.transcript.append(answer);
    }
    this.transcript.scrollTop =
      scrollToEnd || atEnd ? this.transcript.scrollHeight : previousScroll;
    const draft = (chat && this.drafts.get(chat.id)) || '';
    if (this.input.value !== draft) this.input.value = draft;
    this.renderComposer();
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
        turn.jobs.some((job) => job.status === 'running'),
      ),
    );
    this.input.disabled = !this.current;
    this.sendButton.disabled =
      !this.current ||
      !this.available ||
      busy ||
      Boolean(id && this.submitting.has(id)) ||
      !this.input.value.trim();
    this.status.textContent = !this.available
      ? 'Locate the project folder to send messages.'
      : busy
        ? 'Response in progress…'
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
      await this.api.sendChat(id, chat.id, question);
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
