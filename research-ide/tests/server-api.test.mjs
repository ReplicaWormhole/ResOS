import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(check) {
  for (let i = 0; i < 150; i++) { const value = await check(); if (value) return value; await delay(20); }
  throw new Error('Timed out waiting for server test state');
}
test('isolated API: ownership, persistence, editable nodes, revision-pinned branches, jobs and stale selections', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fieldwork-api-'));
  const stateDir = path.join(directory, 'state');
  const mock = path.join(directory, 'mock-codex');
  await writeFile(mock, `#!/usr/bin/env node
const readline = require('node:readline');
let sequence = 0;
const send = data => process.stdout.write(JSON.stringify(data) + '\\n');
readline.createInterface({input: process.stdin}).on('line', line => {
 const request = JSON.parse(line); if (!request.id) return;
 const {id, method, params} = request;
 if (method === 'thread/resume' || method === 'thread/fork') return send({id,error:{message:'Legacy thread reuse forbidden'}});
 const result = method === 'thread/start' ? {thread:{id:'fresh-'+process.pid+'-'+(++sequence)}} : method === 'turn/start' ? {turn:{id:'turn-'+sequence}} : {};
 send({id,result});
 if (method === 'turn/start') {
  const prompt = params.input[0].text;
  const context = JSON.parse(prompt.slice(prompt.indexOf('{')));
  if (context.nodes.find(node => node.nodeId === context.focalNodeId).text === 'CRASH_WORKER') { setTimeout(() => process.exit(1), 10); return; }
 }
 if (method === 'turn/start') setTimeout(() => {
  send({method:'item/agentMessage/delta',params:{threadId:params.threadId,turnId:result.turn.id,delta:'A fresh answer.'}});
  send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:result.turn.id,status:'completed'}}});
 }, 30);
});
`, { mode: 0o700 });
  const args = [serverPath, '--workspace', directory, '--state-dir', stateDir, '--port', '0'];
  const env = { ...process.env, CODEX_BIN: mock };
  let child;
  async function launch() {
    child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    return waitUntil(() => { if (child.exitCode !== null) throw new Error(output); return output.match(/Open (http:\/\/127\.0\.0\.1:\d+)/)?.[1]; });
  }
  async function stop() { if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } }
  try {
    let base = await launch();
    const api = async (route, body, expect = 200) => {
      const response = await fetch(base + route, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
      const data = await response.json(); assert.equal(response.status, expect, JSON.stringify(data)); return data;
    };
    const duplicate = spawn(process.execPath, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let refusal = ''; duplicate.stderr.on('data', data => { refusal += data; });
    assert.notEqual((await once(duplicate, 'exit'))[0], 0);
    assert.match(refusal, /already has a running server/);
    const { chat } = await api('/api/chat/new', {}, 201);
    const request = { chatId: chat.id, text: 'Explain this', requestId: 'one' };
    const first = await api('/api/chat/send', request, 202);
    assert.equal((await api('/api/chat/send', request, 202)).jobId, first.jobId);
    await waitUntil(async () => (await api('/api/job?id=' + first.jobId)).job.status === 'completed');
    let saved = (await api('/api/state')).conversations[0];
    const answer = saved.messages.at(-1);
    assert.equal(saved.messages.filter(node => node.role === 'user').length, 1);
    const selection = { parentId: chat.id, parentMessageId: answer.id, parentRevisionId: answer.revisionId, selectedQuote: 'fresh', selectedStart: 2 };
    const { chat: branch } = await api('/api/chat/branch', selection, 201);
    const edit = { chatId: chat.id, messageId: answer.id, baseRevisionId: answer.revisionId, text: 'Human revised answer.' };
    await api('/api/node/revise', edit);
    await api('/api/node/revise', edit, 400);
    await api('/api/chat/branch', selection, 400);
    await api('/api/node/annotate', { chatId: chat.id, messageId: answer.id, text: 'My own thought' });
    const second = await api('/api/chat/send', { chatId: chat.id, text: 'Use the revised answer and my note', requestId: 'two' }, 202);
    await waitUntil(async () => (await api('/api/job?id=' + second.jobId)).job.status === 'completed');
    const one = (await api('/api/job?id=' + first.jobId)).job;
    const two = (await api('/api/job?id=' + second.jobId)).job;
    assert.notEqual(one.threadId, two.threadId);
    assert.ok(two.prompt.includes('Human revised answer.'));
    assert.ok(two.prompt.includes('My own thought'));
    assert.equal((await api('/api/state')).conversations.find(item => item.id === branch.id).sourceContext.at(-1).text, 'A fresh answer.');
    const crash = await api('/api/chat/send', { chatId: chat.id, text: 'CRASH_WORKER', requestId: 'crash' }, 202);
    await waitUntil(async () => ['interrupted', 'failed'].includes((await api('/api/job?id=' + crash.jobId)).job.status));
    const recovery = await api('/api/chat/send', { chatId: chat.id, text: 'Recover from a replaced runtime', requestId: 'recovery' }, 202);
    await waitUntil(async () => (await api('/api/job?id=' + recovery.jobId)).job.status === 'completed');
    await stop();
    base = await launch();
    saved = (await api('/api/node?chatId=' + chat.id + '&messageId=' + answer.id)).message;
    assert.equal(saved.revisions.length, 2);
    assert.equal(saved.annotations[0].text, 'My own thought');
    const reader = fileURLToPath(new URL('../scripts/read_context.mjs', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [reader, '--state', path.join(stateDir, 'state.json'), '--chat-id', chat.id, '--node-id', answer.id, '--revision-id', saved.revisions[0].id]);
    assert.equal(JSON.parse(stdout).node.text, 'A fresh answer.');
    const searched = await promisify(execFile)(process.execPath, [reader, '--state', path.join(stateDir, 'state.json'), '--chat-id', chat.id, '--query', 'thought']);
    assert.ok(JSON.parse(searched.stdout).matches.some(item => item.id === chat.id));
    assert.equal(JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8')).version, 2);
    assert.ok((await readdir(stateDir)).includes('writer.lock'));
  } finally {
    await stop();
    // Retain the isolated fixture under the OS temporary directory for inspection.
  }
});
