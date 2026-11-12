import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProjectRegistry } from '../dist/projects/project-registry.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'resos-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, registryFile: join(root, 'app-data', 'projects.json') };
}

test('persists stable projects and deduplicates aliases and simultaneous additions', async (t) => {
  const { root, registryFile } = await fixture(t);
  const alpha = join(root, 'alpha');
  const beta = join(root, 'beta');
  const alias = join(root, 'alias');
  await Promise.all([mkdir(alpha), mkdir(beta)]);
  await symlink(alpha, alias, 'dir');

  const registry = new ProjectRegistry(registryFile);
  assert.deepEqual(await registry.list(), []);
  const [first, second, duplicate] = await Promise.all([
    registry.add(alpha),
    registry.add(beta),
    registry.add(alias),
  ]);
  assert.deepEqual(first, duplicate);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(await new ProjectRegistry(registryFile).list(), [
    first,
    second,
  ]);
  assert.equal((await stat(registryFile)).mode & 0o777, 0o600);
});

test('rejects missing paths and files and accepts a later directory', async (t) => {
  const { root, registryFile } = await fixture(t);
  const file = join(root, 'not-a-folder');
  await writeFile(file, '');
  const registry = new ProjectRegistry(registryFile);

  await assert.rejects(registry.add(join(root, 'missing')), { code: 'ENOENT' });
  await assert.rejects(registry.add(file), /Choose an existing folder/);
  const saved = await registry.add(root);
  assert.deepEqual(await registry.list(), [saved]);
});

test('pin order persists and unpin restores registration order', async (t) => {
  const { root, registryFile } = await fixture(t);
  const registry = new ProjectRegistry(registryFile);
  const alpha = await registry.add(root);
  const betaRoot = join(root, 'beta');
  await mkdir(betaRoot);
  const beta = await registry.add(betaRoot);
  await registry.pin(beta.id, true);
  const reopened = new ProjectRegistry(registryFile);
  assert.deepEqual(
    (await reopened.list()).map(({ id }) => id),
    [beta.id, alpha.id],
  );
  assert.equal((await reopened.list())[0].pinned, true);
  await reopened.pin(beta.id, false);
  assert.deepEqual(
    (await registry.list()).map(({ id }) => id),
    [alpha.id, beta.id],
  );
  await assert.rejects(registry.pin(alpha.id, 'true'), /Invalid pin state/);
  await assert.rejects(registry.pin('missing', true), /Project not found/);
});

test('removal keeps files and restores the same identity when re-added', async (t) => {
  const { root, registryFile } = await fixture(t);
  const registry = new ProjectRegistry(registryFile);
  const folder = join(root, 'project');
  const alias = join(root, 'alias');
  await mkdir(folder);
  await symlink(folder, alias, 'dir');
  const file = join(folder, 'notes.txt');
  await writeFile(file, 'Keep this research.');
  const original = await registry.add(folder);
  await registry.pin(original.id, true);
  await registry.remove(original.id);
  const reopened = new ProjectRegistry(registryFile);
  assert.deepEqual(await reopened.list(), []);
  assert.equal(await readFile(file, 'utf8'), 'Keep this research.');
  await assert.rejects(reopened.pin(original.id, true), /Project not found/);
  await assert.rejects(reopened.remove(original.id), /Project not found/);
  await assert.rejects(reopened.relink(original.id, root), /Project not found/);
  const [restored, duplicate] = await Promise.all([
    reopened.add(alias),
    reopened.add(folder),
  ]);
  assert.equal(restored.id, original.id);
  assert.equal(restored.pinned, false);
  assert.deepEqual(restored, duplicate);
  assert.deepEqual(await registry.list(), [restored]);
});

test('rejects invalid saved pin and removal flags without changing the registry', async (t) => {
  const { root, registryFile } = await fixture(t);
  const registry = new ProjectRegistry(registryFile);
  const project = await registry.add(root);
  for (const flags of [{ pinned: 'yes' }, { removed: 1 }]) {
    const data = JSON.stringify({
      version: 1,
      projects: [{ ...project, ...flags }],
    });
    await writeFile(registryFile, data);
    await assert.rejects(registry.list(), /unsupported format/);
    await assert.rejects(registry.remove(project.id), /unsupported format/);
    assert.equal(await readFile(registryFile, 'utf8'), data);
  }
});

test('surfaces a corrupt registry and preserves its contents', async (t) => {
  const { root, registryFile } = await fixture(t);
  await mkdir(join(root, 'app-data'));
  const corrupt = JSON.stringify({ version: 9, projects: [] });
  await writeFile(registryFile, corrupt);
  const registry = new ProjectRegistry(registryFile);

  await assert.rejects(registry.list(), /unsupported format/);
  await assert.rejects(registry.add(root), /unsupported format/);
  assert.equal(await readFile(registryFile, 'utf8'), corrupt);
});
