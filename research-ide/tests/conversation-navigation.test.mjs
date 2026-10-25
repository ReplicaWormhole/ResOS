import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainConversations, mainConversationId } from '../public/conversation-navigation.js';

const chats = [
  { id: 'main', messages: [{}], lastUsedAt: '2026-10-24' },
  { id: 'child', parentId: 'main', messages: [{}], lastUsedAt: '2026-10-25' },
  { id: 'nested', parentId: 'child', messages: [{}], lastUsedAt: '2026-10-25' },
  { id: 'file', sourceFile: { path: 'notes.tex', wholeFile: true }, messages: [{}], lastUsedAt: '2026-10-25' },
  { id: 'file-selection', sourceFile: { path: 'notes.tex', line: 2 }, messages: [{}], lastUsedAt: '2026-10-25' },
  { id: 'file-child', parentId: 'file', messages: [{}], lastUsedAt: '2026-10-25' },
  { id: 'other', messages: [{}], lastUsedAt: '2026-10-25' },
  { id: 'empty', messages: [], lastUsedAt: '2026-10-25' },
];

test('only main chats appear, even when a follow-up is active or has a draft', () => {
  for (const active of ['child', 'nested', 'file', 'file-selection', 'file-child']) {
    assert.deepEqual(mainConversations(chats, active, key => key === 'draft:child' ? 'draft' : '').map(chat => chat.id), ['other', 'main']);
  }
});
test('nested follow-ups identify their main chat; file questions have no main chat', () => {
  assert.equal(mainConversationId(chats, 'nested'), 'main');
  assert.equal(mainConversationId(chats, 'main'), 'main');
  assert.equal(mainConversationId(chats, 'file-child'), null);
  assert.equal(mainConversationId(chats, 'missing'), null);
  assert.equal(mainConversationId([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }], 'a'), null);
});
test('new main chats and main drafts stay visible without mutating saved conversations', () => {
  const before = JSON.stringify(chats);
  assert.ok(mainConversations(chats, 'empty').some(chat => chat.id === 'empty'));
  assert.ok(mainConversations(chats, 'main', key => key === 'draft:empty' ? 'draft' : '').some(chat => chat.id === 'empty'));
  assert.equal(JSON.stringify(chats), before);
});
