import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRuntime } from '../dist/runtime/codex/codex-runtime.js';

const cwd = await mkdtemp(join(tmpdir(), 'resos-codex-smoke-'));
const runtime = new CodexRuntime(process.env.RESOS_CODEX_BIN || 'codex');
try {
  let answer = '';
  for await (const chunk of runtime.stream(
    {
      projectId: 'smoke-project',
      conversationId: 'smoke-conversation',
      cwd,
      question:
        'Reply with RESOS_CODEX_OK and nothing else. Do not run tools or change files.',
      context: [],
    },
    {
      signal: globalThis.AbortSignal.timeout(90_000),
      approve: async () => false,
    },
  )) {
    answer += chunk;
  }
  assert.match(answer, /RESOS_CODEX_OK/);
  globalThis.console.log(
    'Codex returned the expected marker in an isolated workspace.',
  );
} finally {
  runtime.close();
  await rm(cwd, { recursive: true, force: true });
}
