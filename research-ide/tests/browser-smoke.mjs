import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Optional browser tooling is supplied by the developer, not a runtime dependency.
// Usage: node tests/browser-smoke.mjs [playwright-module] [chromium-executable]
const {
  chromium
} = await import(process.argv[2] || 'playwright');
const root = fileURLToPath(new URL('../public/', import.meta.url));
const date = '2026-10-25T10:00:00.000Z';
const answer = {
  id: 'answer',
  role: 'assistant',
  text: 'alpha **beta**\ngamma <script>bad()</script>',
  turnId: 'turn',
  status: 'complete'
};
const makeChat = (id, title, extra = {}) => ({
  id,
  title,
  messages: [],
  busy: false,
  createdAt: date,
  lastUsedAt: date,
  ...extra
});
const state = {
  workspace: 'Smoke fixture',
  agentReady: true,
  conversations: [makeChat('root', 'Original chat', {
    messages: [answer]
  }), makeChat('child', 'Linked question', {
    parentId: 'root',
    parentTurnId: 'turn',
    parentMessageId: 'answer',
    selectedQuote: 'beta',
    selectedStart: 6,
    messages: [{
      id: 'child-answer',
      role: 'assistant',
      text: 'A follow-up answer.'
    }]
  }), makeChat('other', 'Other chat', {
    messages: [{
      id: 'other-answer',
      role: 'assistant',
      text: 'Another chat.'
    }]
  })]
};
for (const chat of state.conversations) for (const message of chat.messages) {
  message.revisionId = 'revision-' + message.id;
  message.revisions = [{ id: message.revisionId, text: message.text, author: message.role, createdAt: date }];
}
const streams = new Set();
const calls = [];
let content = 'First line.\nSecond line.\n';
const emit = event => {
  for (const response of streams) {
    response.write('data: ' + JSON.stringify(event) + '\n\n');
  }
};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/events') {
      assert.equal(url.searchParams.get('key'), 'test-key');
      response.writeHead(200, {
        'content-type': 'text/event-stream'
      });
      response.write(': connected\n\n');
      streams.add(response);
      request.on('close', () => streams.delete(response));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      assert.equal(request.headers['x-access-key'], 'test-key');
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
      }
      const body = raw ? JSON.parse(raw) : null;
      calls.push({
        path: url.pathname,
        body
      });
      let result;
      switch (url.pathname) {
        case '/api/state':
          result = state;
          break;
        case '/api/files':
          result = {
            entries: [{
              path: 'sample.txt',
              name: 'sample.txt',
              type: 'file'
            }]
          };
          break;
        case '/api/file':
          if (request.method === 'PUT') {
            content = body.content;
          }
          result = {
            path: 'sample.txt',
            content
          };
          break;
        case '/api/chat/new':
        case '/api/chat/file':
        case '/api/chat/branch':
          {
            const chat = makeChat('new-' + state.conversations.length, 'New chat');
            if (url.pathname.endsWith('/file')) {
              Object.assign(chat, {
                sourceFile: {
                  path: body.path,
                  wholeFile: body.wholeFile
                },
                selectedQuote: body.selectedQuote || '',
                selectedStart: body.start
              });
            }
            if (url.pathname.endsWith('/branch')) {
              Object.assign(chat, {
                parentId: body.parentId,
                parentTurnId: body.turnId,
                parentMessageId: body.parentMessageId,
                selectedQuote: body.selectedQuote,
                selectedStart: body.selectedStart
              });
            }
            state.conversations.push(chat);
            result = {
              chat
            };
            break;
          }
        case '/api/chat/send':
          {
            const chat = state.conversations.find(chat => chat.id === body.chatId);
            chat.busy = true;
            chat.messages.push({
              id: 'sent-user',
              role: 'user',
              text: body.text
            }, {
              id: 'sent-assistant',
              role: 'assistant',
              text: '',
              status: 'streaming',
              turnId: 'new-turn'
            });
            result = {};
            break;
          }
        case '/api/chat/stop':
          {
            const chat = state.conversations.find(chat => chat.id === body.chatId);
            chat.busy = false;
            chat.messages.at(-1).status = 'stopped';
            emit({
              type: 'turn-completed',
              chatId: chat.id,
              turnId: 'new-turn',
              status: 'interrupted'
            });
            result = {};
            break;
          }
        case '/api/approval/approval-1':
          result = {};
          break;
        default:
          throw new Error('Unexpected API ' + url.pathname);
      }
      response.writeHead(200, {
        'content-type': 'application/json'
      });
      response.end(JSON.stringify(result));
      return;
    }
    const asset = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/public\//, '');
    if (!/^[a-z-]+\.(html|js|css)$/.test(asset)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html'
    });
    response.end(await readFile(root + asset));
  } catch (error) {
    response.writeHead(500);
    response.end(JSON.stringify({
      error: error.message
    }));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.argv[3]
});
const page = await browser.newPage({
  viewport: {
    width: 1280,
    height: 900
  }
});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') {
    errors.push(message.text());
  }
});
const expectVisible = selector => page.locator(selector).waitFor({
  state: 'visible'
});
const selectChat = async id => {
  await page.locator('#chatTree [data-chat-id="' + id + '"]').click();
};
try {
  await page.goto('http://127.0.0.1:' + server.address().port + '/?key=test-key');
  await page.waitForFunction(() => document.querySelector('#chatTitle').textContent === 'Original chat');
  assert.equal(new URL(page.url()).search, '');
  assert.equal(await page.locator('#transcript script').count(), 0);
  await page.locator('#composer').fill('Draft for original');
  await selectChat('other');
  await page.locator('#composer').fill('Other draft');
  await selectChat('root');
  assert.equal(await page.locator('#composer').inputValue(), 'Draft for original');
  await page.locator('#transcript .linked-passage').click();
  await expectVisible('#branchPopup');
  assert.equal(await page.locator('#branchPopupTitle').textContent(), 'Linked question');
  assert.ok((await page.locator('#branchPopupTranscript').textContent()).includes('A follow-up answer.'));
  await page.keyboard.press('Escape');
  await page.locator('#transcript .linked-passage').click();
  await page.locator('#openBranchChat').click();
  assert.equal(await page.locator('#chatTitle').textContent(), 'Linked question');
  await page.locator('#quoteParentLink').click();
  assert.equal(await page.locator('#chatTitle').textContent(), 'Original chat');
  await page.locator('#toggleEditor').click();
  await page.locator('#fileTree [data-path="sample.txt"]').click();
  await expectVisible('#filePreview');
  assert.equal(await page.locator('#filePreview').textContent(), content);
  await page.locator('#toggleFileEdit').click();
  await page.locator('#editor').fill('First line.\nSecond line edited.\n');
  await page.locator('#saveFile').click();
  await page.waitForFunction(() => document.querySelector('#dirtyMark').hidden);
  assert.equal(content, 'First line.\nSecond line edited.\n');
  await page.locator('#toggleFileEdit').click();
  await page.evaluate(() => {
    const text = document.querySelector('#filePreview').firstChild;
    const range = document.createRange();
    range.setStart(text, 12);
    range.setEnd(text, 18);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('#askFile').click();
  await page.waitForFunction(() => document.querySelector('#quoteText').textContent === 'Second');
  assert.equal(calls.find(call => call.path === '/api/chat/file').body.selectedQuote, 'Second');
  await page.locator('#quoteParentLink').click();
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await expectVisible('#filePreview .linked-passage');
  await page.locator('#askFile').click();
  await page.waitForFunction(() => document.querySelector('#quoteText').textContent === 'Question about the whole file.');
  assert.equal(calls.filter(call => call.path === '/api/chat/file').at(-1).body.wholeFile, true);
  await selectChat('root');
  await page.locator('#transcript .message-actions button').first().click();
  await page.waitForFunction(() => document.querySelector('#branchPopupTitle').textContent === 'New chat');
  assert.equal(calls.find(call => call.path === '/api/chat/branch').body.parentMessageId, 'answer');
  await page.locator('#popupComposer').fill('Test message');
  await page.locator('#popupSend').click();
  await expectVisible('#popupStop');
  assert.equal(await page.locator('#popupComposer').isEnabled(), true);
  await page.locator('#popupComposer').fill('Draft during streaming');
  const sending = state.conversations.at(-1);
  sending.messages.at(-1).text = 'Hello from stream';
  emit({
    type: 'message-started',
    chatId: sending.id,
    assistantMessageId: 'sent-assistant',
    turnId: 'new-turn'
  });
  emit({
    type: 'agent-delta',
    chatId: sending.id,
    turnId: 'new-turn',
    delta: 'Hello from stream'
  });
  await page.waitForFunction(() => document.querySelector('#branchPopupTranscript').textContent.includes('Hello from stream'));
  await page.locator('#popupStop').click();
  await expectVisible('#popupSend');
  assert.equal(await page.locator('#popupComposer').inputValue(), 'Draft during streaming');
  emit({
    type: 'approval-needed',
    id: 'approval-1',
    method: 'command',
    params: {
      command: ['echo', 'test']
    }
  });
  await expectVisible('#popupApprovalBar');
  await page.locator('#popupAllowApproval').click();
  await page.waitForFunction(() => document.querySelector('#popupApprovalBar').hidden);
  assert.equal(calls.find(call => call.path === '/api/approval/approval-1').body.decision, 'allow');
  await page.locator('#openBranchChat').click();
  await page.setViewportSize({
    width: 390,
    height: 600
  });
  await page.locator('#sidebarToggle').click();
  await expectVisible('#chatTree');
  await page.locator('#sidebarScrim').click({
    position: {
      x: 350,
      y: 400
    }
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#composer').value === 'Draft during streaming');
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: authenticated module load, safe rendering, draft switching/reload, linked popup, source navigation, file edit/save, selected/whole-file chats, answer branching, streamed response, stop, approvals, mobile navigation.');
} finally {
  await browser.close();
  for (const stream of streams) {
    stream.end();
  }
  await new Promise(resolve => server.close(resolve));
}
