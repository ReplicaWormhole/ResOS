import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
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
      const files = window.getByRole('button', { name: 'Files', exact: true });
      const chats = window.getByRole('button', { name: 'Chats', exact: true });
      const editor = window.getByRole('region', { name: 'Workspace editor' });
      const chat = window.getByRole('region', { name: 'Chat' });
      const view = (name) =>
        window
          .getByRole('group', { name: 'Workspace view' })
          .getByRole('button', {
            name,
            exact: true,
          });
      await chat.waitFor();
      await editor.waitFor({ state: 'hidden' });
      await files.press('Enter');
      await window.locator('#files-content').waitFor({ state: 'hidden' });
      await window.locator('#chats-content').waitFor();
      await chats.click();
      await window.locator('#chats-content').waitFor({ state: 'hidden' });
      await files.click();
      await window.locator('#files-content').waitFor();
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
      await contents.pressSequentially('TeX draft', { delay: 12 });
      await view('Split view').click();
      await chat.waitFor();
      await view('Chat').click();
      await editor.waitFor({ state: 'hidden' });
      await view('Editor').click();
      await contents.waitFor();
      assert.match(await contents.innerText(), /TeX draft/);

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
      await contents.pressSequentially('Markdown draft', { delay: 12 });
      await mdTab.press('ArrowLeft');
      assert.deepEqual(await contents.locator('.cm-line').allTextContents(), [
        '\\section{Research}',
        'TeX draft',
      ]);
      await contents.press('Control+f');
      const search = window.locator('.cm-search input[name=search]');
      await search.fill('TeX draft');
      await search.press('End');
      await search.press('Enter');
      await contents
        .locator('.cm-searchMatch-selected')
        .filter({ hasText: /^TeX draft$/ })
        .waitFor();
      await search.press('Escape');

      await addProject(beta);
      await window.locator('#chats-content').waitFor();
      await window.getByRole('button', { name: 'script.py' }).click();
      await contents.locator('span').filter({ hasText: /^def$/ }).waitFor();
      await contents.press('Control+End');
      await contents.pressSequentially('# Beta draft', { delay: 12 });
      await contents.press('Control+s');
      await window.getByText(/Saved on disk/).waitFor();
      assert.equal(
        await readFile(py, 'utf8'),
        'def research():\n    return 1\n# Beta draft',
      );

      await window.getByRole('button', { name: 'Alpha', exact: true }).click();
      await window.locator('#chats-content').waitFor({ state: 'hidden' });
      await contents.getByText('TeX draft', { exact: true }).waitFor();
      await mdTab.click();
      assert.deepEqual(await contents.locator('.cm-line').allTextContents(), [
        '# Initial heading',
        'Markdown draft',
      ]);
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

      await view('Editor').click();
      await chat.waitFor({ state: 'hidden' });
      await view('Split view').click();
      await chat.waitFor();
      await view('Chat').click();
      await editor.waitFor({ state: 'hidden' });
      await view('Split view').click();
      await editor.waitFor();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(640, 420),
      );
      await window.waitForFunction(() => window.innerWidth <= 640);
      assert.ok(
        (await window.locator('#chat-transcript').boundingBox()).height >= 70,
      );
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
      const chatList = window.getByRole('list', { name: 'Conversations' });
      const activeChat = chatList.locator('[aria-current=true]');
      const chooseChat = (id) =>
        chatList.locator('[data-chat-id="' + id + '"]').click();

      await choose('Add Project', alpha);
      await choose('Add Project', beta);
      await project('Alpha').click();
      await newChat.click();
      await window.emulateMedia({ colorScheme: 'dark' });
      assert.deepEqual(
        await window.evaluate(() => {
          const style = globalThis.getComputedStyle(
            globalThis.document.documentElement,
          );
          return {
            color: style.color,
            background: style.backgroundColor,
            scheme: style.colorScheme,
          };
        }),
        {
          color: 'rgb(23, 23, 23)',
          background: 'rgb(255, 255, 255)',
          scheme: 'light',
        },
      );
      await composer.press('Enter');
      await composer.fill('First line');
      await composer.press('Shift+Enter');
      await composer.press('s');
      assert.equal(await composer.inputValue(), 'First line\ns');
      await composer.dispatchEvent('keydown', {
        key: 'Enter',
        isComposing: true,
      });
      await composer.dispatchEvent('keydown', { key: 'Enter', repeat: true });
      const [alphaProject] = await window.evaluate(() =>
        window.resos.listProjects(),
      );
      const [emptyChat] = await window.evaluate(
        (id) => window.resos.listChats(id),
        alphaProject.id,
      );
      assert.equal(emptyChat.turns.length, 0);
      assert.equal(await composer.inputValue(), 'First line\ns');
      await composer.fill('Alpha question');
      await window.getByRole('button', { name: 'Preview context' }).click();
      const preview = window.getByRole('dialog', { name: 'Context preview' });
      await preview.getByText('Alpha question', { exact: true }).waitFor();
      await preview.getByText(/Notebook lookup off/).waitFor();
      assert.equal(
        await window
          .getByRole('checkbox', { name: 'Allow notebook lookup' })
          .count(),
        0,
      );
      await preview
        .getByRole('button', { name: 'Send reviewed input' })
        .click();
      await transcript.locator('[data-status=running]').waitFor();

      await project('Beta').click();
      await newChat.click();
      await composer.fill('Beta question');
      await composer.press('Enter');
      await composer.press('Enter');
      await transcript.locator('[data-status=complete]').waitFor();
      assert.match(await transcript.innerText(), /Beta question/);
      assert.doesNotMatch(await transcript.innerText(), /Alpha question/);
      assert.equal(
        await transcript.locator('article[data-role=user]').count(),
        1,
      );
      assert.equal(await transcript.locator('article > strong').count(), 0);
      const bubble = transcript.locator('article[data-role=user] > .chat-rich');
      assert.equal(
        await bubble.evaluate(
          (element) => globalThis.getComputedStyle(element).backgroundColor,
        ),
        'rgb(240, 240, 240)',
      );
      const userBounds = await bubble.boundingBox();
      const answerBounds = await transcript
        .locator('article[data-role=assistant]')
        .boundingBox();
      assert.ok(userBounds && answerBounds && userBounds.x > answerBounds.x);

      await project('Alpha').click();
      await transcript.locator('[data-status=complete]').waitFor();
      assert.match(await transcript.innerText(), /Alpha question/);
      const finished = transcript.locator('article[data-status=complete]');
      await finished.getByLabel('Message actions', { exact: true }).click();
      await finished.getByText('Run context', { exact: true }).click();
      const prepared = finished
        .locator('details')
        .filter({ has: window.locator('summary:text-is("Prepared input")') })
        .last();
      await prepared.getByText('Prepared input', { exact: true }).click();
      assert.equal(
        await prepared.locator('pre').textContent(),
        'Alpha question',
      );
      await finished.getByLabel('Message actions', { exact: true }).click();
      const originalChatId = await activeChat.getAttribute('data-chat-id');
      await newChat.click();
      await transcript
        .getByText('Send a message to start this conversation.')
        .waitFor();
      await composer.fill('Draft on a different chat');
      const draftId = await activeChat.getAttribute('data-chat-id');
      assert.notEqual(draftId, originalChatId);
      await chooseChat(originalChatId);
      assert.equal(await composer.inputValue(), '');
      await chooseChat(draftId);
      assert.equal(await composer.inputValue(), 'Draft on a different chat');
      await chooseChat(originalChatId);

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
      await chooseChat(originalChatId);
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
      await project('Files').click();
      await window.locator('#files-content').waitFor({ state: 'hidden' });
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
      await window.locator('#files-content').waitFor({ state: 'hidden' });
      await window.locator('#chats-content').waitFor();
      await window.getByRole('button', { name: 'Beta', exact: true }).click();
      await window.locator('#files-content').waitFor();
      await transcript
        .locator('.chat-rich')
        .getByText('Beta question', { exact: true })
        .waitFor();
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
      const readingPosition = await transcript.evaluate((node) => {
        node.scrollTop = 70;
        return node.scrollTop;
      });
      assert.ok(Math.abs(readingPosition - 70) < 1);
      const views = window.getByRole('group', { name: 'Workspace view' });
      await views.getByRole('button', { name: 'Editor', exact: true }).click();
      await transcript.waitFor({ state: 'hidden' });
      await views.getByRole('button', { name: 'Chat', exact: true }).click();
      assert.equal(await composer.inputValue(), 'Parent draft');
      assert.equal(
        await transcript.evaluate((node) => node.scrollTop),
        readingPosition,
      );
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
      const selection = window.getByRole('group', {
        name: 'Selection actions',
      });
      const ask = selection.getByRole('button', {
        name: 'Ask about selection',
      });
      await ask.waitFor();
      await window.evaluate(async () => {
        const [project] = await window.resos.listProjects();
        const [chat] = await window.resos.listChats(project.id);
        const job = chat.turns[0].jobs[0];
        await window.resos.addMessageNote(
          project.id,
          {
            conversationId: chat.id,
            messageId: job.id,
            revisionId: job.id,
          },
          'Unrelated transcript refresh',
        );
      });
      await transcript
        .getByText('Unrelated transcript refresh', { exact: true })
        .waitFor();
      assert.equal(
        await question.evaluate((node) =>
          node.ownerDocument.getSelection().toString(),
        ),
        'same phrase',
      );
      await ask.click();
      await window.getByRole('region', { name: 'Parent chat' }).waitFor();
      await transcript.getByText('Discussion source').waitFor();
      assert.match(
        await transcript.locator('blockquote').innerText(),
        /same phrase/,
      );
      assert.equal(
        await window
          .getByRole('list', { name: 'Conversations' })
          .getByRole('button')
          .count(),
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
      await ask.click();
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

      const parent = window.getByRole('region', { name: 'Parent chat' });
      await question
        .getByRole('button', { name: 'Open linked discussion' })
        .press('Enter');
      await parent.waitFor();
      await window.getByRole('button', { name: 'Expand', exact: true }).click();
      await parent.waitFor({ state: 'hidden' });
      assert.equal(await composer.inputValue(), 'Branch draft');
      await window.getByRole('button', { name: 'Restore side chat' }).click();
      await parent.waitFor();
      await window.getByRole('button', { name: 'Back to parent' }).click();

      const paragraph = question
        .locator('.chat-rich p')
        .filter({ hasText: 'same phrase, same phrase.' })
        .first();
      async function selectParagraph() {
        await paragraph.scrollIntoViewIfNeeded();
        await paragraph.evaluate((node) => {
          const range = node.ownerDocument.createRange();
          range.selectNodeContents(node);
          const selection = node.ownerDocument.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
      }
      await selectParagraph();
      await ask.click();
      await parent.waitFor();
      await window.getByRole('button', { name: 'Back to parent' }).click();
      const overlap = question
        .locator('mark')
        .filter({ hasText: /^same phrase$/ })
        .last();
      await overlap.press('Enter');
      const chooser = window.getByRole('dialog');
      await chooser.getByText('Choose a discussion', { exact: true }).waitFor();
      assert.equal(
        await chooser.getByRole('button', { name: /^Discussion/ }).count(),
        2,
      );
      await chooser.getByRole('button', { name: 'Close' }).click();

      await selectParagraph();
      await selection.waitFor();
      await window.keyboard.press('Alt+Shift+a');
      assert.equal(
        await selection.evaluate(
          (node) => node.ownerDocument.activeElement.textContent,
        ),
        'Annotate',
      );
      await window.keyboard.press('Enter');
      const dialog = window.getByRole('dialog');
      await dialog
        .getByRole('textbox', { name: 'Annotate passage' })
        .fill('Original note');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await question.getByText('Original note', { exact: true }).waitFor();

      await selectParagraph();
      await selection.getByRole('button', { name: 'Add to chat' }).click();
      const quoteDraft = window.locator('#draft-excerpts');
      await quoteDraft
        .getByText('same phrase, same phrase.', { exact: true })
        .waitFor();
      assert.equal(await composer.inputValue(), 'Parent draft');
      assert.equal(
        await transcript.locator('[data-status=complete]').count(),
        1,
      );
      await quoteDraft.getByRole('button', { name: 'Remove quote' }).click();
      await quoteDraft
        .getByText('same phrase, same phrase.', { exact: true })
        .waitFor({ state: 'hidden' });

      await question.getByLabel('Message actions', { exact: true }).click();
      await question.getByRole('button', { name: 'Edit message' }).click();
      await dialog
        .getByRole('textbox', { name: 'Edit message' })
        .fill('Revised source');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await question.getByText('Your note · earlier revision').waitFor();
      if (
        !(await question
          .getByRole('button', { name: 'Revision history' })
          .isVisible())
      )
        await question.getByLabel('Message actions', { exact: true }).click();
      await question.getByRole('button', { name: 'Revision history' }).click();
      assert.match(await dialog.innerText(), /Revised source/);
      assert.match(await dialog.innerText(), /same phrase, same phrase/);
      await dialog.getByRole('button', { name: 'Close' }).click();
      await question
        .getByRole('button', { name: /Open discussion.*earlier revision/ })
        .first()
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

test(
  'file excerpts preserve unsaved TeX and only jump to a matching source',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resos-excerpt-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const projectRoot = join(root, 'Project');
    await mkdir(projectRoot);
    const path = join(projectRoot, 'draft.tex');
    await writeFile(path, 'Saved line\n');
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
    const tex = '\\beta + 1';
    try {
      const window = await app.firstWindow();
      await app.evaluate(({ dialog }, workspace) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [workspace],
        });
      }, projectRoot);
      await window.getByRole('button', { name: 'Add Project' }).click();
      await window.getByRole('button', { name: 'draft.tex' }).click();
      const contents = window.getByRole('textbox', { name: 'File contents' });
      await contents.press('Control+End');
      await contents.pressSequentially(tex, { delay: 12 });
      assert.equal(
        await contents.locator('.cm-line').last().textContent(),
        tex,
      );
      await contents.press('Shift+Home');
      const attach = window
        .getByRole('group', { name: 'Selection actions' })
        .getByRole('button', { name: 'Add to chat' });
      await attach.click();
      const draft = window.locator('#draft-excerpts');
      await draft.getByText('draft.tex:2 · Unsaved buffer').waitFor();
      assert.equal(await draft.locator('pre').textContent(), tex);
      await window
        .getByRole('textbox', { name: 'Message' })
        .fill('What does this excerpt mean?');
      await window.getByRole('button', { name: 'Send', exact: true }).click();
      const transcript = window.locator('#chat-transcript');
      await transcript.locator('[data-status=complete]').waitFor();
      const jump = transcript.getByRole('button', {
        name: 'Jump to file excerpt',
      });
      await jump.waitFor();
      assert.equal(await readFile(path, 'utf8'), 'Saved line\n');
      await contents.press('Control+Home');
      await jump.click();
      assert.equal(
        await contents.evaluate((node) =>
          node.ownerDocument.getSelection().toString(),
        ),
        tex,
      );
      const selection = window.getByRole('group', {
        name: 'Selection actions',
      });
      await selection.getByRole('button', { name: 'Annotate' }).click();
      const dialog = window.getByRole('dialog');
      await dialog
        .getByRole('textbox', { name: 'Annotate file selection' })
        .fill('A local file note');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await window
        .locator('#editor-notes')
        .getByText('Note on line 2')
        .waitFor();
      assert.equal(
        await transcript.locator('[data-status=complete]').count(),
        1,
      );
      const composer = window.getByRole('textbox', { name: 'Message' });
      await composer.fill('Original chat draft');
      await contents.press('Control+End');
      await contents.press('Shift+Home');
      await selection
        .getByRole('button', { name: 'Ask about selection' })
        .click();
      await transcript.getByText('draft.tex:2 · Unsaved buffer').waitFor();
      assert.equal(await composer.inputValue(), '');
      await contents.waitFor();
      await composer.fill('Question in file side chat');
      await window.getByRole('button', { name: 'Send', exact: true }).click();
      await transcript.locator('[data-status=complete]').waitFor();
      await contents.press('Control+Home');
      await window.keyboard.insertText('Changed ');
      await jump.waitFor({ state: 'hidden' });
      await window
        .locator('#editor-notes')
        .getByText('Note on line 2')
        .waitFor({ state: 'hidden' });
      await window.getByRole('button', { name: 'Back to file' }).click();
      assert.equal(await composer.inputValue(), 'Original chat draft');
      await window
        .getByRole('list', { name: 'Conversations' })
        .getByText('File', { exact: true })
        .waitFor();

      window.once('dialog', (prompt) => void prompt.accept());
      await window
        .getByRole('button', { name: 'Ask about saved file' })
        .click();
      await transcript.getByText(/Reads the current on-disk file/).waitFor();
      assert.equal(await transcript.locator('.file-excerpt').count(), 0);
      await window.getByRole('button', { name: 'Back to file' }).click();
      await rename(path, join(projectRoot, 'moved.tex'));
    } finally {
      await app.close();
    }
    const reopened = await launch();
    try {
      const window = await reopened.firstWindow();
      const transcript = window.locator('#chat-transcript');
      await transcript.getByText('draft.tex:2 · Unsaved buffer').waitFor();
      assert.equal(
        await transcript.locator('.file-excerpt pre').textContent(),
        tex,
      );
      assert.equal(
        await transcript
          .getByRole('button', { name: 'Jump to file excerpt' })
          .count(),
        0,
      );
      await window
        .getByRole('textbox', { name: 'Message' })
        .fill('Use the earlier excerpt');
      await window.getByRole('button', { name: 'Send', exact: true }).click();
      await transcript.locator('[data-status=complete]').nth(1).waitFor();
      const [project] = await window.evaluate(() =>
        window.resos.listProjects(),
      );
      const [chat] = await window.evaluate(
        (id) => window.resos.listChats(id),
        project.id,
      );
      assert.equal(chat.turns[1].jobs[0].context[0].excerpts[0].text, tex);
      assert.equal(chat.turns[0].excerpts[0].unsaved, true);
      const [main, fileChat, wholeFile] = await window.evaluate(
        (id) => window.resos.listChats(id),
        project.id,
      );
      assert.equal(main.id, chat.id);
      assert.equal(fileChat.fileSource.excerpt.text, tex);
      assert.equal(fileChat.turns[0].question, 'Question in file side chat');
      assert.deepEqual(wholeFile.fileSource, { path: 'draft.tex' });
      const sidebar = window.getByRole('list', { name: 'Conversations' });
      await sidebar
        .getByRole('button', {
          name: 'Question in file side chat · File chat',
          exact: true,
        })
        .first()
        .click();
      await transcript
        .getByText('Question in file side chat', { exact: true })
        .waitFor();
      assert.equal(
        await transcript
          .getByRole('button', { name: 'Jump to file excerpt' })
          .count(),
        0,
      );
      await window.getByText('File notes', { exact: true }).click();
      await window.locator('#file-notes summary').click();
      await window
        .locator('#file-notes')
        .getByText('A local file note', { exact: true })
        .waitFor();
    } finally {
      await reopened.close();
    }
  },
);

