import { setTimeout } from 'node:timers/promises';

import type { ChatRuntime } from './chat-runtime.js';

export const demoRuntime: ChatRuntime = {
  async *stream({ question }, { signal }) {
    for (const chunk of [
      'Demo response. ',
      'You asked: ',
      question,
      '\n\nThis reply was generated locally for testing.',
    ]) {
      await setTimeout(200, undefined, { signal });
      yield chunk;
    }
  },
};
