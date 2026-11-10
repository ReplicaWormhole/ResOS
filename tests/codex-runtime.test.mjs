import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { test } from 'node:test';
import { CodexRuntime } from '../dist/runtime/codex/codex-runtime.js';

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'resos-codex-rpc-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const executable = fileURLToPath(
    new URL('./fixtures/codex-app-server.mjs', import.meta.url),
  );
  const runtime = new CodexRuntime(executable);
  t.after(() => runtime.close());
  return { cwd, runtime };
}

test('Codex transport starts a scoped fresh thread and shows the exact file change before approval', async (t) => {
  const { cwd, runtime } = await fixture(t);
  const approvals = [];
  const request = {
    cwd,
    projectId: 'project',
    conversationId: 'conversation',
    question: 'review',
    context: [],
    fileSource: { path: 'notes.tex' },
    passages: [
      {
        conversationId: 'source',
        messageId: 'message',
        revisionId: 'revision',
        start: 0,
        end: 11,
        quote: 'Pinned text',
      },
    ],

    excerpts: [
      {
        projectId: 'project',
        path: 'draft.tex',
        text: 'captured TeX',
        start: 0,
        end: 12,
        startLine: 1,
        endLine: 1,
        capturedAt: '2026-11-10T12:00:00Z',
        unsaved: true,
        fingerprint: 'a'.repeat(64),
      },
    ],
  };
  for (let iteration = 0; iteration < 2; iteration++) {
    const chunks = [];
    for await (const chunk of runtime.stream(request, {
      signal: globalThis.AbortSignal.timeout(5000),
      approve: async (approval) => {
        approvals.push(approval);
        return true;
      },
    }))
      chunks.push(chunk);
    assert.equal(chunks.join(''), 'partial approved');
  }
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0].kind, 'File changes');
  assert.match(approvals[0].detail, /notes\.txt/);
  assert.match(approvals[0].detail, /\+fixture/);
});

test('Codex transport interrupts the active turn and retains the already yielded delta', async (t) => {
  const { cwd, runtime } = await fixture(t);
  const controller = new globalThis.AbortController();
  const stream = runtime.stream(
    {
      cwd,
      projectId: 'project',
      conversationId: 'conversation',
      question: 'interrupt',
      context: [],
    },
    { signal: controller.signal, approve: async () => false },
  );
  assert.equal((await stream.next()).value, 'partial ');
  controller.abort();
  await assert.rejects(stream.next(), { name: 'AbortError' });
});

test('Codex sends the exact prepared input and rejects notebook calls outside the active turn', async (t) => {
  const { cwd, runtime } = await fixture(t);
  const seen = [];
  const request = {
    cwd,
    projectId: 'project',
    conversationId: 'chat',
    question: 'ignored input',
    context: [],
  };
  for await (const chunk of runtime.stream(request, {
    initialInput: 'saved lookup payload',
    signal: globalThis.AbortSignal.timeout(5000),
    approve: async () => false,
    lookupNotebook: async (query) => {
      seen.push(query);
      return [{ excerpt: 'fixture result' }];
    },
  }))
    assert.equal(chunk, 'partial ');
  assert.deepEqual(seen, ['fixture']);
});

test('discovers the paginated Codex catalog and rejects unavailable models and efforts', async (t) => {
  const { cwd, runtime } = await fixture(t);
  const models = await runtime.listModels(cwd);
  assert.deepEqual(models, [
    {
      id: 'fixture-a',
      label: 'Fixture A',
      efforts: ['low', 'medium'],
      defaultEffort: 'medium',
      isDefault: true,
    },
    {
      id: 'fixture-b',
      label: 'Fixture B',
      efforts: ['high'],
      defaultEffort: 'high',
      isDefault: false,
    },
  ]);
  const request = {
    cwd,
    projectId: 'p',
    conversationId: 'chat',
    question: 'not submitted',
    context: [],
  };
  const controls = {
    signal: globalThis.AbortSignal.timeout(5000),
    approve: async () => false,
  };
  await assert.rejects(
    runtime
      .stream(request, {
        ...controls,
        settings: { harness: 'codex', mode: 'agent', model: 'retired' },
      })
      .next(),
    /saved model is unavailable: retired/,
  );
  await assert.rejects(
    runtime
      .stream(request, {
        ...controls,
        settings: {
          harness: 'codex',
          mode: 'ask',
          model: 'fixture-b',
          effort: 'low',
        },
      })
      .next(),
    /saved reasoning effort is unavailable/,
  );
});

test('passes model and effort and enforces distinct Ask and Agent approvals', async (t) => {
  const { cwd, runtime } = await fixture(t);
  const approvals = [];
  for (const mode of ['ask', 'agent']) {
    const identified = [];
    const request = {
      cwd,
      projectId: 'p',
      conversationId: 'chat',
      question: 'configured ' + mode,
      context: [],
    };
    const chunks = [];
    for await (const chunk of runtime.stream(request, {
      settings: { harness: 'codex', mode, model: 'fixture-b', effort: 'high' },
      signal: globalThis.AbortSignal.timeout(5000),
      approve: async (approval) => {
        approvals.push(approval);
        return true;
      },
      identify: async (_thread, _turn, effective) => identified.push(effective),
    }))
      chunks.push(chunk);
    assert.equal(
      chunks.join(''),
      mode === 'ask' ? 'partial read-only' : 'partial agent approved',
    );
    assert.deepEqual(identified, [{ model: 'fixture-b', effort: 'high' }]);
  }
  assert.equal(approvals.length, 1);
  assert.match(approvals[0].detail, /write fixture/);
});

test('stopping at the end of scoped setup prevents a turn from starting', async (t) => {
  const { cwd, runtime } = await fixture(t);
  const controller = new globalThis.AbortController();
  const setup = runtime.scopedClient.bind(runtime);
  runtime.scopedClient = async (...args) => {
    const client = await setup(...args);
    controller.abort();
    return client;
  };
  const stream = runtime.stream(
    {
      cwd,
      projectId: 'project',
      conversationId: 'chat',
      question: 'configured ask',
      context: [],
    },
    {
      settings: {
        harness: 'codex',
        mode: 'ask',
        model: 'fixture-b',
        effort: 'high',
      },
      signal: controller.signal,
      approve: async () =>
        assert.fail('An aborted run cannot request approval'),
      identify: async () => assert.fail('An aborted run cannot start a turn'),
    },
  );
  await assert.rejects(stream.next(), { name: 'AbortError' });
});
