import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateNotebook, reviseNode, branchChat, finalizeRevision, jobContext } from '../notebook-state.mjs';
import { JobRunner } from '../job-runner.mjs';
import { markdownText } from '../public/markdown.js';
const oldState = () => ({ version: 1, conversations: [
  { id: 'root', workspace: '/test', codexThreadId: 'locked-legacy', title: 'Main', messages: [
    { id: 'q', role: 'user', text: 'Original question' },
    { id: 'a', role: 'assistant', text: 'alpha **beta**\ngamma', turnId: 'old-turn', status: 'complete' }] },
  { id: 'child', workspace: '/test', parentId: 'root', parentMessageId: 'a', parentTurnId: 'old-turn', selectedQuote: 'beta', messages: [] }
] });
const setup = () => {
  const state = migrateNotebook(oldState(), '/test');
  const calls = [], events = [];
  const agent = { ready: true, async start() {}, async reset() { calls.push(['reset']); }, async rpc(method, params) {
    calls.push([method, params]);
    if (method === 'thread/start') return { thread: { id: 'fresh-' + calls.filter(call => call[0] === 'thread/start').length } };
    if (method === 'turn/start') return { turn: { id: 'turn-' + calls.filter(call => call[0] === 'turn/start').length } };
    return {};
  } };
  const runner = new JobRunner({ state, workspace: '/test', agent, persist: async () => {}, publish: event => events.push(event), instructions: () => 'test' });
  return { state, agent, calls, events, runner };
};
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('migration preserves nodes, pins legacy branch context, and never reuses legacy sessions', () => {
  const original = oldState(), state = migrateNotebook(original, '/test');
  assert.equal(state.version, 2);
  assert.equal(state.conversations[0].legacyThreadId, 'locked-legacy');
  assert.equal(state.conversations[0].codexThreadId, undefined);
  assert.equal(original.version, 1);
  const root = state.conversations[0], child = state.conversations[1], answer = root.messages[1];
  const before = child.sourceContext.at(-1).text;
  reviseNode(root, answer.id, answer.revisionId, 'new answer');
  assert.equal(child.sourceContext.at(-1).text, before);
  assert.equal(answer.revisions.length, 2);
  assert.equal(answer.revisions[0].author, 'agent');
  assert.equal(answer.revisions[1].author, 'user');
  assert.throws(() => reviseNode(root, answer.id, 'old revision', 'overwrite'), /changed/);
});
test('branches validate rendered passage offsets and pin the source revision', () => {
  const { state } = setup();
  const root = state.conversations[0], answer = root.messages[1];
  const body = { parentMessageId: 'a', parentRevisionId: answer.revisionId, selectedQuote: 'beta', selectedStart: 6 };
  const branch = branchChat(root, body, 'nested');
  assert.equal(branch.parentRevisionId, answer.revisionId);
  assert.equal(branch.sourceContext.at(-1).nodeId, 'a');
  assert.throws(() => branchChat(root, { ...body, selectedStart: 0 }), /changed/);
  assert.throws(() => branchChat(root, { ...body, parentRevisionId: 'stale' }), /edited/);
  assert.equal(markdownText('**A**\n`<x>` & [link](https://example.com)'), 'A\n<x> & link');
});
test('response jobs use fresh threads, explicit snapshots, idempotent requests and one workspace writer', async () => {
  const { runner, state, calls } = setup();
  const root = state.conversations[0], child = state.conversations[1];
  const one = await runner.enqueue(root, { text: 'Why?', requestId: 'one' });
  const duplicate = await runner.enqueue(root, { text: 'Why?', requestId: 'one' });
  assert.equal(one.id, duplicate.id);
  const two = await runner.enqueue(child, { text: 'Explain beta', requestId: 'two' });
  await settle();
  assert.equal(calls.filter(call => call[0] === 'thread/start').length, 1);
  assert.equal(two.status, 'queued');
  assert.ok(one.prompt.includes('Original question'));
  assert.equal(one.context.focalNodeId, one.inputNodeId);
  const frozen = one.prompt;
  reviseNode(root, 'a', root.messages[1].revisionId, 'Edited while the job runs');
  assert.equal(one.prompt, frozen);
  await runner.notification('item/agentMessage/delta', { threadId: one.threadId, turnId: one.turnId, delta: 'Answer' });
  await runner.notification('turn/completed', { threadId: one.threadId, turn: { id: one.turnId, status: 'completed' } });
  await settle();
  assert.equal(two.status, 'running');
  assert.notEqual(one.threadId, two.threadId);
  assert.ok(!calls.some(call => ['thread/resume', 'thread/fork'].includes(call[0])));
  const output = root.messages.find(node => node.id === one.outputNodeId);
  assert.equal(output.text, 'Answer');
  assert.ok(output.revisionId);
  await runner.notification('item/agentMessage/delta', { threadId: one.threadId, delta: 'STALE' });
  assert.equal(output.text, 'Answer');
  await runner.notification('turn/completed', { threadId: two.threadId, turn: { status: 'completed' } });
  await settle();
  assert.equal(runner.active, null);
});
test('restart interrupts work without replay, and retry creates a new job without duplicating the question', async () => {
  const { runner, state } = setup();
  const root = state.conversations[0];
  const job = await runner.enqueue(root, { text: 'Question', requestId: 'one' });
  await settle();
  const recovered = migrateNotebook(state, '/test');
  assert.equal(recovered.jobs.at(-1).status, 'interrupted');
  assert.equal(recovered.conversations[0].busy, false);
  const newRunner = new JobRunner({ state: recovered, workspace: '/test', agent: runner.agent, persist: async () => {}, publish() {}, instructions: () => '' });
  const questions = recovered.conversations[0].messages.filter(node => node.role === 'user').length;
  const retry = await newRunner.enqueue(recovered.conversations[0], { retryJobId: job.id, requestId: 'retry' });
  await settle();
  assert.equal(retry.inputNodeId, job.inputNodeId);
  assert.equal(recovered.conversations[0].messages.filter(node => node.role === 'user').length, questions);
});
test('failed jobs reset only their runtime and allow explicit fresh attempts', async () => {
  const { runner, state, agent, calls } = setup();
  const root = state.conversations[0];
  agent.rpc = async method => { calls.push([method]); throw new Error('simulated startup failure'); };
  const job = await runner.enqueue(root, { text: 'Question', requestId: 'one' });
  await settle();
  assert.equal(job.status, 'failed');
  assert.equal(root.busy, false);
  assert.ok(calls.some(call => call[0] === 'reset'));
  assert.equal(root.messages.at(-1).status, 'error');
  assert.ok(root.messages.at(-1).revisionId);
});

