#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

if (process.argv.includes('--version')) {
  process.stdout.write('2.1.322 (Claude Code fixture)\n');
  process.exit(0);
}

const models = [
  {
    value: 'default',
    resolvedModel: 'fixture-claude-a',
    displayName: 'Fixture Claude A',
    description: 'Default test model',
    supportedEffortLevels: ['low', 'high'],
  },
  {
    value: 'haiku',
    resolvedModel: 'fixture-claude-b',
    displayName: 'Fixture Claude B',
    description: 'Alternate test model',
    supportedEffortLevels: ['low'],
  },
];
const session = randomUUID();
const pending = new Map();
let manifest = [];

function write(frame) {
  process.stdout.write(JSON.stringify(frame) + '\n');
}

function request(payload) {
  const id = randomUUID();
  const reply = Promise.withResolvers();
  pending.set(id, reply.resolve);
  write({ type: 'control_request', request_id: id, request: payload });
  return reply.promise;
}

async function invoke(name, input) {
  const permission = await request({
    subtype: 'can_use_tool',
    tool_name: 'mcp__resos__' + name,
    input,
    permission_suggestions: [],
    tool_use_id: randomUUID(),
  });
  if (permission.behavior === 'deny') return 'tool denied';
  assert.equal(permission.behavior, 'allow');
  const reply = await request({
    subtype: 'mcp_message',
    server_name: 'resos',
    message: {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: permission.updatedInput ?? input },
    },
  });
  assert.ok(reply.mcp_response?.result, JSON.stringify(reply));
  return reply.mcp_response.result.content[0].text;
}

function arg(name) {
  const prefix = '--' + name + '=';
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function stream(event) {
  write({
    type: 'stream_event',
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: session,
    event,
  });
}

async function answer(frame) {
  assert.equal(frame.client_composed, true);
  assert.equal(typeof frame.message.content, 'string');
  const input = frame.message.content
    .split('\n\nCurrent user message:\n\n')
    .at(-1);
  const model = arg('model') ?? models[0].resolvedModel;
  write({
    type: 'system',
    subtype: 'init',
    session_id: session,
    tools: manifest,
    mcp_servers: [{ name: 'resos', status: 'connected', source: 'sdk' }],
    plugins: [],
    model,
    effort: arg('effort'),
  });
  stream({ type: 'message_start' });
  stream({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'Claude partial ' },
  });
  await delay(180);
  let suffix = 'complete';
  if (input.includes('fixture Claude read')) {
    const read = JSON.parse(await invoke('read_file', { path: 'marker.txt' }));
    suffix = read.text;
  }
  if (input.includes('fixture Claude write')) {
    const path = input.includes('pending') ? 'pending.txt' : 'created.txt';
    suffix = await invoke('write_file', { path, text: 'fixture wrote' });
    if (suffix.includes('"status":"saved"')) suffix = 'write approved';
  }
  if (input.includes('fixture Claude outside')) {
    suffix = await invoke('write_file', {
      path: '../outside.txt',
      text: 'forbidden',
    });
  }
  if (input.includes('fixture Claude command')) {
    const reply = await invoke('run_command', {
      argv: ['/usr/bin/cat', 'marker.txt'],
    });
    suffix = reply.startsWith('{') ? JSON.parse(reply).stdout.trim() : reply;
  }
  stream({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: suffix },
  });
  write({
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      model,
      content: [{ type: 'text', text: 'Claude partial ' + suffix }],
    },
    uuid: randomUUID(),
    session_id: session,
  });
  write({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Claude partial ' + suffix,
    num_turns: 1,
    uuid: randomUUID(),
    session_id: session,
  });
}

for await (const line of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') {
    if (frame.request.subtype === 'initialize') {
      assert.equal(arg('tools'), '');
      assert.equal(arg('setting-sources'), '');
      assert.ok(process.argv.includes('--strict-mcp-config'));
      assert.ok(process.argv.includes('--no-session-persistence'));
      manifest = (frame.request.sdkMcpServerManifests?.resos?.tools ?? []).map(
        ({ name }) => 'mcp__resos__' + name,
      );
    }
    write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: frame.request_id,
        response: { models, commands: [], agents: [], account: {} },
      },
    });
  } else if (frame.type === 'control_response') {
    const id = frame.response.request_id;
    pending.get(id)?.(frame.response.response);
    pending.delete(id);
  } else if (frame.type === 'user') {
    void answer(frame).catch((error) => {
      process.stderr.write(error.message + '\n');
      process.exitCode = 1;
      process.stdin.destroy();
    });
  }
}