test(
  'a backup restored into a fresh profile retains projects, revisions, and both source types',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resos-restore-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const projectRoot = join(root, 'Fixture');
    const backup = join(root, 'backup');
    const originalConfig = join(root, 'original-config');
    const restoredConfig = join(root, 'restored-config');
    await mkdir(projectRoot);
    await mkdir(backup, { mode: 0o700 });
    const text = 'Pinned text';
    await writeFile(join(projectRoot, 'fixture.txt'), text);
    const executablePath = process.env.RESOS_EXECUTABLE;
    const launch = (config, binary = executablePath) =>
      electron.launch({
        executablePath: binary,
        args: binary ? [] : ['.'],
        chromiumSandbox: true,
        env: { ...process.env, RESOS_RUNTIME: 'demo', XDG_CONFIG_HOME: config },
        timeout: 15_000,
      });
    const original = await launch(
      originalConfig,
      process.env.RESOS_PREVIOUS_EXECUTABLE,
    );
    let saved;
    let dataDir;
    try {
      await original.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, projectRoot);
      const window = await original.firstWindow();
      await window.getByRole('button', { name: 'Add Project' }).click();
      await window.getByRole('button', { name: 'New chat' }).click();
      await window.locator('#chat-input:enabled').waitFor();
      const [project] = await window.evaluate(() =>
        window.resos.listProjects(),
      );
      const [chat] = await window.evaluate(
        (id) => window.resos.listChats(id),
        project.id,
      );
      const excerpt = {
        projectId: project.id,
        path: 'fixture.txt',
        text,
        start: 0,
        end: text.length,
        startLine: 1,
        endLine: 1,
        capturedAt: '2026-11-10T12:00:00.000Z',
        unsaved: false,
        fingerprint: createHash('sha256').update(text).digest('hex'),
      };
      await window.evaluate(
        ({ projectId, chatId, excerpt }) =>
          window.resos.sendChat(
            projectId,
            chatId,
            'Original question',
            'backup-fixture',
            [excerpt],
          ),
        { projectId: project.id, chatId: chat.id, excerpt },
      );
      await window.locator('#chat-transcript [data-status=complete]').waitFor();
      const [record] = await window.evaluate(
        (id) => window.resos.listChats(id),
        project.id,
      );
      const turn = record.turns[0];
      const address = {
        conversationId: chat.id,
        messageId: turn.id,
        revisionId: turn.id,
      };
      await window.evaluate(
        async ({ projectId, address }) => {
          await window.resos.addMessageNote(
            projectId,
            address,
            'Original note',
          );
          await window.resos.createDiscussion(projectId, {
            ...address,
            start: 0,
            end: 8,
            quote: 'Original',
          });
          await window.resos.reviseMessage(
            projectId,
            address,
            'Edited question',
          );
        },
        { projectId: project.id, address },
      );
      saved = {
        project,
        chats: await window.evaluate(
          (id) => window.resos.listChats(id),
          project.id,
        ),
      };
      dataDir = await original.evaluate(({ app }) => app.getPath('userData'));
      assert.ok(dataDir.startsWith(originalConfig + '/'));
    } finally {
      await original.close();
    }

    const restoredData = join(restoredConfig, basename(dataDir));
    await mkdir(restoredData, { recursive: true, mode: 0o700 });
    for (const file of ['projects.json', 'notebook.json']) {
      await copyFile(join(dataDir, file), join(backup, file));
      await copyFile(join(backup, file), join(restoredData, file));
    }

    const restored = await launch(restoredConfig);
    try {
      const window = await restored.firstWindow();
      const transcript = window.locator('#chat-transcript');
      await transcript.getByText('Edited question', { exact: true }).waitFor();
      assert.deepEqual(
        await window.evaluate(() => window.resos.listProjects()),
        [saved.project],
      );
      assert.deepEqual(
        await window.evaluate(
          (id) => window.resos.listChats(id),
          saved.project.id,
        ),
        saved.chats,
      );
      await transcript.getByText('Original note', { exact: true }).waitFor();
      await transcript.getByText('Pinned text', { exact: true }).waitFor();
      await transcript
        .getByRole('button', { name: /Open discussion.*earlier revision/ })
        .click();
      await transcript.getByText('Discussion source').waitFor();
      await transcript.getByText('Source revision', { exact: true }).click();
      assert.match(
        await transcript.locator('.discussion-source pre').innerText(),
        /Original question/,
      );
      await window.evaluate(
        (id) => window.resos.createChat(id),
        saved.project.id,
      );
      const persisted = JSON.parse(
        await readFile(join(restoredData, 'notebook.json'), 'utf8'),
      );
      assert.equal(persisted.version, 2);
      assert.deepEqual(persisted.conversations.slice(0, 2), saved.chats);
    } finally {
      await restored.close();
    }
  },
);

