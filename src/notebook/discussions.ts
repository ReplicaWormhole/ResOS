import { randomUUID } from 'node:crypto';
import {
  latestRevision,
  locateMessage,
  revisionsOf,
} from '../shared/message-history.js';
import type {
  ChatJob,
  ChatTurn,
  ContextEntry,
  Conversation,
  MessageAddress,
  MessageRevision,
  Passage,
} from '../shared/notebook-api.js';
import { contextBefore } from './chat-context.js';

export function findChat(
  chats: Conversation[],
  projectId: string,
  conversationId: string,
): Conversation {
  const chat = chats.find(
    (item) => item.id === conversationId && item.projectId === projectId,
  );
  if (!chat) throw new Error('Chat not found in this project.');
  return chat;
}

export function validAddress(address: unknown): address is MessageAddress {
  if (!address || typeof address !== 'object') return false;
  const record = address as Record<string, unknown>;
  return ['conversationId', 'messageId', 'revisionId'].every(
    (key) =>
      typeof record[key] === 'string' &&
      record[key].length > 0 &&
      record[key].length <= 128,
  );
}

function savedMessage(chat: Conversation, address: MessageAddress) {
  const located = locateMessage(chat, address.messageId);
  if (
    !located ||
    ('status' in located.message &&
      ['running', 'queued'].includes(located.message.status))
  ) {
    throw new Error(
      'This message is not available for revision or discussion.',
    );
  }
  const revision = revisionsOf(located.message).find(
    (entry) => entry.id === address.revisionId,
  );
  if (!revision) throw new Error('Message revision not found.');
  return { ...located, revision };
}

function checkText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !text.trim() || text.length > 120_000) {
    throw new Error('Enter nonempty text of at most 120,000 characters.');
  }
}

export function revise(
  chat: Conversation,
  address: MessageAddress,
  text: string,
): void {
  checkText(text);
  const { message, revision } = savedMessage(chat, address);
  if (latestRevision(message).id !== revision.id)
    throw new Error('This message changed since you opened the editor.');
  if (text === revision.text) return;
  message.revisions = [
    ...revisionsOf(message),
    {
      id: randomUUID(),
      text,
      author: 'user',
      createdAt: new Date().toISOString(),
    },
  ];
}

export function addNote(
  chat: Conversation,
  address: MessageAddress,
  text: string,
): void {
  checkText(text);
  const { message, revision } = savedMessage(chat, address);
  (message.notes ??= []).push({
    id: randomUUID(),
    revisionId: revision.id,
    text,
  });
}

function focalContext(
  chat: Conversation,
  turn: ChatTurn,
  message: ChatTurn | ChatJob,
  revision: MessageRevision,
  passage: Passage,
): ContextEntry {
  const question = message === turn ? revision : latestRevision(turn);
  return {
    conversationId: chat.id,
    turnId: turn.id,
    question: question.text,
    questionRevisionId: question.id,
    ...(turn.excerpts?.length ? { excerpts: turn.excerpts } : {}),
    ...('answer' in message
      ? {
          jobId: message.id,
          answer: revision.text,
          answerRevisionId: revision.id,
        }
      : {}),
    passage,
  };
}

export function discuss(chat: Conversation, passage: Passage): Conversation {
  const { message, revision, turn, index } = savedMessage(chat, passage);
  if (
    !Number.isSafeInteger(passage.start) ||
    !Number.isSafeInteger(passage.end) ||
    passage.start < 0 ||
    passage.end <= passage.start ||
    passage.end > revision.text.length ||
    typeof passage.quote !== 'string' ||
    passage.quote.length > 12_000 ||
    revision.text.slice(passage.start, passage.end) !== passage.quote ||
    !passage.quote.trim()
  ) {
    throw new Error('The selection does not match the saved revision.');
  }
  const source = {
    conversationId: chat.id,
    messageId: message.id,
    revisionId: revision.id,
    start: passage.start,
    end: passage.end,
    quote: passage.quote,
  };
  return {
    id: randomUUID(),
    projectId: chat.projectId,
    title:
      'Discussion · ' + passage.quote.trim().replace(/\s+/g, ' ').slice(0, 48),
    turns: [],
    source: {
      ...source,
      context: [
        ...contextBefore(chat, index),
        focalContext(chat, turn, message, revision, source),
      ],
    },
  };
}
