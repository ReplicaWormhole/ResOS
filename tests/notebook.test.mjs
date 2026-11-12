import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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

test('deleting a chat removes only its discussion subtree and preserves saved quotes elsewhere', async (t) => {
  const path = await fixture(t);
  const store = new NotebookStore(path);
  const changed = [];
  const service = new ChatService(
    store,
    {
      async *stream() {
        yield 'Saved answer';
      },
    },
    (id) => changed.push(id),
  );
  t.after(() => service.close());
  const project = { id: 'a', root: '/workspace/a', name: 'A' };
  const root = await service.create(project.id);
  const keeper = await service.create(project.id);
  const other = await service.create('b');
  const fileChat = await service.createFileChat(project.id, {
    path: 'notes.txt',
  });
  await service.addFileNote(
    project.id,
    {
      projectId: project.id,
      path: 'notes.txt',
      text: 'Saved file note',
      start: 0,
      end: 15,
      startLine: 1,
      endLine: 1,
      capturedAt: '2026-11-12T12:00:00Z',
      unsaved: false,
      fingerprint: 'a'.repeat(64),
    },
    'Keep this annotation',
  );
  await service.send(project, root.id, 'Original source', 'root');
  await until(() => !service.isRunning(project.id));
  const [saved] = await service.list(project.id);
  const turn = saved.turns[0];
  const passage = {
    conversationId: root.id,
    messageId: turn.id,
    revisionId: turn.revisions?.at(-1)?.id ?? turn.id,
    start: 0,
    end: 8,
    quote: 'Original',
  };
  const child = await service.createDiscussion(project.id, passage);
  await service.send(project, child.id, 'Child source', 'child');
  await until(() => !service.isRunning(project.id));
  const childTurn = (await service.list(project.id)).find(
    ({ id }) => id === child.id,
  ).turns[0];
  const grandchild = await service.createDiscussion(project.id, {
    conversationId: child.id,
    messageId: childTurn.id,
    revisionId: childTurn.revisions?.at(-1)?.id ?? childTurn.id,
    start: 0,
    end: 5,
    quote: 'Child',
  });
  await service.send(
    project,
    keeper.id,
    'Keep this quote',
    'keeper',
    [],
    [passage],
  );
  await until(() => !service.isRunning(project.id));
  const before = await readFile(path, 'utf8');
  await assert.rejects(
    service.deleteChat('b', root.id),
    /not found in this project/,
  );
  await assert.rejects(service.deleteChat(project.id, 'missing'), /not found/);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(
    new Set(await service.deleteChat(project.id, child.id)),
    new Set([child.id, grandchild.id]),
  );
  assert.ok((await service.list(project.id)).some(({ id }) => id === root.id));
  assert.deepEqual(await service.deleteChat(project.id, root.id), [root.id]);
  const reopened = new NotebookStore(path);
  const remaining = await reopened.list(project.id);
  assert.deepEqual(
    remaining.map(({ id }) => id),
    [keeper.id, fileChat.id],
  );
  assert.equal(remaining[0].turns[0].passages[0].quote, 'Original');
  assert.equal(remaining[0].turns[0].jobs[0].answer, 'Saved answer');
  assert.equal((await reopened.list('b'))[0].id, other.id);
  assert.equal(
    (await reopened.listFileNotes(project.id))[0].text,
    'Keep this annotation',
  );
  assert.ok(changed.every((id) => id === project.id));
});

