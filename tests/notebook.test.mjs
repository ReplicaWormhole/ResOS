import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { NotebookStore } from '../dist/notebook/notebook-store.js';
import { ChatService } from '../dist/jobs/chat-service.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'resos-notebook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'notebook.json');
}

async function until(check) {
  for (let index = 0; index < 80; index++) {
    if (await check()) return;
    await setTimeout(10);
  }
  assert.fail('Expected chat state did not arrive.');
}

test('persists partial replies and retains the project, chat and cwd of parallel requests', async (t) => {
  const path = await fixture(t);
  const store = new NotebookStore(path);
  const requests = [];
  const { promise, resolve } = Promise.withResolvers();
  const runtime = {
    async *stream(request) {
      requests.push(request);
      yield 'first ';
      await promise;
      yield request.question;
    },
  };
  const service = new ChatService(store, runtime, () => {});
  const a = { id: 'a', root: '/workspace/a', name: 'A' };
  const b = { id: 'b', root: '/workspace/b', name: 'B' };
  const chatA = await service.create(a.id);
  const chatB = await service.create(b.id);
  await assert.rejects(
    service.send(a, chatB.id, 'misrouted'),
    /not found in this project/,
  );
  await service.send(a, chatA.id, 'alpha');
  await assert.rejects(
    service.send(a, chatA.id, 'second response'),
    /already has a response/,
  );
  await service.send(b, chatB.id, 'beta');

  try {
    await until(async () => {
      const { conversations } = JSON.parse(await readFile(path, 'utf8'));
      return conversations.every(
        (chat) => chat.turns[0]?.jobs[0].answer === 'first ',
      );
    });
    assert.deepEqual(requests, [
      {
        projectId: 'a',
        conversationId: chatA.id,
        question: 'alpha',
        cwd: a.root,
      },
      {
        projectId: 'b',
        conversationId: chatB.id,
        question: 'beta',
        cwd: b.root,
      },
    ]);
  } finally {
    resolve();
  }
  await until(() => !service.isRunning('a') && !service.isRunning('b'));

  const reopened = new NotebookStore(path);
  assert.equal(
    (await reopened.list('a'))[0].turns[0].jobs[0].answer,
    'first alpha',
  );
  assert.equal(
    (await reopened.list('b'))[0].turns[0].jobs[0].answer,
    'first beta',
  );
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('recovery marks running attempts interrupted and retains the partial text', async (t) => {
  const path = await fixture(t);
  const store = new NotebookStore(path);
  await store.change((chats) =>
    chats.push({
      id: 'chat',
      projectId: 'project',
      title: 'Question',
      turns: [
        {
          id: 'turn',
          question: 'Question',
          jobs: [
            {
              id: 'job',
              cwd: '/workspace',
              status: 'running',
              answer: 'partial',
            },
          ],
        },
      ],
    }),
  );

  await new NotebookStore(path).recover();
  const [chat] = await new NotebookStore(path).list('project');
  assert.deepEqual(chat.turns[0].jobs[0], {
    id: 'job',
    cwd: '/workspace',
    status: 'interrupted',
    answer: 'partial',
  });
});

test('rejects an unsupported snapshot without overwriting it', async (t) => {
  const path = await fixture(t);
  const data = '{"version":1,"conversations":[{"id":"broken"}]}';
  await writeFile(path, data);
  const store = new NotebookStore(path);
  await assert.rejects(store.recover(), /unsupported format/);
  await assert.rejects(
    store.change(() => {}),
    /unsupported format/,
  );
  assert.equal(await readFile(path, 'utf8'), data);
});
