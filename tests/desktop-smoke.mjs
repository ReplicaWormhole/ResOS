import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
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
        env: { ...process.env, RESOS_RUNTIME: 'demo', XDG_CONFIG_HOME: config },
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
      env: {
        ...process.env,
        RESOS_RUNTIME: 'demo',
        XDG_CONFIG_HOME: join(root, 'config'),
      },
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
      await window.locator('#file-tree summary').press('Enter');
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

test(
  'chat keeps project and conversation identity across switches, relink, and restart',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resos-chat-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const alpha = join(root, 'Alpha');
    const moved = join(root, 'Alpha moved');
    const beta = join(root, 'Beta');
    await Promise.all([mkdir(alpha), mkdir(beta)]);
    await writeFile(join(alpha, 'notes.txt'), 'original project');
    const executablePath = process.env.RESOS_EXECUTABLE;
    const launch = () =>
      electron.launch({
        executablePath,
        args: executablePath ? [] : ['.'],
        chromiumSandbox: true,
        env: {
          ...process.env,
          RESOS_RUNTIME: 'demo',
          XDG_CONFIG_HOME: join(root, 'config'),
        },
        timeout: 15_000,
      });

    const app = await launch();
    try {
      const window = await app.firstWindow();
      async function choose(label, folder) {
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [path],
          });
        }, folder);
        await window.getByRole('button', { name: label, exact: true }).click();
      }
      const project = (name) =>
        window.getByRole('button', { name, exact: true });
      const composer = window.getByRole('textbox', { name: 'Message' });
      const transcript = window.locator('#chat-transcript');
      const send = window.getByRole('button', { name: 'Send', exact: true });
      const newChat = window.getByRole('button', { name: 'New chat' });
      const selector = window.getByLabel('Conversations');

      await choose('Add Project', alpha);
      await choose('Add Project', beta);
      await project('Alpha').click();
      await newChat.click();
      await composer.fill('Alpha question');
      await send.click();
      await transcript.locator('[data-status=running]').waitFor();

      await project('Beta').click();
      await newChat.click();
      await composer.fill('Beta question');
      await send.click();
      await transcript.locator('[data-status=complete]').waitFor();
      assert.match(await transcript.innerText(), /Beta question/);
      assert.doesNotMatch(await transcript.innerText(), /Alpha question/);

      await project('Alpha').click();
      await transcript.locator('[data-status=complete]').waitFor();
      assert.match(await transcript.innerText(), /Alpha question/);
      const originalChatId = await selector.inputValue();
      await newChat.click();
      await transcript
        .getByText('Send a message to start this conversation.')
        .waitFor();
      await composer.fill('Draft on a different chat');
      const draftId = await selector.inputValue();
      assert.notEqual(draftId, originalChatId);
      await selector.selectOption(originalChatId);
      assert.equal(await composer.inputValue(), '');
      await selector.selectOption(draftId);
      assert.equal(await composer.inputValue(), 'Draft on a different chat');
      await selector.selectOption(originalChatId);

      const original = (
        await window.evaluate(() => window.resos.listProjects())
      )[0];
      await rename(alpha, moved);
      await window.getByText(/project folder is unavailable/).waitFor();
      assert.match(await transcript.innerText(), /Alpha question/);
      await composer.fill('After relinking');
      assert.equal(await send.isDisabled(), true);
      await assert.rejects(
        window.evaluate(
          ({ id, chat }) =>
            window.resos.sendChat(id, chat, 'Blocked', 'blocked-test'),
          { id: original.id, chat: originalChatId },
        ),
      );
      await assert.rejects(
        window.evaluate(
          (id) => window.resos.readFile(id, 'notes.txt'),
          original.id,
        ),
      );

      await choose('Locate folder', beta);
      await window.getByText(/already assigned to another project/).waitFor();
      await choose('Locate folder', moved);
      await window.locator('#workspace[data-available=true]').waitFor();
      assert.equal(await window.locator('#project-root').textContent(), moved);
      await project('notes.txt').click();
      assert.equal(
        await window
          .getByRole('textbox', { name: 'File contents' })
          .innerText(),
        'original project',
      );
      await send.click();
      await transcript.locator('[data-status=complete]').nth(1).waitFor();
      const projects = await window.evaluate(() => window.resos.listProjects());
      assert.equal(projects[0].id, original.id);
      const history = await window.evaluate(
        (id) => window.resos.listChats(id),
        original.id,
      );
      assert.deepEqual(
        history[0].turns.map((turn) => turn.jobs[0].cwd),
        [alpha, moved],
      );
      assert.equal(history[0].id, originalChatId);
    } finally {
      await app.close();
    }
    const reopened = await launch();
    try {
      const window = await reopened.firstWindow();
      const transcript = window.locator('#chat-transcript');
      await transcript.getByText('After relinking', { exact: true }).waitFor();
      assert.match(await transcript.innerText(), /Alpha question/);
      assert.equal(await window.locator('#project-root').textContent(), moved);
      await window.getByRole('button', { name: 'Beta', exact: true }).click();
      await transcript.getByText('Beta question', { exact: true }).waitFor();
      assert.doesNotMatch(await transcript.innerText(), /Alpha question/);
    } finally {
      await reopened.close();
    }
  },
);

