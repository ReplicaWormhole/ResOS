import assert from 'node:assert/strict';
import {
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
    const launch = (binary = executablePath) =>
      electron.launch({
        executablePath: binary,
        args: binary ? [] : ['.'],
        chromiumSandbox: true,
        env: { ...process.env, XDG_CONFIG_HOME: config },
        timeout: 15_000,
      });

    let saved;
    const app = await launch(process.env.RESOS_PREVIOUS_EXECUTABLE);
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

test(
  'workspace editor keeps drafts isolated and detects external changes',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resos-editor-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const alpha = join(root, 'Alpha');
    const beta = join(root, 'Beta');
    const nested = join(alpha, 'notes');
    await Promise.all([mkdir(nested, { recursive: true }), mkdir(beta)]);
    const tex = join(nested, 'draft.tex');
    const md = join(alpha, 'readme.md');
    const py = join(beta, 'script.py');
    await Promise.all([
      writeFile(tex, '\\section{Research}\r\n'),
      writeFile(md, '# Initial heading\n'),
      writeFile(py, 'def research():\n    return 1\n'),
    ]);
    await symlink(py, join(alpha, 'outside.py'));

    const executablePath = process.env.RESOS_EXECUTABLE;
    const app = await electron.launch({
      executablePath,
      args: executablePath ? [] : ['.'],
      chromiumSandbox: true,
      env: { ...process.env, XDG_CONFIG_HOME: join(root, 'config') },
      timeout: 15_000,
    });
    try {
      const window = await app.firstWindow();
      const errors = [];
      window.on('pageerror', (error) => errors.push(error.message));
      window.on('console', (message) => {
        if (
          message.type() === 'error' &&
          /Content Security Policy/.test(message.text())
        )
          errors.push(message.text());
      });
      async function addProject(folder) {
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [path],
          });
        }, folder);
        await window.getByRole('button', { name: 'Add Project' }).click();
      }

      await addProject(alpha);
      await window
        .locator('summary')
        .getByText('notes', { exact: true })
        .waitFor();
      await window.locator('summary').press('Enter');
      await window
        .getByRole('button', { name: 'draft.tex', exact: true })
        .press('Enter');
      const contents = window.getByRole('textbox', { name: 'File contents' });
      await contents.waitFor();
      assert.match(await contents.innerText(), /Research/);
      const texToken = contents
        .locator('span')
        .filter({ hasText: '\\section' });
      await texToken.waitFor();
      assert.notEqual(
        await texToken.evaluate(
          (node) => node.ownerDocument.defaultView.getComputedStyle(node).color,
        ),
        await contents
          .locator('.cm-line')
          .first()
          .evaluate(
            (node) =>
              node.ownerDocument.defaultView.getComputedStyle(node).color,
          ),
      );
      await contents.press('Control+End');
      await window.keyboard.insertText('TeX draft');

      await window
        .getByRole('button', { name: 'readme.md', exact: true })
        .click();
      const mdTab = window.getByRole('tab', { name: 'readme.md' });
      await mdTab.waitFor();
      await contents
        .locator('span')
        .filter({ hasText: 'Initial heading' })
        .waitFor();
      await contents.press('Control+End');
      await window.keyboard.insertText('Markdown draft');
      await mdTab.press('ArrowLeft');
      assert.match(await contents.innerText(), /TeX draft/);
      await contents.press('Control+f');
      const search = window.locator('.cm-search input[name=search]');
      await search.pressSequentially('TeX draft');
      await search.press('Enter');
      await contents
        .locator('.cm-searchMatch-selected')
        .filter({ hasText: /^TeX draft$/ })
        .waitFor();
      await search.press('Escape');

      await addProject(beta);
      await window.getByRole('button', { name: 'script.py' }).click();
      await contents.locator('span').filter({ hasText: /^def$/ }).waitFor();
      await contents.press('Control+End');
      await window.keyboard.insertText('# Beta draft');
      await contents.press('Control+s');
      await window.getByText(/Saved on disk/).waitFor();
      assert.equal(
        await readFile(py, 'utf8'),
        'def research():\n    return 1\n# Beta draft',
      );

      await window.getByRole('button', { name: 'Alpha', exact: true }).click();
      assert.match(await contents.innerText(), /TeX draft/);
      await mdTab.click();
      assert.match(await contents.innerText(), /Markdown draft/);
      assert.equal(await readFile(md, 'utf8'), '# Initial heading\n');

      await window.getByRole('tab', { name: 'draft.tex' }).click();
      await contents.press('Control+s');
      await window.getByText(/Saved on disk/).waitFor();
      assert.equal(
        await readFile(tex, 'utf8'),
        '\\section{Research}\r\nTeX draft',
      );
      await writeFile(tex, '\\section{External clean edit}\r\n');
      await window.getByText(/Updated from disk/).waitFor();
      assert.match(await contents.innerText(), /External clean edit/);

      await mdTab.click();
      await writeFile(md, '# External dirty edit\n');
      await window.getByText(/Your draft is preserved/).waitFor();
      await contents.press('Control+s');
      await window
        .getByRole('button', { name: 'Save', exact: true })
        .locator('xpath=self::*[not(@disabled)]')
        .waitFor();
      assert.match(await contents.innerText(), /Markdown draft/);
      assert.equal(await readFile(md, 'utf8'), '# External dirty edit\n');
      const projects = await window.evaluate(() => window.resos.listProjects());
      await assert.rejects(
        window.evaluate(
          (id) => window.resos.readFile(id, 'outside.py'),
          projects[0].id,
        ),
      );
      await assert.rejects(
        window.evaluate(
          (id) => window.resos.readFile(id, '../Beta/script.py'),
          projects[0].id,
        ),
      );

      const reload = window.getByRole('button', { name: 'Reload file' });
      window.once('dialog', (dialog) => void dialog.dismiss());
      await reload.click();
      assert.match(await contents.innerText(), /Markdown draft/);
      window.once('dialog', (dialog) => void dialog.accept());
      await reload.click();
      await window.getByText(/Reloaded from disk/).waitFor();
      assert.match(await contents.innerText(), /External dirty edit/);

      const chat = window.getByRole('region', { name: 'Chat' });
      const editor = window.getByRole('region', { name: 'Workspace editor' });
      await window.getByRole('button', { name: 'Expand editor' }).click();
      await chat.waitFor({ state: 'hidden' });
      await window.getByRole('button', { name: 'Restore split view' }).click();
      await chat.waitFor();
      await window.getByRole('button', { name: 'Expand chat' }).click();
      await editor.waitFor({ state: 'hidden' });
      await window.getByRole('button', { name: 'Restore split view' }).click();
      await editor.waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await app.close();
    }
  },
);
