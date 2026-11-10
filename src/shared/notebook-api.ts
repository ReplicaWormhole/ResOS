export interface ContextEntry {
  conversationId: string;
  turnId: string;
  question: string;
  jobId?: string;
  answer?: string;
  questionRevisionId?: string;
  answerRevisionId?: string;
  questionAuthor?: MessageRevision['author'];
  answerAuthor?: MessageRevision['author'];
  passage?: Passage;
  excerpts?: FileExcerpt[];
  passages?: Passage[];
}

export interface OmittedContext {
  conversationId: string;
  turnId: string;
  questionRevisionId: string;
  answerRevisionId?: string;
  retainedQuote: boolean;
}

export interface PreparedInput {
  initialText: string;
  limitBytes: number;
  usedBytes: number;
  omitted: OmittedContext[];
  lookupEnabled: boolean;
}

export interface ContextPreview extends PreparedInput {
  context: ContextEntry[];
  previewId: string;
  cwd: string;
  settings?: RunSettings;
}

export interface ContextOptions {
  lookupEnabled: boolean;
  previewId?: string;
  settings?: RunSettings;
}

export type Harness = 'demo' | 'codex' | 'claude';
export type RunMode = 'ask' | 'agent';

export interface RunSettings {
  harness: Harness;
  mode: RunMode;
  model?: string;
  effort?: string;
}

export interface EffectiveRunSettings {
  model?: string;
  effort?: string;
}

export interface HarnessModel {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort?: string;
  isDefault: boolean;
}

export interface HarnessCatalog {
  harness: Harness;
  modes: RunMode[];
  models: HarnessModel[];
  supportsNotebookLookup: boolean;
}

export interface NotebookMatch extends MessageAddress {
  title: string;
  author: MessageRevision['author'];
  excerpt: string;
}

export interface NotebookLookup {
  query: string;
  matches: NotebookMatch[];
}

export interface ApprovalRequest {
  id: string;
  jobId: string;
  chatId: string;
  kind: string;
  detail: string;
}

export interface ChatJob extends MessageHistory {
  id: string;
  cwd: string;
  status: 'queued' | 'running' | 'complete' | 'interrupted' | 'failed';
  answer: string;
  context?: ContextEntry[];
  input?: PreparedInput;
  settings?: RunSettings;
  effectiveSettings?: EffectiveRunSettings;
  submittedAt?: string;
  lookups?: NotebookLookup[];
  runtime?: Harness;
  requestId?: string;
  queueOrder?: number;
  startedAt?: string;
  finishedAt?: string;
  threadId?: string;
  turnId?: string;
  retryOf?: string;
  error?: string;
}

export interface ChatTurn extends MessageHistory {
  id: string;
  question: string;
  jobs: ChatJob[];
  excerpts?: FileExcerpt[];
  passages?: Passage[];
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  turns: ChatTurn[];
  source?: DiscussionSource;
  fileSource?: FileSource;
}

export interface ChatApi {
  listChats(projectId: string): Promise<Conversation[]>;
  createChat(projectId: string): Promise<Conversation>;
  createFileChat(projectId: string, source: FileSource): Promise<Conversation>;
  listFileNotes(projectId: string): Promise<FileNote[]>;
  addFileNote(
    projectId: string,
    excerpt: FileExcerpt,
    text: string,
  ): Promise<void>;
  sendChat(
    projectId: string,
    chatId: string,
    question: string,
    requestId: string,
    excerpts?: FileExcerpt[],
    passages?: Passage[],
    options?: ContextOptions,
  ): Promise<void>;
  previewContext(
    projectId: string,
    chatId: string,
    question: string,
    excerpts: FileExcerpt[],
    passages: Passage[],
    options: ContextOptions,
  ): Promise<ContextPreview>;
  stopChat(projectId: string, jobId: string): Promise<void>;
  retryChat(
    projectId: string,
    chatId: string,
    jobId: string,
    confirmRelink: boolean,
    settings?: RunSettings,
  ): Promise<void>;
  listApprovals(projectId: string): Promise<ApprovalRequest[]>;
  decideApproval(
    projectId: string,
    approvalId: string,
    accept: boolean,
  ): Promise<void>;
  listHarnesses(): Promise<Harness[]>;
  harnessCatalog(projectId: string, harness: Harness): Promise<HarnessCatalog>;
  reviseMessage(
    projectId: string,
    address: MessageAddress,
    text: string,
  ): Promise<void>;
  addMessageNote(
    projectId: string,
    address: MessageAddress,
    text: string,
    passage?: Passage,
  ): Promise<void>;
  createDiscussion(projectId: string, passage: Passage): Promise<Conversation>;
  onChatChanged(listener: (projectId: string) => void): () => void;
}

export interface MessageRevision {
  id: string;
  text: string;
  author: 'user' | 'agent';
  createdAt?: string;
}

export interface HumanNote {
  id: string;
  revisionId: string;
  text: string;
  passage?: Passage;
}

export interface MessageHistory {
  revisions?: MessageRevision[];
  notes?: HumanNote[];
}

export interface MessageAddress {
  conversationId: string;
  messageId: string;
  revisionId: string;
}

export interface Passage extends MessageAddress {
  start: number;
  end: number;
  quote: string;
}

export interface DiscussionSource extends Passage {
  context: ContextEntry[];
}

export interface FileExcerpt {
  projectId: string;
  path: string;
  text: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  capturedAt: string;
  unsaved: boolean;
  fingerprint: string;
}

export interface FileSource {
  path: string;
  excerpt?: FileExcerpt;
}

export interface FileNote {
  id: string;
  excerpt: FileExcerpt;
  text: string;
}