test(
  'rich selections retain exact source through nested discussions and edits',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resos-discussion-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const projectRoot = join(root, 'Project');
    await mkdir(projectRoot);
    const executablePath = process.env.RESOS_EXECUTABLE;
    const app = await electron.launch({
      executablePath,
      args: executablePath ? [] : ['.'],
      chromiumSandbox: true,
      env: {
        ...process.env,
        RESOS_RUNTIME: 'demo',
        XDG_CONFIG_HOME: join(root, 'config'),
      },
      timeout: 15_000,
    });
    try {
      const window = await app.firstWindow();
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, projectRoot);
      await window.getByRole('button', { name: 'Add Project' }).click();
      await window.getByRole('button', { name: 'New chat' }).click();
      const composer = window.getByRole('textbox', { name: 'Message' });
      const transcript = window.locator('#chat-transcript');
      const send = window.getByRole('button', { name: 'Send', exact: true });
      const html =
        String.fromCharCode(60) +
        'img src="https://example.invalid/no.png" onerror="window.resosUnexpected=true"' +
        String.fromCharCode(62);
      const raw =
        '# Research note\n\nsame phrase, same phrase.\n\n' +
        html +
        '\n\n\\(unclosed\n\n' +
        'Long note paragraph.\n\n'.repeat(20);
      await composer.fill(raw);
      await send.click();
      await transcript.locator('[data-status=complete]').waitFor();
      const question = transcript.locator('article').first();
      await question.getByRole('heading', { name: 'Research note' }).waitFor();
      assert.equal(await question.locator('img').count(), 0);
      assert.match(await question.innerText(), /\\\(unclosed/);
      assert.equal(
        await window.evaluate(() => window.resosUnexpected),
        undefined,
      );

      await composer.fill('Parent draft');
      await question
        .getByText('same phrase, same phrase.', { exact: true })
        .evaluate((node) => {
          const text = node.firstChild;
          const start = text.textContent.lastIndexOf('same phrase');
          const range = node.ownerDocument.createRange();
          range.setStart(text, start);
          range.setEnd(text, start + 'same phrase'.length);
          const selection = node.ownerDocument.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
      const readingPosition = await transcript.evaluate((node) => {
        node.scrollTop = 70;
        return node.scrollTop;
      });
      await question
        .getByRole('button', { name: 'Ask about selection' })
        .evaluate((node) => node.click());
      await transcript.getByText('Discussion source').waitFor();
      assert.match(
        await transcript.locator('blockquote').innerText(),
        /same phrase/,
      );
      assert.equal(
        await window.getByLabel('Conversations').locator('option').count(),
        1,
      );

      const tex = '\\(a+b\\)';
      await composer.fill('Nested formula ' + tex);
      await send.click();
      await transcript.locator('[data-status=complete]').waitFor();
      await composer.fill('Branch draft');
      const answer = transcript.locator('article[data-status=complete]');
      const math = answer.locator('math');
      await math.waitFor();
      assert.ok(
        (await math.evaluate((node) => node.getBoundingClientRect().width)) > 0,
      );
      await math
        .locator('mi')
        .first()
        .evaluate((node) => {
          const range = node.ownerDocument.createRange();
          range.selectNodeContents(node);
          const selection = node.ownerDocument.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
      await answer.getByRole('button', { name: 'Ask about selection' }).click();
      await transcript.locator('.discussion-source math').waitFor();
      const [project] = await window.evaluate(() =>
        window.resos.listProjects(),
      );
      const chats = await window.evaluate(
        (id) => window.resos.listChats(id),
        project.id,
      );
      assert.equal(chats[1].source.start, raw.lastIndexOf('same phrase'));
      assert.equal(chats[2].source.quote, tex);
      assert.equal(chats[2].source.context.length, 2);
      await composer.fill('Question about the equation');
      await send.click();
      await transcript.locator('[data-status=complete]').waitFor();
      const nested = (
        await window.evaluate((id) => window.resos.listChats(id), project.id)
      )[2];
      assert.equal(nested.turns[0].jobs[0].context.at(-1).passage.quote, tex);

      await window.getByRole('button', { name: 'Back to parent' }).click();
      assert.equal(await composer.inputValue(), 'Branch draft');
      await window.getByRole('button', { name: 'Back to parent' }).click();
      assert.equal(await composer.inputValue(), 'Parent draft');
      assert.equal(
        await transcript.evaluate((node) => node.scrollTop),
        readingPosition,
      );
      assert.equal(await question.locator('mark').count(), 1);
      assert.equal(await question.locator('mark').textContent(), 'same phrase');

      await question
        .getByRole('button', { name: 'Add note', exact: true })
        .click();
      const dialog = window.getByRole('dialog');
      await dialog
        .getByRole('textbox', { name: 'Add note' })
        .fill('Original note');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await question.getByRole('button', { name: 'Edit message' }).click();
      await dialog
        .getByRole('textbox', { name: 'Edit message' })
        .fill('Revised source');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await question.getByText('Your note · earlier revision').waitFor();
      await question.getByRole('button', { name: 'Revision history' }).click();
      assert.match(await dialog.innerText(), /Revised source/);
      assert.match(await dialog.innerText(), /same phrase, same phrase/);
      await dialog.getByRole('button', { name: 'Close' }).click();
      await question
        .getByRole('button', { name: /Open discussion.*earlier revision/ })
        .click();
      await transcript.getByText('Source revision', { exact: true }).click();
      assert.match(
        await transcript.locator('.discussion-source pre').innerText(),
        /same phrase, same phrase/,
      );
    } finally {
      await app.close();
    }
  },
);
