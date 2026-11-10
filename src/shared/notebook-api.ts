export interface ChatJob {
  id: string;
  cwd: string;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  answer: string;
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
  sendChat(projectId: string, chatId: string, question: string): Promise<void>;
  onChatChanged(listener: (projectId: string) => void): () => void;
}