test('deletion rejects queued and running descendants while allowing unrelated chats to be deleted', async (t) => {
  const path = await fixture(t);
  const gates = {
    busy: Promise.withResolvers(),
    child: Promise.withResolvers(),
  };
  const service = new ChatService(
    new NotebookStore(path),
    {
      async *stream({ question }) {
        yield 'Partial answer';
        if (gates[question]) await gates[question].promise;
      },
    },
    () => {},
  );
  t.after(() => {
    for (const gate of Object.values(gates)) gate.resolve();
    service.close();
  });
  const project = { id: 'a', root: '/workspace/a', name: 'A' };
  const root = await service.create(project.id);
  const busy = await service.create(project.id);
  const unrelated = await service.create(project.id);
  await service.send(project, root.id, 'root', 'source');
  await until(() => !service.isRunning(project.id));
  const turn = (await service.list(project.id))[0].turns[0];
  const child = await service.createDiscussion(project.id, {
    conversationId: root.id,
    messageId: turn.id,
    revisionId: turn.id,
    start: 0,
    end: 4,
    quote: 'root',
  });
  await service.send(project, busy.id, 'busy', 'busy');
  await until(
    async () =>
      (await service.list(project.id)).find(({ id }) => id === busy.id).turns[0]
        .jobs[0].status === 'running',
  );
  await service.send(project, child.id, 'child', 'child');
  assert.equal(
    (await service.list(project.id)).find(({ id }) => id === child.id).turns[0]
      .jobs[0].status,
    'queued',
  );
  const before = await readFile(path, 'utf8');
  await assert.rejects(service.deleteChat(project.id, root.id), /Stop or wait/);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(await service.deleteChat(project.id, unrelated.id), [
    unrelated.id,
  ]);
  gates.busy.resolve();
  await until(
    async () =>
      (await service.list(project.id)).find(({ id }) => id === child.id)
        .turns[0].jobs[0].status === 'running',
  );
  await assert.rejects(service.deleteChat(project.id, root.id), /Stop or wait/);
  gates.child.resolve();
  await until(() => !service.isRunning(project.id));
  assert.deepEqual(
    new Set(await service.deleteChat(project.id, root.id)),
    new Set([root.id, child.id]),
  );
  assert.deepEqual(
    (await service.list(project.id)).map(({ id }) => id),
    [busy.id],
  );
});

test('a cancelled queued chat can be deleted while another response continues', async (t) => {
  const path = await fixture(t);
  const gate = Promise.withResolvers();
  const service = new ChatService(
    new NotebookStore(path),
    {
      async *stream() {
        yield 'Partial';
        await gate.promise;
        yield ' complete';
      },
    },
    () => {},
  );
  t.after(() => {
    gate.resolve();
    service.close();
  });
  const project = { id: 'a', root: '/workspace/a', name: 'A' };
  const active = await service.create(project.id);
  const doomed = await service.create(project.id);
  await service.send(project, active.id, 'Keep running', 'active');
  await until(
    async () =>
      (await service.list(project.id))[0].turns[0]?.jobs[0].status ===
      'running',
  );
  await service.send(
    project,
    doomed.id,
    'Cancel this queued response',
    'queued',
  );
  const queued = (await service.list(project.id))[1].turns[0].jobs[0];
  assert.equal(queued.status, 'queued');
  await service.stop(project.id, queued.id);
  assert.deepEqual(await service.deleteChat(project.id, doomed.id), [
    doomed.id,
  ]);
  assert.equal(service.isRunning(project.id), true);
  gate.resolve();
  await until(() => !service.isRunning(project.id));
  const remaining = await new NotebookStore(path).list(project.id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].turns[0].jobs[0].answer, 'Partial complete');
});

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

