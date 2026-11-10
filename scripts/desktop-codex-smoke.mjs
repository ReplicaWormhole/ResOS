import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const root = await mkdtemp(join(tmpdir(), 'resos-desktop-live-'));
const workspace = join(root, 'Fixture');
await mkdir(workspace);
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
  await window
    .getByRole('textbox', { name: 'Message' })
    .fill(
      'Reply with RESOS_DESKTOP_OK and nothing else. Do not run tools or change files.',
    );
  await window.getByRole('button', { name: 'Send', exact: true }).click();
  const result = window.locator(
    '#chat-transcript [data-status=complete], #chat-transcript [data-status=failed]',
  );
  await result.waitFor({ timeout: 90_000 });
  assert.equal(
    await result.getAttribute('data-status'),
    'complete',
    await result.innerText(),
  );
  assert.match(await result.innerText(), /RESOS_DESKTOP_OK/);
  const [project] = await window.evaluate(() => window.resos.listProjects());
  const [conversation] = await window.evaluate(
    (id) => window.resos.listChats(id),
    project.id,
  );
  const [attempt] = conversation.turns[0].jobs;
  assert.ok(attempt.threadId && attempt.turnId);
  assert.equal(attempt.cwd, workspace);
  globalThis.console.log(
    'Desktop streamed a live Codex response and persisted its run IDs in an isolated profile.',
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
