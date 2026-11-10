export interface ContextEntry {
  conversationId: string;
  turnId: string;
  question: string;
  jobId?: string;
  answer?: string;
}

export interface ApprovalRequest {
  id: string;
  jobId: string;
  chatId: string;
  kind: string;
  detail: string;
}

export interface ChatJob {
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

export interface ChatTurn {
  id: string;
  question: string;
  jobs: ChatJob[];
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  turns: ChatTurn[];
}

export interface ChatApi {
  listChats(projectId: string): Promise<Conversation[]>;
  createChat(projectId: string): Promise<Conversation>;
  sendChat(
    projectId: string,
    chatId: string,
    question: string,
    requestId: string,
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
  onChatChanged(listener: (projectId: string) => void): () => void;
}