test('file excerpts stay with the original question, retries, and later context', async (t) => {
  const path = await fixture(t);
  const { bufferFingerprint, matchesExcerpt } =
    await import('../dist/shared/file-excerpt.js');
  const text = '\\alpha';
  const excerpt = {
    projectId: 'project',
    path: 'draft.tex',
    text,
    start: 0,
    end: text.length,
    startLine: 1,
    endLine: 1,
    capturedAt: '2026-11-10T12:00:00Z',
    unsaved: true,
    fingerprint: await bufferFingerprint(text + '\n'),
  };
  assert.equal(await matchesExcerpt(excerpt, text + '\n'), true);
  assert.equal(
    await matchesExcerpt(excerpt, text + '\nchanged somewhere else'),
    false,
  );
  assert.equal(await matchesExcerpt(excerpt, 'moved: ' + text), false);

  const requests = [];
  const service = new ChatService(
    new NotebookStore(path),
    {
      async *stream(request) {
        requests.push(request);
        if (requests.length === 1) throw new Error('fixture failure');
        yield 'answered';
      },
    },
    () => {},
  );
  const project = { id: 'project', root: '/workspace', name: 'Project' };
  const chat = await service.create(project.id);
  await assert.rejects(
    service.send(project, chat.id, 'Question', 'invalid', [
      { ...excerpt, projectId: 'other' },
    ]),
    /Invalid file excerpt/,
  );
  await assert.rejects(
    service.send(project, chat.id, 'Question', 'invalid', [
      { ...excerpt, path: '../outside' },
    ]),
    /Invalid file excerpt/,
  );
  await service.send(project, chat.id, 'Question', 'excerpt', [excerpt]);
  await until(() => !service.isRunning(project.id));
  const [saved] = await service.list(project.id);
  await assert.rejects(
    service.send(project, chat.id, 'Question', 'excerpt', []),
    /different input/,
  );
  await service.retry(project, chat.id, saved.turns[0].jobs[0].id, false);
  await until(() => !service.isRunning(project.id));
  assert.deepEqual(requests[0].excerpts, [excerpt]);
  assert.deepEqual(requests[1].excerpts, [excerpt]);

  await service.send(project, chat.id, 'Follow-up', 'followup');
  await until(() => !service.isRunning(project.id));
  assert.deepEqual(requests[2].context[0].excerpts, [excerpt]);
  const [reopened] = await new NotebookStore(path).list(project.id);
  assert.deepEqual(reopened.turns[0].excerpts, [excerpt]);
});

test('upgrades a v1 notebook and keeps annotations private while file and chat sources reach the runtime', async (t) => {
  const path = await fixture(t);
  const project = { id: 'project', root: '/workspace', name: 'Project' };
  const original = {
    id: 'legacy-chat',
    projectId: project.id,
    title: 'Legacy',
    turns: [
      {
        id: 'original',
        question: 'original passage',
        jobs: [
          {
            id: 'answer',
            cwd: project.root,
            status: 'complete',
            answer: 'old answer',
          },
        ],
      },
    ],
  };
  await writeFile(
    path,
    JSON.stringify({ version: 1, conversations: [original] }),
  );
  const store = new NotebookStore(path);
  const requests = [];
  const service = new ChatService(
    store,
    {
      async *stream(request) {
        requests.push(request);
        yield 'new answer';
      },
    },
    () => {},
  );
  assert.deepEqual(await store.list(project.id), [original]);
  const excerpt = {
    projectId: project.id,
    path: 'notes.tex',
    text: 'unsaved example',
    start: 0,
    end: 15,
    startLine: 1,
    endLine: 1,
    capturedAt: '2026-11-10T12:00:00Z',
    unsaved: true,
    fingerprint: 'a'.repeat(64),
  };
  const passage = {
    conversationId: original.id,
    messageId: 'original',
    revisionId: 'original',
    start: 9,
    end: 16,
    quote: 'passage',
  };
  await service.addMessageNote(
    project.id,
    passage,
    'private message note',
    passage,
  );
  await service.addFileNote(project.id, excerpt, 'private file note');
  await assert.rejects(
    service.addFileNote('other', excerpt, 'invalid'),
    /Invalid file excerpt/,
  );
  assert.deepEqual(await service.listFileNotes('other'), []);
  const source = { path: excerpt.path, excerpt };
  const fileChat = await service.createFileChat(project.id, source);
  const other = await service.create('other');
  await assert.rejects(
    service.send(
      { ...project, id: 'other' },
      other.id,
      'wrong scope',
      'cross-project',
      [],
      [passage],
    ),
    /not found in this project/,
  );
  assert.equal(requests.length, 0);

  await service.send(
    project,
    fileChat.id,
    'Explain both',
    'with-quote',
    [],
    [passage],
  );
  await until(() => !service.isRunning(project.id));
  await assert.rejects(
    service.send(project, fileChat.id, 'Explain both', 'with-quote'),
    /different input/,
  );
  assert.deepEqual(requests[0].fileSource, source);
  assert.deepEqual(requests[0].passages, [passage]);
  await service.send(project, fileChat.id, 'Follow up', 'follow-up');
  await until(() => !service.isRunning(project.id));
  assert.deepEqual(requests[1].context[0].passages, [passage]);
  assert.doesNotMatch(JSON.stringify(requests), /private (file|message) note/);

  const reopened = new NotebookStore(path);
  const [legacy, savedFile] = await reopened.list(project.id);
  assert.equal(legacy.id, original.id);
  assert.deepEqual(legacy.turns[0].notes[0].passage, passage);
  assert.deepEqual(savedFile.fileSource, source);
  assert.deepEqual(
    (await reopened.listFileNotes(project.id))[0].excerpt,
    excerpt,
  );
  assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 2);
});