test('context limits older material with explicit retrieval references and preserves human authorship', () => {
  const { state } = setup();
  const root = state.conversations[0], answer = root.messages[1];
  reviseNode(root, answer.id, answer.revisionId, 'x'.repeat(100000));
  const question = { id: 'focus', role: 'user', text: 'Current question', parentNodeId: 'a' };
  finalizeRevision(question, 'user'); root.messages.push(question);
  const packet = jobContext(root, question);
  assert.ok(packet.omitted.some(node => node.nodeId === answer.id));
  assert.equal(packet.nodes.at(-1).text, 'Current question');
  reviseNode(root, answer.id, answer.revisionId, 'Human revision');
  assert.equal(jobContext(root, question).nodes.find(node => node.nodeId === answer.id).author, 'user');
});
test('cancelling a queued job preserves the active workspace job', async () => {
  const { runner, state } = setup();
  const root = state.conversations[0], child = state.conversations[1];
  const active = await runner.enqueue(root, { text: 'First', requestId: 'first' });
  await settle();
  const queued = await runner.enqueue(child, { text: 'Second', requestId: 'second' });
  await runner.stop(child);
  assert.equal(queued.status, 'stopped');
  assert.equal(runner.active, active);
  assert.equal(root.busy, true);
  assert.equal(child.busy, false);
});

test('message-level parent edges exclude a superseded sibling answer from context', () => {
  const { state } = setup();
  const root = state.conversations[0];
  const alternative = { id: 'alternative', parentNodeId: 'q', role: 'assistant', text: 'Alternative reply' };
  finalizeRevision(alternative); root.messages.push(alternative);
  const question = { id: 'focus', parentNodeId: 'alternative', role: 'user', text: 'Follow this reply' };
  finalizeRevision(question, 'user'); root.messages.push(question);
  const packet = jobContext(root, question);
  assert.deepEqual(packet.nodes.map(node => node.nodeId), ['q', 'alternative', 'focus']);
});
