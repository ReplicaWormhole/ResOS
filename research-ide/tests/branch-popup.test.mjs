import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBranchPopup } from '../public/branch-popup.js';

// Small event/DOM harness exercises popup state without a runtime dependency.
class Element {
  constructor() { this.dataset = {}; this.style = {}; this.value = ''; this.children = []; this.handlers = {}; this.open = false; this.scrollHeight = 300; this.scrollTop = 0; this.clientHeight = 200; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this[name] = value; }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; this.handlers.close?.(); } }
}

test('popup sends to its own chat, keeps per-chat drafts and handles errors, stop and expansion', async () => {
  const previous = new Map(['document', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const nodes = new Map();
  const query = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const drafts = new Map();
  globalThis.document = { querySelector: query, createElement: () => new Element() };
  globalThis.sessionStorage = { getItem: key => drafts.get(key), setItem: (key, value) => drafts.set(key, value) };
  try {
    const chats = [{ id: 'a', title: 'First', messages: [] }, { id: 'b', title: 'Second', messages: [] }];
    const calls = [];
    let fail = false, approval = '';
    const popup = createBranchPopup({
      getConversations: () => chats, onOpen() {},
      onSelect: id => calls.push(['expand', id]),
      onSend: async (id, text) => { calls.push(['send', id, text]); if (fail) { drafts.set('draft:' + id, text); return false; } return true; },
      onStop: id => calls.push(['stop', id]),
      getApproval: () => approval,
      onApproval: decision => calls.push(['approval', decision]),
    });
    const composer = query('#popupComposer');
    const input = value => { composer.value = value; composer.handlers.input(); };
    const submit = () => query('#popupComposerForm').handlers.submit({ preventDefault() {} });
    popup.open(['a', 'b']);
    input('first draft');
    query('#branchPopupChoices').children[1].onclick();
    assert.equal(composer.value, '');
    input('second draft');
    query('#branchPopupChoices').children[0].onclick();
    assert.equal(composer.value, 'first draft');
    await submit();
    assert.deepEqual(calls[0], ['send', 'a', 'first draft']);
    assert.equal(drafts.get('draft:a'), '');
    assert.equal(drafts.get('draft:b'), 'second draft');
    fail = true;
    input('retry this');
    await submit();
    assert.equal(composer.value, 'retry this', 'restore failed text even if the shared sender already restored storage');
    assert.equal(query('#popupError').hidden, false);
    chats[0].busy = true;
    popup.render();
    assert.equal(query('#popupSend').disabled, true);
    assert.equal(query('#popupStop').hidden, false);
    input('next question');
    await submit();
    assert.equal(calls.filter(call => call[0] === 'send').length, 2, 'busy chats cannot submit another turn');
    query('#popupStop').handlers.click();
    assert.deepEqual(calls.at(-1), ['stop', 'a']);
    approval = 'Read a file?';
    popup.render();
    assert.equal(query('#popupApprovalBar').hidden, false);
    query('#popupAllowApproval').handlers.click();
    assert.deepEqual(calls.at(-1), ['approval', 'allow']);
    query('#openBranchChat').handlers.click();
    assert.deepEqual(calls.at(-1), ['expand', 'a']);
    assert.equal(drafts.get('draft:a'), 'next question');
    popup.close();
    drafts.set('draft:a', 'draft from expanded view');
    popup.open(['a']);
    assert.equal(composer.value, 'draft from expanded view');
    assert.equal(drafts.get('draft:b'), 'second draft');
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
