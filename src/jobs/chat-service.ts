import { randomUUID } from 'node:crypto';
import type { NotebookStore } from '../notebook/notebook-store.js';
import type { ChatRequest, ChatRuntime } from '../runtime/demo-runtime.js';
import type { Project } from '../shared/desktop-api.js';
import type { ChatJob, Conversation } from '../shared/notebook-api.js';

export class ChatService {
  private readonly active = new Set<string>();

  constructor(
    private readonly notebook: NotebookStore,
    private readonly runtime: ChatRuntime,
    private readonly changed: (projectId: string) => void,
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

  isRunning(projectId: string): boolean {
    return this.active.has(projectId);
  }

  async send(
    project: Project,
    conversationId: string,
    question: string,
  ): Promise<void> {
    if (
      typeof question !== 'string' ||
      !question.trim() ||
      question.length > 12_000
    ) {
      throw new Error('Enter a question of at most 12,000 characters.');
    }
    if (this.isRunning(project.id))
      throw new Error('This project already has a response in progress.');
    const request: ChatRequest = {
      projectId: project.id,
      conversationId,
      question,
      cwd: project.root,
    };
    const jobId = randomUUID();
    this.active.add(project.id);
    try {
      await this.notebook.change((chats) => {
        const chat = chats.find(
          (item) => item.id === conversationId && item.projectId === project.id,
        );
        if (!chat) throw new Error('Chat not found in this project.');
        if (!chat.turns.length)
          chat.title = question.trim().split(/\s+/).join(' ').slice(0, 60);
        chat.turns.push({
          id: randomUUID(),
          question,
          jobs: [
            { id: jobId, cwd: request.cwd, status: 'running', answer: '' },
          ],
        });
      });
    } catch (error) {
      this.active.delete(project.id);
      throw error;
    }
    void this.run(request, jobId);
  }

  private async run(request: ChatRequest, id: string): Promise<void> {
    const update = async (apply: (job: ChatJob) => void) => {
      await this.notebook.change((chats) => {
        const chat = chats.find(
          (item) =>
            item.id === request.conversationId &&
            item.projectId === request.projectId,
        );
        const job = chat?.turns
          .flatMap((turn) => turn.jobs)
          .find((item) => item.id === id);
        if (!job) throw new Error('Saved chat response is missing.');
        apply(job);
      });
      this.changed(request.projectId);
    };
    try {
      this.changed(request.projectId);
      for await (const chunk of this.runtime.stream(request)) {
        await update((job) => {
          job.answer += chunk;
        });
      }
      await update((job) => {
        job.status = 'complete';
      });
    } catch (error) {
      try {
        await update((job) => {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : String(error);
        });
      } catch (persistError) {
        console.error(
          'Could not persist the chat response status:',
          persistError,
        );
      }
    } finally {
      this.active.delete(request.projectId);
      this.changed(request.projectId);
    }
  }
}