test(
  'Codex settings drive model, effort and approvals in the desktop composer',
  { timeout: 45_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'resos-codex-settings-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const projectRoot = join(root, 'Fixture');
    await mkdir(projectRoot);
    const executablePath = process.env.RESOS_EXECUTABLE;
    const app = await electron.launch({
      executablePath,
      args: executablePath ? [] : ['.'],
      chromiumSandbox: true,
      env: {
        ...process.env,
        RESOS_RUNTIME: 'codex',
        RESOS_CODEX_BIN: fileURLToPath(
          new URL('./fixtures/codex-app-server.mjs', import.meta.url),
        ),
        XDG_CONFIG_HOME: join(root, 'config'),
      },
      timeout: 15_000,
    });
    try {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, projectRoot);
      const window = await app.firstWindow();
      await window.getByRole('button', { name: 'Add Project' }).click();
      await window.getByRole('button', { name: 'New chat' }).click();
      const model = window.getByLabel('Model', { exact: true });
      const effort = window.getByLabel('Reasoning effort', { exact: true });
      const mode = window.getByLabel('Mode', { exact: true });
      const selector = window.getByRole('button', {
        name: 'Model and thinking settings',
      });
      const menu = window.getByRole('dialog', {
        name: 'Model and thinking settings',
      });
      await model
        .locator('option[value=fixture-b]')
        .waitFor({ state: 'attached' });
      await window.locator('#chat-runtime').waitFor({ state: 'hidden' });
      assert.equal(await model.isVisible(), false);
      assert.match(await selector.innerText(), /Fixture A · Medium/);
      await selector.focus();
      await selector.press('Enter');
      await menu.waitFor();
      assert.equal(await selector.getAttribute('aria-expanded'), 'true');
      await window.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
      assert.equal(
        await selector.evaluate(
          (element) => element === globalThis.document.activeElement,
        ),
        true,
      );
      await selector.click();
      assert.equal(await mode.inputValue(), 'ask');
      assert.equal(await model.inputValue(), 'fixture-a');
      assert.equal(await effort.inputValue(), 'medium');
      await model.selectOption('fixture-b');
      assert.equal(await effort.inputValue(), 'high');
      assert.deepEqual(await effort.locator('option').allTextContents(), [
        'Default',
        'high',
      ]);
      assert.match(await selector.innerText(), /Fixture B · High/);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(640, 420),
      );
      await window.waitForFunction(() => window.innerWidth <= 640);
      const bounds = await menu.boundingBox();
      const viewport = await window.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0);
      assert.ok(bounds.x + bounds.width <= viewport.width);
      assert.ok(bounds.y + bounds.height <= viewport.height);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1050, 700),
      );
      const message = window.getByRole('textbox', { name: 'Message' });
      await message.fill('configured ask');
      await message.click({ position: { x: 5, y: 5 } });
      await menu.waitFor({ state: 'hidden' });
      assert.equal(await model.isVisible(), false);
      await window.getByRole('button', { name: 'Preview context' }).click();
      const preview = window.getByRole('dialog', { name: 'Context preview' });
      await preview
        .getByText('codex · ask · fixture-b · high', { exact: true })
        .waitFor();
      await preview
        .getByRole('button', { name: 'Send reviewed input' })
        .click();
      const transcript = window.locator('#chat-transcript');
      await transcript
        .getByText('partial read-only', { exact: true })
        .waitFor();
      assert.equal(
        await window.getByRole('button', { name: 'Approve once' }).count(),
        0,
      );
      await window.getByRole('button', { name: 'New chat' }).click();
      await transcript
        .getByText('Send a message to start this conversation.', {
          exact: true,
        })
        .waitFor();
      assert.match(await selector.innerText(), /Fixture A · Medium/);
      await selector.click();
      await model.selectOption('fixture-b');
      await mode.selectOption('agent');
      await message.fill('configured agent');
      await message.press('Enter');
      await menu.waitFor({ state: 'hidden' });
      await window.getByRole('button', { name: 'Approve once' }).click();
      await transcript
        .getByText('partial agent approved', { exact: true })
        .waitFor();
      const [project] = await window.evaluate(() =>
        window.resos.listProjects(),
      );
      const chats = await window.evaluate(
        (id) => window.resos.listChats(id),
        project.id,
      );
      assert.deepEqual(
        chats.map((chat) => chat.turns[0].jobs[0].settings),
        [
          { harness: 'codex', mode: 'ask', model: 'fixture-b', effort: 'high' },
          {
            harness: 'codex',
            mode: 'agent',
            model: 'fixture-b',
            effort: 'high',
          },
        ],
      );
      assert.deepEqual(chats[1].turns[0].jobs[0].effectiveSettings, {
        model: 'fixture-b',
        effort: 'high',
      });
    } finally {
      await app.close();
    }
  },
);
