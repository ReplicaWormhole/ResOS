import assert from 'node:assert/strict';
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
const verifyClaude = process.env.RESOS_VERIFY_CLAUDE === '1';
const marker = 'RESOS_CLAUDE_WORKSPACE_OK';
if (verifyClaude) await writeFile(join(workspace, 'marker.txt'), marker);
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
  const transcript = window.locator('#chat-transcript');
  const send = async (text) => {
    await window.getByRole('textbox', { name: 'Message' }).fill(text);
    await window.getByRole('button', { name: 'Send', exact: true }).click();
  };
  const completed = async (index) => {
    const result = transcript
      .locator('[data-status=complete], [data-status=failed]')
      .nth(index);
    await result.waitFor({ timeout: 90_000 });
    assert.equal(
      await result.getAttribute('data-status'),
      'complete',
      await result.innerText(),
    );
    return result;
  };
  await send(
    'Reply with RESOS_DESKTOP_OK and nothing else. Do not run tools or change files.',
  );
  assert.match(await (await completed(0)).innerText(), /RESOS_DESKTOP_OK/);
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
  if (verifyClaude) {
    await window.getByLabel('Harness', { exact: true }).selectOption('claude');
    const model = window.getByLabel('Model', { exact: true });
    const effort = window.getByLabel('Reasoning effort', { exact: true });
    const mode = window.getByLabel('Mode', { exact: true });
    await model.locator('option').first().waitFor({ state: 'attached' });
    await window.locator('#run-model:enabled').waitFor();
    await effort.selectOption('low');
    const selectedModel = await model.inputValue();
    await send(
      'Read marker.txt with the ResOS read_file tool. Reply with only its exact contents.',
    );
    assert.match(await (await completed(1)).innerText(), new RegExp(marker));

    await mode.selectOption('agent');
    const approve = window.getByRole('button', { name: 'Approve once' });
    const checkApproval = async (kind, detail) => {
      await approve.waitFor({ timeout: 60_000 });
      const requests = await window.evaluate(
        (id) => window.resos.listApprovals(id),
        project.id,
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].kind, kind);
      assert.equal(requests[0].detail, detail);
    };
    await send(
      'Use write_file to create approved.txt with the exact contents RESOS_APPROVED, without a newline. Reply DONE after the approved write.',
    );
    await checkApproval(
      'Claude Code file creation',
      'approved.txt\n\nProposed full contents\n\nRESOS_APPROVED',
    );
    await assert.rejects(access(join(workspace, 'approved.txt')), {
      code: 'ENOENT',
    });
    await approve.click();
    await completed(2);
    assert.equal(
      await readFile(join(workspace, 'approved.txt'), 'utf8'),
      'RESOS_APPROVED',
    );

    await send(
      'Use run_command with exact argv ["/usr/bin/cat", "marker.txt"]. After the user approves, reply with its stdout.',
    );
    await checkApproval(
      'Claude Code command',
      'Read-only project snapshot with private scratch space\n\n' +
        JSON.stringify(['/usr/bin/cat', 'marker.txt'], null, 2),
    );
    await approve.click();
    assert.match(await (await completed(3)).innerText(), new RegExp(marker));

    await send(
      'Use write_file to create pending.txt with the exact contents PENDING, without a newline. Wait for approval.',
    );
    await checkApproval(
      'Claude Code file creation',
      'pending.txt\n\nProposed full contents\n\nPENDING',
    );
    await transcript.getByRole('button', { name: 'Stop response' }).click();
    await transcript
      .getByText('Response interrupted.', { exact: true })
      .waitFor();
    await approve.waitFor({ state: 'hidden' });
    await assert.rejects(access(join(workspace, 'pending.txt')), {
      code: 'ENOENT',
    });
    const [saved] = await window.evaluate(
      (id) => window.resos.listChats(id),
      project.id,
    );
    const ask = saved.turns[1].jobs[0];
    assert.deepEqual(ask.settings, {
      harness: 'claude',
      mode: 'ask',
      model: selectedModel,
      effort: 'low',
    });
    assert.ok(ask.threadId && ask.turnId && ask.effectiveSettings.model);
    assert.equal(saved.turns.at(-1).jobs[0].status, 'interrupted');
    globalThis.console.log(
      'Claude Code read, wrote, and ran an approved command in the same disposable project, then stopped with an approval pending.',
    );
  }
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
