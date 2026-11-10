import type {
  ApprovalRequest,
  ContextEntry,
  EffectiveRunSettings,
  HarnessModel,
  RunSettings,
  RunMode,
  FileExcerpt,
  FileSource,
  NotebookMatch,
  Passage,
} from '../shared/notebook-api.js';

export interface ChatRequest {
  readonly projectId: string;
  readonly conversationId: string;
  readonly cwd: string;
  readonly question: string;
  readonly context: readonly ContextEntry[];
  readonly excerpts?: readonly FileExcerpt[];
  readonly passages?: readonly Passage[];
  readonly fileSource?: FileSource;
}

export interface RuntimeControls {
  readonly signal: AbortSignal;
  readonly initialInput?: string;
  readonly settings?: RunSettings;
  lookupNotebook?(query: string): Promise<NotebookMatch[]>;
  identify?(
    threadId: string,
    turnId: string,
    effective?: EffectiveRunSettings,
  ): Promise<void>;
  approve(
    request: Omit<ApprovalRequest, 'id' | 'jobId' | 'chatId'>,
    expires?: AbortSignal,
  ): Promise<boolean>;
}

export interface ChatRuntime {
  readonly inputLimitBytes?: number;
  readonly supportsNotebookLookup?: boolean;
  readonly modes?: RunMode[];
  listModels?(cwd: string): Promise<HarnessModel[]>;
  stream(
    request: ChatRequest,
    controls: RuntimeControls,
  ): AsyncIterable<string>;
}
