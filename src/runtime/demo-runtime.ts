import { setTimeout } from 'node:timers/promises';

export interface ChatRequest {
  readonly projectId: string;
  readonly conversationId: string;
  readonly cwd: string;
  readonly question: string;
}

export interface ChatRuntime {
  stream(request: ChatRequest): AsyncIterable<string>;
}

export const demoRuntime: ChatRuntime = {
  async *stream({ question }) {
    for (const chunk of [
      'Demo response. ',
      'You asked: ',
      question,
      '\n\nThis reply was generated locally for testing.',
    ]) {
      await setTimeout(200);
      yield chunk;
    }
  },
};
