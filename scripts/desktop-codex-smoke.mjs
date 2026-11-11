import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const root = await mkdtemp(join(tmpdir(), 'resos-desktop-live-'));
const workspace = join(root, 'Fixture');
await mkdir(workspace);
const marker = 'RESOS_' + randomUUID();
await writeFile(join(workspace, 'marker.txt'), marker);
const executablePath = process.env.RESOS_EXECUTABLE;
let app;
try {
  app = await electron.launch({
    executablePath,
    args: executablePath ? [] : ['.'],
    chromiumSandbox: true,
    env: {
      ...process.env,
      RESOS_RUNTIME: 'codex',
      XDG_CONFIG_HOME: join(root, 'config'),
    },
  });
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, workspace);
  const window = await app.firstWindow();
  await window.getByRole('button', { name: 'Add Project' }).click();
  await window.getByRole('button', { name: 'New chat' }).click();
  const selector = window.getByRole('button', {
    name: 'Model and thinking settings',
  });
  await selector.click();
  await window.locator('#run-model:enabled').waitFor();
  const model = await window.getByLabel('Model', { exact: true }).inputValue();
  const effort = await window
    .getByLabel('Reasoning effort', { exact: true })
    .inputValue();
  const mode = window.getByLabel('Mode', { exact: true });
  await window.keyboard.press('Escape');
  const results = window.locator(
    '#chat-transcript [data-status=complete], #chat-transcript [data-status=failed]',
  );
  const run = async (selection, question, index) => {
    await selector.click();
    await mode.selectOption(selection);
    await window.getByRole('textbox', { name: 'Message' }).fill(question);
    await window.getByRole('button', { name: 'Send', exact: true }).click();
    const result = results.nth(index);
    await result.waitFor({ timeout: 90_000 });
    const text = await result.innerText();
    assert.equal(await result.getAttribute('data-status'), 'complete', text);
    return text;
  };
  const answer = await run(
    'ask',
    'Read marker.txt and reply with its exact contents. Leave the workspace unchanged.',
    0,
  );
  assert.ok(answer.includes(marker), answer);
  const output = join(workspace, 'agent.txt');
  await assert.rejects(access(output), { code: 'ENOENT' });
  await run(
    'agent',
    'Create agent.txt in the project with exactly RESOS_AGENT_OK followed by a newline. Leave marker.txt unchanged.',
    1,
  );
  assert.equal(await readFile(output, 'utf8'), 'RESOS_AGENT_OK\n');
  assert.equal(await readFile(join(workspace, 'marker.txt'), 'utf8'), marker);
  const [project] = await window.evaluate(() => window.resos.listProjects());
  const [conversation] = await window.evaluate(
    (id) => window.resos.listChats(id),
    project.id,
  );
  for (const [index, expectedMode] of ['ask', 'agent'].entries()) {
    const [attempt] = conversation.turns[index].jobs;
    assert.ok(attempt.threadId && attempt.turnId);
    assert.equal(attempt.cwd, workspace);
    assert.equal(attempt.settings.harness, 'codex');
    assert.equal(attempt.settings.mode, expectedMode);
    assert.equal(attempt.settings.model, model);
    assert.equal(attempt.effectiveSettings.model, model);
    if (effort) assert.equal(attempt.effectiveSettings.effort, effort);
  }
  globalThis.console.log(
    'Packaged Codex Ask read a fixture and Agent wrote a file in the same disposable project. Both runs recorded their model and run IDs.',
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
