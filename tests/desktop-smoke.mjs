import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { _electron as electron } from 'playwright-core';

test(
  'desktop adds, deduplicates, and restores projects',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resos-desktop-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const config = join(root, 'config');
    const alpha = join(root, 'Alpha');
    const beta = join(root, 'Beta');
    const alias = join(root, 'Alias');
    await Promise.all([mkdir(alpha), mkdir(beta)]);
    await symlink(alpha, alias, 'dir');

    const executablePath = process.env.RESOS_EXECUTABLE;
    const launch = () =>
      electron.launch({
        executablePath,
        args: executablePath ? [] : ['.'],
        chromiumSandbox: true,
        env: { ...process.env, XDG_CONFIG_HOME: config },
        timeout: 15_000,
      });

    let saved;
    const app = await launch();
    try {
      assert.ok(
        (await app.evaluate(({ app }) => app.getPath('userData'))).startsWith(
          config + '/',
        ),
      );
      const window = await app.firstWindow();
      assert.equal(
        await window.evaluate(() => typeof window.require),
        'undefined',
      );
      assert.equal(
        await window.evaluate(() => typeof window.process),
        'undefined',
      );
      const add = window.getByRole('button', { name: 'Add Project' });
      const projectList = window.getByRole('list', { name: 'Saved projects' });

      for (const [folder, count] of [
        [null, 0],
        [alpha, 1],
        [beta, 2],
        [alias, 2],
      ]) {
        await app.evaluate(({ dialog }, folder) => {
          dialog.showOpenDialog = async (_window, options) => {
            if (!options.properties?.includes('openDirectory')) {
              throw new Error('Expected a folder chooser');
            }
            return {
              canceled: folder === null,
              filePaths: folder ? [folder] : [],
            };
          };
        }, folder);
        await add.click();
        await window.locator('#add-project:enabled').waitFor();
        assert.equal(await projectList.getByRole('button').count(), count);
      }
      await window.getByRole('heading', { name: 'Alpha' }).waitFor();
      assert.equal(await window.locator('#project-root').textContent(), alpha);
      saved = await window.evaluate(() => window.resos.listProjects());
    } finally {
      await app.close();
    }

    const reopened = await launch();
    try {
      const window = await reopened.firstWindow();
      await window.getByRole('button', { name: 'Beta' }).click();
      assert.equal(await window.locator('#project-root').textContent(), beta);
      assert.deepEqual(
        await window.evaluate(() => window.resos.listProjects()),
        saved,
      );
    } finally {
      await reopened.close();
    }
  },
);
