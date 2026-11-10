import type {
  ApprovalRequest,
  ContextEntry,
  FileExcerpt,
} from '../shared/notebook-api.js';

export interface ChatRequest {
  readonly projectId: string;
  readonly conversationId: string;
  readonly cwd: string;
  readonly question: string;
  readonly context: readonly ContextEntry[];
  readonly excerpts?: readonly FileExcerpt[];
}

export interface RuntimeControls {
  readonly signal: AbortSignal;
  identify?(threadId: string, turnId: string): Promise<void>;
  approve(
    request: Omit<ApprovalRequest, 'id' | 'jobId' | 'chatId'>,
    expires?: AbortSignal,
  ): Promise<boolean>;
}

export interface ChatRuntime {
  stream(
    request: ChatRequest,
    controls: RuntimeControls,
  ): AsyncIterable<string>;
}
