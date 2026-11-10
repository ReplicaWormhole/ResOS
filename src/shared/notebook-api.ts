export interface ContextEntry {
  conversationId: string;
  turnId: string;
  question: string;
  jobId?: string;
  answer?: string;
  questionRevisionId?: string;
  answerRevisionId?: string;
  passage?: Passage;
  excerpts?: FileExcerpt[];
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
  runtime?: 'demo' | 'codex';
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
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  turns: ChatTurn[];
  source?: DiscussionSource;
}

export interface ChatApi {
  listChats(projectId: string): Promise<Conversation[]>;
  createChat(projectId: string): Promise<Conversation>;
  sendChat(
    projectId: string,
    chatId: string,
    question: string,
    requestId: string,
    excerpts?: FileExcerpt[],
  ): Promise<void>;
  stopChat(projectId: string, jobId: string): Promise<void>;
  retryChat(
    projectId: string,
    chatId: string,
    jobId: string,
    confirmRelink: boolean,
  ): Promise<void>;
  listApprovals(projectId: string): Promise<ApprovalRequest[]>;
  decideApproval(
    projectId: string,
    approvalId: string,
    accept: boolean,
  ): Promise<void>;
  chatRuntime(): Promise<'demo' | 'codex'>;
  reviseMessage(
    projectId: string,
    address: MessageAddress,
    text: string,
  ): Promise<void>;
  addMessageNote(
    projectId: string,
    address: MessageAddress,
    text: string,
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
