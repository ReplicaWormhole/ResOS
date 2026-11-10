#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const threadId = 'fixture-thread';
const turnId = 'fixture-turn';
let action;
let stage = 0;
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
      send({ id, result: {} });
      break;
    case 'initialized':
      assert.equal(stage++, 1);
      break;
    case 'thread/start':
      assert.equal(stage++, 2);
      assert.equal(params.ephemeral, true);
      assert.equal(params.sandbox, 'workspace-write');
      assert.equal(params.approvalsReviewer, 'user');
      assert.equal(params.cwd, process.cwd());
      send({ id, result: { thread: { id: threadId } } });
      break;
    case 'turn/start':
      assert.equal(stage++, 3);
      assert.deepEqual(params.sandboxPolicy.writableRoots, [process.cwd()]);
      assert.equal(params.sandboxPolicy.networkAccess, false);
      assert.equal(params.approvalPolicy, 'on-request');
      action = params.input[0].text;
      send({ id, result: { turn: { id: turnId } } });
      send({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'wrong',
          turnId,
          itemId: 'foreign',
          delta: 'foreign',
        },
      });
      send({
        method: 'item/agentMessage/delta',
        params: { threadId, turnId, itemId: 'message', delta: 'partial ' },
      });
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
    case 'turn/interrupt':
      assert.deepEqual(params, { threadId, turnId });
      send({ id, result: {} });
      completed('interrupted');
      break;
    default:
      assert.equal(id, 'approval');
      assert.equal(result.decision, 'accept');
      send({
        method: 'item/agentMessage/delta',
        params: { threadId, turnId, itemId: 'message', delta: 'approved' },
      });
      completed('completed');
  }
}