test('previews bounded input, rejects a stale review, and retries the same payload with scoped lookup', async (t) => {
  const path = await fixture(t);
  const store = new NotebookStore(path);
  const project = { id: 'project', root: '/workspace', name: 'Project' };
  const requests = [];
  const service = new ChatService(
    store,
    {
      supportsNotebookLookup: true,
      inputLimitBytes: 2600,
      async *stream(request, controls) {
        requests.push({ request, input: controls.initialInput });
        await controls.identify('thread-' + requests.length, 'turn');
        if (requests.length === 1) {
          for (let index = 0; index < 4; index++) {
            const matches = await controls.lookupNotebook('scope-token');
            assert.equal(matches.length, 1);
            assert.equal(matches[0].revisionId, 'lookup-revision');
            assert.equal(matches[0].author, 'user');
            assert.match(matches[0].excerpt, /scope-token local/);
          }
          await assert.rejects(
            controls.lookupNotebook('scope-token'),
            /reached its notebook lookup limit/,
          );
          throw new Error('fixture retry');
        }
        yield 'retried';
      },
    },
    () => {},
    'codex',
  );

  const turn = (id, question, answer) => ({
    id,
    question,
    jobs: [
      { id: id + '-answer', cwd: project.root, answer, status: 'complete' },
    ],
  });
  const pinned = 'pin-this';
  const parent = {
    id: 'parent',
    projectId: project.id,
    title: 'Parent',
    turns: [turn('root', pinned + '😀'.repeat(4000), 'long parent answer')],
  };
  await store.change((chats) =>
    chats.push(
      parent,
      {
        id: 'lookups',
        projectId: project.id,
        title: 'Local lookup',
        turns: [
          {
            ...turn('lookup', 'draft', 'done'),
            revisions: [
              {
                id: 'lookup-revision',
                text: 'scope-token local',
                author: 'user',
              },
            ],
            notes: [
              {
                id: 'note',
                revisionId: 'lookup-revision',
                text: 'private scope-token note',
              },
            ],
          },
        ],
      },
      {
        id: 'foreign',
        projectId: 'other',
        title: 'Foreign',
        turns: [turn('foreign-turn', 'scope-token foreign', 'foreign answer')],
      },
    ),
  );
  const passage = {
    conversationId: parent.id,
    messageId: 'root',
    revisionId: 'root',
    start: 0,
    end: pinned.length,
    quote: pinned,
  };
  const discussion = await service.createDiscussion(project.id, passage);
  const sibling = await service.createDiscussion(project.id, passage);
  await store.change((chats) => {
    chats
      .find(({ id }) => id === sibling.id)
      .turns.push(turn('sibling', 'sibling private', 'answer'));
    const target = chats.find(({ id }) => id === discussion.id);
    for (let index = 0; index < 12; index++)
      target.turns.push(
        turn('past-' + index, 'older ' + 'x'.repeat(1000), 'answer'),
      );
    target.turns.push(turn('recent', 'recent useful turn', 'recent answer'));
  });

  const quote = 'attached-source';
  const excerpt = {
    projectId: project.id,
    path: 'source.tex',
    text: quote,
    start: 0,
    end: quote.length,
    startLine: 1,
    endLine: 1,
    capturedAt: '2026-11-10T12:00:00Z',
    unsaved: true,
    fingerprint: 'a'.repeat(64),
  };
  const options = { lookupEnabled: true };
  const preview = () =>
    service.preview(
      project,
      discussion.id,
      'new question',
      [excerpt],
      [],
      options,
    );
  const first = await preview();
  assert.equal(first.usedBytes, Buffer.byteLength(first.initialText));
  assert.ok(first.usedBytes <= first.limitBytes);
  assert.match(first.initialText, /pin-this/);
  assert.match(first.initialText, /attached-source/);
  assert.match(first.initialText, /recent useful turn/);
  assert.match(first.initialText, /new question/);
  assert.doesNotMatch(
    first.initialText,
    /scope-token|foreign answer|sibling private|private scope-token note/,
  );
  assert.ok(
    first.omitted.some(
      ({ turnId, retainedQuote }) => turnId === 'root' && retainedQuote,
    ),
  );
  assert.ok(
    first.omitted.some(
      ({ turnId, questionRevisionId }) =>
        turnId === 'past-0' && questionRevisionId === 'past-0',
    ),
  );

  await service.reviseMessage(
    project.id,
    {
      conversationId: discussion.id,
      messageId: 'recent',
      revisionId: 'recent',
    },
    'recent edited turn',
  );
  await assert.rejects(
    service.send(
      project,
      discussion.id,
      'new question',
      'request',
      [excerpt],
      [],
      { ...options, previewId: first.previewId },
    ),
    /input changed after the preview/,
  );
  await assert.rejects(
    service.send(
      project,
      discussion.id,
      '😃'.repeat(1000),
      'oversized',
      [excerpt],
      [],
      options,
    ),
    /exceed the input limit/,
  );
  assert.equal(requests.length, 0);
  const reviewed = await preview();
  await service.send(
    project,
    discussion.id,
    'new question',
    'request',
    [excerpt],
    [],
    { ...options, previewId: reviewed.previewId },
  );
  await until(() => !service.isRunning(project.id));
  const original = (await service.list(project.id))
    .find(({ id }) => id === discussion.id)
    .turns.at(-1).jobs[0];
  assert.equal(original.status, 'failed');
  assert.equal(original.error, 'fixture retry');
  assert.equal(original.lookups.length, 4);
  assert.equal(original.input.initialText, reviewed.initialText);
  assert.ok(original.submittedAt);
  assert.equal(requests[0].input, reviewed.initialText);
  await service.reviseMessage(
    project.id,
    {
      conversationId: discussion.id,
      messageId: 'recent',
      revisionId: reviewed.context.find(({ turnId }) => turnId === 'recent')
        .questionRevisionId,
    },
    'new revision after failure',
  );
  await service.retry(project, discussion.id, original.id, false);
  await until(() => !service.isRunning(project.id));
  const reopened = (await new NotebookStore(path).list(project.id)).find(
    ({ id }) => id === discussion.id,
  );
  const retry = reopened.turns.at(-1).jobs[1];
  assert.equal(retry.status, 'complete');
  assert.deepEqual(retry.input, original.input);
  assert.deepEqual(retry.context, original.context);
  assert.equal(retry.lookups, undefined);
  assert.deepEqual(requests[1], requests[0]);
});

