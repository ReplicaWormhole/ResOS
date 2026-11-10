import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  listDirectory,
  readFile as readWorkspace,
  saveFile,
} from '../dist/workspace/workspace-files.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'resos-workspace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'project');
  await mkdir(root);
  return { directory, root };
}

test('lists a project, opens UTF-8, and saves without losing mode or text bytes', async (t) => {
  const { root } = await fixture(t);
  const nested = join(root, 'notes');
  await mkdir(nested);
  const path = join(nested, 'draft.tex');
  const original = '\uFEFF\\alpha λ\r\nsecond\r\n';
  await writeFile(path, original);
  await chmod(path, 0o751);

  assert.deepEqual(await listDirectory(root, ''), [
    { kind: 'directory', name: 'notes' },
  ]);
  assert.deepEqual(await listDirectory(root, 'notes'), [
    { kind: 'file', name: 'draft.tex' },
  ]);
  const snapshot = await readWorkspace(root, 'notes/draft.tex');
  assert.equal(snapshot.text, original);
  const newText = original.replace('second', 'updated');
  const result = await saveFile(
    root,
    'notes/draft.tex',
    snapshot.revision,
    newText,
  );
  assert.equal(result.status, 'saved');
  assert.equal(await readFile(path, 'utf8'), newText);
  assert.equal((await stat(path)).mode & 0o777, 0o751);
  assert.deepEqual(await readWorkspace(root, 'notes/draft.tex'), {
    revision: result.revision,
    text: newText,
  });
});

test('rejects a stale save after an external replacement without changing the disk version', async (t) => {
  const { root } = await fixture(t);
  const path = join(root, 'draft');
  const replacement = join(root, 'replacement');
  await writeFile(path, 'old');
  const snapshot = await readWorkspace(root, 'draft');
  await writeFile(replacement, 'external');
  await rename(replacement, path);
  assert.deepEqual(await saveFile(root, 'draft', snapshot.revision, 'draft'), {
    status: 'conflict',
  });
  assert.equal(await readFile(path, 'utf8'), 'external');
  assert.deepEqual(await readdir(root), ['draft']);
});

test('rejects traversal, symlink leaves, symlink directories, and replaced project roots', async (t) => {
  const { directory, root } = await fixture(t);
  const outside = join(directory, 'outside');
  await mkdir(outside);
  const secret = join(outside, 'note');
  await writeFile(secret, 'outside');
  await writeFile(join(root, 'note'), 'inside');
  const snapshot = await readWorkspace(root, 'note');
  await symlink(secret, join(root, 'alias'));
  await symlink(outside, join(root, 'redirect'));
  assert.deepEqual(await listDirectory(root, ''), [
    { kind: 'file', name: 'note' },
  ]);
  for (const path of ['../outside/note', secret, 'alias', 'redirect/note']) {
    await assert.rejects(readWorkspace(root, path));
    await assert.rejects(saveFile(root, path, snapshot.revision, 'modified'));
  }
  await assert.rejects(listDirectory(root, 'redirect'));
  await rename(root, join(directory, 'renamed'));
  await symlink(outside, root);
  await assert.rejects(readWorkspace(root, 'note'));
  assert.equal(await readFile(secret, 'utf8'), 'outside');
});

test('rejects unsupported binary contents and oversized reads', async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'bad-utf8'), Buffer.from([0xff]));
  await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'large'), Buffer.alloc(4 * 1024 * 1024 + 1, 0x41));
  await assert.rejects(readWorkspace(root, 'bad-utf8'), /valid UTF-8/);
  await assert.rejects(readWorkspace(root, 'binary'), /binary data/);
  await assert.rejects(readWorkspace(root, 'large'), /up to 4 MiB/);
});
