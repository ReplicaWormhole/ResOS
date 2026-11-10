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
    service.send(a, chatB.id, 'misrouted', 'wrong'),
    /not found in this project/,
  );
  await service.send(a, chatA.id, 'alpha', 'a1');
  await service.send(a, chatA.id, 'alpha', 'a1');
  await assert.rejects(
    service.send(a, chatA.id, 'second response', 'a1'),
    /already used for different input/,
  );
  await service.send(b, chatB.id, 'beta', 'b1');

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
        context: [],
      },
      {
        projectId: 'b',
        conversationId: chatB.id,
        question: 'beta',
        cwd: b.root,
        context: [],
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

test('recovery marks queued and running attempts interrupted and retains partial text', async (t) => {
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
            { id: 'queued', cwd: '/workspace', status: 'queued', answer: '' },
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
  assert.equal(chat.turns[0].jobs[1].status, 'interrupted');
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

test('queues in submission order, isolates approvals, stops a partial turn, and retries the original input', async (t) => {
  const path = await fixture(t);
  const store = new NotebookStore(path);
  const seen = [];
  const runtime = {
    async *stream(request, controls) {
      seen.push(request);
      if (request.question === 'pending' && seen.length === 1) {
        yield 'partial';
        const approved = await controls.approve({
          kind: 'Command execution',
          detail: 'fixture action',
        });
        controls.signal.throwIfAborted();
        yield approved ? 'approved' : 'declined';
        return;
      }
      yield 'answer ' + request.question;
    },
  };
  const service = new ChatService(store, runtime, () => {});
  const a = { id: 'a', root: '/workspace/a', name: 'A' };
  const first = await service.create(a.id);
  const second = await service.create(a.id);
  await service.send(a, first.id, 'pending', 'first');
  await until(() => service.listApprovals(a.id).length === 1);
  const [approval] = service.listApprovals(a.id);
  assert.equal(approval.chatId, first.id);
  assert.throws(
    () => service.decideApproval('b', approval.id, true),
    /no longer pending/,
  );

  await service.send(a, second.id, 'runs next', 'second');
  await service.send(a, first.id, 'runs last', 'third');
  await service.send(a, second.id, 'must not run', 'cancelled');
  const before = await service.list(a.id);
  assert.equal(before[0].turns[0].jobs[0].answer, 'partial');
  assert.equal(before[0].turns[1].jobs[0].status, 'queued');
  await service.stop(a.id, before[1].turns[1].jobs[0].id);
  await service.stop(a.id, approval.jobId);
  await until(() => !service.isRunning(a.id));
  assert.deepEqual(
    seen.map((request) => request.question),
    ['pending', 'runs next', 'runs last'],
  );
  assert.equal(service.listApprovals(a.id).length, 0);

  const moved = { ...a, root: '/workspace/moved' };
  await assert.rejects(
    service.retry(moved, first.id, approval.jobId, false),
    /Confirm the new project folder/,
  );
  await service.retry(moved, first.id, approval.jobId, true);
  await until(() => !service.isRunning(a.id));
  const [chat] = await service.list(a.id);
  assert.equal(chat.turns.length, 2);
  assert.equal(chat.turns[0].jobs[0].status, 'interrupted');
  assert.equal(chat.turns[0].jobs[0].answer, 'partial');
  assert.equal(chat.turns[0].jobs[1].retryOf, approval.jobId);
  assert.equal(chat.turns[0].jobs[1].cwd, moved.root);
  assert.equal(chat.turns[0].jobs[1].status, 'complete');
  assert.deepEqual(seen.at(-1).context, []);
  await service.send(moved, first.id, 'follow-up', 'followup');
  await until(() => !service.isRunning(a.id));
  assert.deepEqual(
    seen.at(-1).context.map((entry) => entry.answer),
    ['answer pending', 'answer runs last'],
  );
  assert.equal(seen.at(-1).context[0].jobId, chat.turns[0].jobs[1].id);
});

test('pins a repeated passage and preserves revision history, notes, and ancestry', async (t) => {
  const path = await fixture(t);
  const seen = [];
  const service = new ChatService(
    new NotebookStore(path),
    {
      async *stream(request) {
        seen.push(request);
        yield 'same phrase, same phrase';
      },
    },
    () => {},
  );
  const project = { id: 'project', root: '/workspace', name: 'Project' };
  const chat = await service.create(project.id);
  await service.send(project, chat.id, 'Original question', 'original');
  await until(() => !service.isRunning(project.id));
  const [saved] = await service.list(project.id);
  const turn = saved.turns[0];
  const [job] = turn.jobs;
  const address = {
    conversationId: chat.id,
    messageId: job.id,
    revisionId: job.id,
  };
  const quote = 'same phrase';
  const start = job.answer.lastIndexOf(quote);
  const passage = { ...address, start, end: start + quote.length, quote };
  await assert.rejects(
    service.createDiscussion(project.id, { ...passage, quote: 'mismatch' }),
    /does not match/,
  );
  await assert.rejects(
    service.createDiscussion('another', passage),
    /not found in this project/,
  );
  await service.addMessageNote(project.id, address, 'Note on original answer');
  const branch = await service.createDiscussion(project.id, passage);
  await service.reviseMessage(project.id, address, 'Edited answer');
  await assert.rejects(
    service.reviseMessage(project.id, address, 'stale edit'),
    /changed since/,
  );
  await service.reviseMessage(
    project.id,
    { conversationId: chat.id, messageId: turn.id, revisionId: turn.id },
    'Edited question',
  );
  await service.send(project, branch.id, 'Branch follow-up', 'branch');
  await until(() => !service.isRunning(project.id));
  assert.equal(seen.at(-1).context[0].answer, 'same phrase, same phrase');
  assert.deepEqual(seen.at(-1).context[0].passage, passage);

  await service.send(project, chat.id, 'Main follow-up', 'main');
  await until(() => !service.isRunning(project.id));
  assert.equal(seen.at(-1).context[0].question, 'Edited question');
  assert.equal(seen.at(-1).context[0].answer, 'Edited answer');
  const [main, discussion] = await new NotebookStore(path).list(project.id);
  assert.equal(main.turns[0].jobs[0].answer, 'same phrase, same phrase');
  assert.deepEqual(
    main.turns[0].jobs[0].revisions.map((revision) => revision.text),
    ['same phrase, same phrase', 'Edited answer'],
  );
  assert.equal(main.turns[0].jobs[0].notes[0].revisionId, job.id);
  assert.equal(discussion.source.start, start);
  assert.equal(discussion.source.revisionId, job.id);
});