test('queued settings stay immutable and a replacement run explicitly changes only settings', async (t) => {
  const path = await fixture(t);
  const store = new NotebookStore(path);
  const project = { id: 'p', root: '/workspace', name: 'Project' };
  const seen = [];
  const gate = Promise.withResolvers();
  const service = new ChatService(
    store,
    {
      async *stream({ question }, controls) {
        seen.push({
          question,
          settings: controls.settings,
          input: controls.initialInput,
        });
        if (question === 'hold') {
          await gate.promise;
          yield 'done';
          return;
        }
        if (controls.settings.model === 'retired')
          throw new Error('saved model is unavailable');
        await controls.identify('thread', 'turn', {
          model: controls.settings.model,
          effort: controls.settings.effort,
        });
        yield 'done';
      },
    },
    () => {},
    'codex',
  );
  const chat = await service.create(project.id);
  const settings = {
    harness: 'codex',
    mode: 'ask',
    model: 'retired',
    effort: 'low',
  };
  try {
    await service.send(project, chat.id, 'hold', 'hold');
    const preview = await service.preview(project, chat.id, 'queued', [], [], {
      lookupEnabled: false,
      settings,
    });
    await assert.rejects(
      service.send(project, chat.id, 'queued', 'changed-review', [], [], {
        lookupEnabled: false,
        settings: { ...settings, mode: 'agent' },
        previewId: preview.previewId,
      }),
      /input changed after the preview/,
    );
    await service.send(project, chat.id, 'queued', 'queued', [], [], {
      lookupEnabled: false,
      settings,
      previewId: preview.previewId,
    });
    settings.model = 'replacement';
    settings.effort = 'high';
    settings.mode = 'agent';
    const [queued] = await service.list(project.id);
    assert.equal(queued.turns[1].jobs[0].status, 'queued');
    assert.deepEqual(queued.turns[1].jobs[0].settings, {
      harness: 'codex',
      mode: 'ask',
      model: 'retired',
      effort: 'low',
    });
  } finally {
    gate.resolve();
  }
  await until(() => !service.isRunning(project.id));
  const [failed] = await service.list(project.id);
  const original = failed.turns[1].jobs[0];
  assert.equal(original.status, 'failed');
  await service.retry(project, chat.id, original.id, false);
  await until(() => !service.isRunning(project.id));
  const [stillFailed] = await service.list(project.id);
  const retry = stillFailed.turns[1].jobs[1];
  assert.equal(retry.status, 'failed');
  assert.deepEqual(seen[1], seen[2]);
  await service.retry(project, chat.id, retry.id, false, settings);
  await until(() => !service.isRunning(project.id));
  const [reopened] = await new NotebookStore(path).list(project.id);
  const replacement = reopened.turns[1].jobs[2];
  assert.equal(replacement.status, 'complete');
  assert.deepEqual(replacement.settings, settings);
  assert.deepEqual(replacement.effectiveSettings, {
    model: 'replacement',
    effort: 'high',
  });
  assert.deepEqual(replacement.input, original.input);
  assert.equal(seen[3].input, seen[1].input);
});

