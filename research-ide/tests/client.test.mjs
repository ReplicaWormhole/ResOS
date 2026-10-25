import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, sessionRead, sessionWrite } from '../public/browser-session.js';
import { safeMarkdown } from '../public/markdown.js';
import { applyConversationEvent } from '../public/conversation-events.js';
test('API client adds authentication and JSON headers and preserves caller options', async () => {
  let received;
  const api = createApiClient('local-key', async (...args) => {
    received = args;
    return {
      ok: true,
      json: async () => ({
        saved: true
      })
    };
  });
  assert.deepEqual(await api('/api/file', {
    method: 'PUT',
    body: '{}',
    headers: {
      'x-extra': 'value'
    }
  }), {
    saved: true
  });
  assert.deepEqual(received, ['/api/file', {
    method: 'PUT',
    body: '{}',
    headers: {
      'content-type': 'application/json',
      'x-access-key': 'local-key',
      'x-extra': 'value'
    }
  }]);
});
test('API client handles unauthenticated GETs, server errors and non-JSON errors', async () => {
  const api = createApiClient('', async (_url, options) => {
    assert.deepEqual(options.headers, {});
    return {
      ok: false,
      status: 403,
      json: async () => ({
        error: 'Access denied'
      })
    };
  });
  await assert.rejects(api('/api/state'), /Access denied/);
  const broken = createApiClient('', async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError();
    }
  }));
  await assert.rejects(broken('/api/state'), /Request failed \(502\)/);
});
test('storage failures leave the app usable', () => {
  // Node has no browser sessionStorage; the same fallback covers disabled storage.
  assert.equal(sessionRead('draft', 'fallback'), 'fallback');
  assert.equal(sessionWrite('draft', 'hello'), false);
});
test('Markdown escapes HTML and only creates HTTP(S) links', () => {
  const html = safeMarkdown('<img src=x onerror=alert(1)> **bold** [bad](javascript:alert) [ok](https://example.com)');
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});
test('fenced code stays literal while ordinary inline markup and line breaks render', () => {
  assert.equal(safeMarkdown('```js\n**literal**\n```\n`inline`'), '<pre><code>**literal**</code></pre><br><code>inline</code>');
});
test('stream events reconcile the optimistic assistant and complete its turn', () => {
  const chat = {
    id: 'chat',
    busy: true,
    messages: [{
      id: 'user',
      role: 'user',
      text: 'Question'
    }, {
      id: 'local',
      role: 'assistant',
      text: '',
      status: 'streaming'
    }]
  };
  const apply = event => applyConversationEvent([chat], {
    chatId: 'chat',
    ...event
  }, () => 'fallback');
  assert.equal(apply({
    type: 'message-started',
    assistantMessageId: 'server',
    turnId: 'turn'
  }), chat);
  apply({
    type: 'agent-delta',
    turnId: 'turn',
    delta: 'Hel'
  });
  apply({
    type: 'agent-delta',
    turnId: 'turn',
    delta: 'lo'
  });
  apply({
    type: 'turn-completed',
    turnId: 'turn',
    status: 'completed'
  });
  assert.equal(chat.messages.length, 2);
  assert.deepEqual(chat.messages[1], {
    id: 'server',
    role: 'assistant',
    text: 'Hello',
    status: 'complete',
    turnId: 'turn'
  });
  assert.equal(chat.busy, false);
});
test('stream recovery creates a missing assistant and ignores events for unknown chats', () => {
  const chat = {
    id: 'chat',
    busy: true,
    messages: []
  };
  applyConversationEvent([chat], {
    type: 'agent-delta',
    chatId: 'chat',
    turnId: 'turn',
    delta: 'Hi'
  }, () => 'fallback');
  assert.equal(chat.messages[0].id, 'fallback');
  applyConversationEvent([chat], {
    type: 'turn-completed',
    chatId: 'chat',
    turnId: 'turn',
    status: 'interrupted'
  });
  assert.equal(chat.messages[0].status, 'stopped');
  assert.equal(applyConversationEvent([chat], {
    type: 'agent-delta',
    chatId: 'missing'
  }), null);
  assert.equal(applyConversationEvent([chat], {
    type: 'unrelated',
    chatId: 'chat'
  }), null);
});
test('completion leaves other turns alone and treats unknown statuses as errors', () => {
  const old = {
    role: 'assistant',
    turnId: 'old',
    status: 'complete',
    text: 'Earlier answer'
  };
  const latest = {
    role: 'assistant',
    turnId: 'new',
    status: 'streaming',
    text: 'Latest answer'
  };
  const chat = {
    id: 'chat',
    busy: true,
    messages: [old, latest]
  };
  applyConversationEvent([chat], {
    type: 'turn-completed',
    chatId: 'chat',
    turnId: 'new',
    status: 'toString'
  });
  assert.equal(old.status, 'complete');
  assert.equal(latest.status, 'error');
});
