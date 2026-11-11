#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const threadId = 'fixture-thread';
const turnId = 'fixture-turn';
let action;
let stage = 0;
let lookupEnabled = false;
let requestedModel;
let requestedEffort;
let scoped = false;
let ask = false;
const flags = process.argv.slice(2);
const fixtureModel = (
  model,
  displayName,
  efforts,
  defaultReasoningEffort,
  isDefault,
) => ({
  model,
  displayName,
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
    reasoningEffort,
  })),
  defaultReasoningEffort,
  isDefault,
  inputModalities: ['text'],
});
function completed(status) {
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: turnId, status } },
  });
}
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params, result } = JSON.parse(line);
  switch (method) {
    case 'initialize':
      assert.equal(stage++, 0);
      lookupEnabled = params.capabilities?.experimentalApi === true;
      send({ id, result: {} });
      break;
    case 'initialized':
      assert.equal(stage++, 1);
      break;
    case 'model/list':
      assert.equal(params.includeHidden, false);
      send({
        id,
        result:
          params.cursor === 'next'
            ? {
                data: [
                  fixtureModel(
                    'fixture-b',
                    'Fixture B',
                    ['high'],
                    'high',
                    false,
                  ),
                ],
                nextCursor: null,
              }
            : {
                data: [
                  fixtureModel(
                    'fixture-a',
                    'Fixture A',
                    ['low', 'medium'],
                    'medium',
                    true,
                  ),
                  {
                    ...fixtureModel('hidden', 'Hidden model', [], null, false),
                    hidden: true,
                  },
                  {
                    ...fixtureModel(
                      'image-only',
                      'Image model',
                      [],
                      null,
                      false,
                    ),
                    inputModalities: ['image'],
                  },
                ],
                nextCursor: 'next',
              },
      });
      break;
    case 'config/read': {
      const features = Object.fromEntries(
        flags
          .filter((arg) => /^features\.[a-z_]+=false$/.test(arg))
          .map((arg) => [arg.slice(9, -6), false]),
      );
      assert.equal(params.cwd, process.cwd());
      scoped = true;
      send({
        id,
        result: {
          config: {
            features,
            web_search: flags.includes('web_search="disabled"')
              ? 'disabled'
              : 'live',
            mcp_servers: {
              fixture: {
                enabled: !flags.includes('mcp_servers.fixture.enabled=false'),
              },
            },
          },
        },
      });
      break;
    }
    case 'thread/start':
      assert.equal(stage++, 2);
      assert.equal(params.ephemeral, true);
      ask = params.sandbox === 'read-only';
      assert.equal(params.sandbox, ask ? 'read-only' : 'workspace-write');
      assert.equal(params.approvalPolicy, ask ? 'never' : 'on-request');
      requestedModel = params.model;
      requestedEffort = params.config?.model_reasoning_effort;
      if (scoped)
        assert.ok(flags.includes('mcp_servers.fixture.enabled=false'));
      assert.equal(params.approvalsReviewer, 'user');
      assert.equal(params.cwd, process.cwd());
      if (lookupEnabled) {
        assert.equal(params.dynamicTools[0].name, 'resos_search_notebook');
        assert.equal(params.dynamicTools[0].type, 'function');
      } else assert.equal(params.dynamicTools, undefined);
      send({
        id,
        result: {
          thread: { id: threadId },
          ...(scoped
            ? {
                model: requestedModel ?? 'fixture-a',
                reasoningEffort: requestedEffort ?? 'medium',
                cwd: process.cwd(),
                approvalPolicy: params.approvalPolicy,
                sandbox: { type: ask ? 'readOnly' : 'workspaceWrite' },
              }
            : {}),
        },
      });
      break;
    case 'turn/start': {
      assert.equal(stage++, 3);
      if (ask)
        assert.deepEqual(params.sandboxPolicy, {
          type: 'readOnly',
          networkAccess: false,
        });
      else
        assert.deepEqual(params.sandboxPolicy.writableRoots, [process.cwd()]);
      assert.equal(params.sandboxPolicy.networkAccess, false);
      assert.equal(params.approvalPolicy, ask ? 'never' : 'on-request');
      assert.equal(params.model, requestedModel);
      assert.equal(params.effort, requestedEffort);
      action = params.input[0].text;
      const messages = [{ id, result: { turn: { id: turnId } } }];
      messages.push({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'wrong',
          turnId,
          itemId: 'foreign',
          delta: 'foreign',
        },
      });
      messages.push({
        method: 'item/agentMessage/delta',
        params: { threadId, turnId, itemId: 'message', delta: 'partial ' },
      });
      if (action === 'saved lookup payload') {
        assert.equal(lookupEnabled, true);
        for (const [id, scope] of [
          ['foreign-lookup', { threadId: 'foreign', turnId }],
          ['other-turn-lookup', { threadId, turnId: 'other' }],
          ['lookup', { threadId, turnId }],
        ])
          messages.push({
            id,
            method: 'item/tool/call',
            params: {
              ...scope,
              tool: 'resos_search_notebook',
              namespace: null,
              arguments: { query: 'fixture' },
            },
          });
      }
      // Pipe reads may combine a reply and its immediate tool requests.
      process.stdout.write(
        messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
      );
      if (action === 'configured ask' || action === 'configured agent') {
        assert.equal(ask, action === 'configured ask');
        assert.equal(scoped, true);
        assert.equal(requestedModel, 'fixture-b');
        assert.equal(requestedEffort, 'high');
        send({
          id: 'scoped-approval',
          method: 'item/commandExecution/requestApproval',
          params: {
            threadId,
            turnId,
            command: 'write fixture',
            cwd: process.cwd(),
          },
        });
      }
      if (action.includes('review')) {
        const [notice, data, label, question] = action.split('\n\n');
        assert.match(notice, /reference data/);
        assert.equal(label, 'Current user message:');
        assert.equal(question, 'review');
        assert.equal(JSON.parse(data).excerpts[0].text, 'captured TeX');
        assert.equal(JSON.parse(data).excerpts[0].unsaved, true);
        assert.deepEqual(JSON.parse(data).fileSource, { path: 'notes.tex' });
        assert.equal(JSON.parse(data).passages[0].quote, 'Pinned text');
        send({
          method: 'item/started',
          params: {
            threadId,
            turnId,
            item: {
              id: 'edit',
              type: 'fileChange',
              changes: [{ path: 'notes.txt', diff: '+fixture' }],
            },
          },
        });
        send({
          id: 'approval',
          method: 'item/fileChange/requestApproval',
          params: { threadId, turnId, itemId: 'edit' },
        });
      }
      break;
    }
    case 'turn/interrupt':
      assert.deepEqual(params, { threadId, turnId });
      send({ id, result: {} });
      completed('interrupted');
      break;
    default:
      if (id === 'foreign-lookup' || id === 'other-turn-lookup') {
        assert.equal(result.success, false);
        break;
      }
      if (id === 'lookup') {
        assert.equal(result.success, true);
        assert.equal(
          JSON.parse(result.contentItems[0].text)[0].excerpt,
          'fixture result',
        );
        completed('completed');
        break;
      }
      if (id === 'scoped-approval') {
        assert.equal(result.decision, ask ? 'decline' : 'accept');
        send({
          method: 'item/agentMessage/delta',
          params: {
            threadId,
            turnId,
            itemId: 'message',
            delta: ask ? 'read-only' : 'agent approved',
          },
        });
        completed('completed');
        break;
      }
      assert.equal(id, 'approval');
      assert.equal(result.decision, 'accept');
      send({
        method: 'item/agentMessage/delta',
        params: { threadId, turnId, itemId: 'message', delta: 'approved' },
      });
      completed('completed');
  }
}