test('keeps experimental Claude history and requires an explicit Codex replacement', async (t) => {
  const path = await fixture(t);
  const project = { id: 'p', root: '/workspace', name: 'Project' };
  const original = new ChatService(
    new NotebookStore(path),
    {
      async *stream() {
        yield 'Saved partial answer';
        throw new Error('fixture failure');
      },
    },
    () => {},
    'codex',
  );
  const chat = await original.create(project.id);
  await original.send(project, chat.id, 'Keep this question', 'question');
  await until(() => !original.isRunning(project.id));
  const snapshot = JSON.parse(await readFile(path, 'utf8'));
  const job = snapshot.conversations[0].turns[0].jobs[0];
  job.runtime = 'claude';
  job.settings = {
    harness: 'claude',
    mode: 'ask',
    model: 'fixture',
    effort: 'low',
  };
  job.effectiveSettings = { model: 'fixture', effort: 'low' };
  await writeFile(path, JSON.stringify(snapshot));

  const service = new ChatService(
    new NotebookStore(path),
    {
      async *stream() {
        yield 'Codex answer';
      },
    },
    () => {},
    'codex',
  );
  assert.deepEqual(await service.list(project.id), snapshot.conversations);
  await assert.rejects(
    service.retry(project, chat.id, job.id, false),
    /saved harness is unavailable/,
  );
  await service.retry(project, chat.id, job.id, false, {
    harness: 'codex',
    mode: 'ask',
  });
  await until(() => !service.isRunning(project.id));
  const [reopened] = await service.list(project.id);
  const [saved, replacement] = reopened.turns[0].jobs;
  assert.deepEqual(saved, job);
  assert.equal(replacement.answer, 'Codex answer');
  assert.equal(replacement.runtime, 'codex');
  assert.equal(replacement.retryOf, job.id);
  assert.deepEqual(replacement.input, job.input);
});
