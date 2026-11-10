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
