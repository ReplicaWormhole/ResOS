import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clearTimeout, setTimeout } from 'node:timers';
import { runSandboxCommand } from '../dist/runtime/claude/sandbox-command.js';
import {
  createFile,
  snapshotWorkspace,
} from '../dist/workspace/workspace-files.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'resos-claude-workspace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'project');
  const outside = join(directory, 'outside.txt');
  await mkdir(root);
  await writeFile(outside, 'outside');
  await symlink(outside, join(root, 'escape'));
  return { directory, root, outside };
}

test('Claude file creation never replaces an existing path or follows a symlink', async (t) => {
  const { root, outside } = await fixture(t);
  assert.equal(
    (await createFile(root, 'created.txt', 'first')).status,
    'saved',
  );
  assert.deepEqual(await createFile(root, 'created.txt', 'second'), {
    status: 'conflict',
  });
  assert.deepEqual(await createFile(root, 'escape', 'second'), {
    status: 'conflict',
  });
  await assert.rejects(
    createFile(root, '../outside.txt', 'second'),
    /Invalid workspace path/,
  );
  assert.equal(await readFile(join(root, 'created.txt'), 'utf8'), 'first');
  assert.equal(await readFile(outside, 'utf8'), 'outside');
});

test('a command snapshot copies binary files and excludes Git data and symlinks', async (t) => {
  const { directory, root } = await fixture(t);
  const destination = join(directory, 'snapshot');
  const bytes = Buffer.from([0, 255, 4, 7]);
  await mkdir(destination);
  await mkdir(join(root, '.git'));
  await writeFile(join(root, '.git', 'config'), 'private');
  await writeFile(join(root, 'fixture.bin'), bytes);
  await snapshotWorkspace(
    root,
    destination,
    globalThis.AbortSignal.timeout(5000),
  );
  assert.deepEqual(await readFile(join(destination, 'fixture.bin')), bytes);
  for (const entry of ['escape', '.git'])
    await assert.rejects(access(join(destination, entry)), { code: 'ENOENT' });
});

test(
  'the Linux command sandbox isolates writes, sockets, and cancellation',
  {
    skip: process.env.RESOS_TEST_SANDBOX !== '1',
    timeout: 20_000,
  },
  async (t) => {
    const { root, outside } = await fixture(t);
    await writeFile(join(root, 'marker.txt'), 'project marker');
    const result = JSON.parse(
      await runSandboxCommand(
        root,
        [
          '/usr/bin/bash',
          '-c',
          [
            'set -eu',
            'test "$(cat marker.txt)" = "project marker"',
            '! (echo changed > marker.txt)',
            'test ! -e escape && test ! -e "$1"',
            '! (echo blocked > /dev/tcp/127.0.0.1/1)',
            'echo private > /tmp/output && cat /tmp/output',
          ].join('\n'),
          'bash',
          outside,
        ],
        globalThis.AbortSignal.timeout(10_000),
      ),
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'private\n');
    assert.match(result.stderr, /Operation not permitted/);
    assert.equal(
      await readFile(join(root, 'marker.txt'), 'utf8'),
      'project marker',
    );
    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await assert.rejects(
        runSandboxCommand(root, ['/usr/bin/sleep', '30'], controller.signal),
        { name: 'AbortError' },
      );
    } finally {
      clearTimeout(timer);
    }
  },
);
