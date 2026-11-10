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
