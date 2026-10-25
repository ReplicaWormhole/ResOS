import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Minimal DOM harness: exercise the actual rendering helpers without browser dependencies.
class DOMNode {
  constructor(name, data = '') { this.nodeName = name; this.nodeType = name === '#text' ? 3 : 1; this.data = data; this.children = []; this.attrs = {}; }
  get length() { return this.data.length; }
  append(...nodes) { for (const node of nodes) { if (node.nodeName === '#fragment') this.append(...node.children); else { this.children.push(node); node.parent = this; } } }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener() {}
  replaceWith(fragment) { const i = this.parent.children.indexOf(this); this.parent.children.splice(i, 1, ...fragment.children); for (const child of fragment.children) child.parent = this.parent; }
}
const element = (name, ...children) => { const node = new DOMNode(name); node.append(...children.map(child => typeof child === 'string' ? new DOMNode('#text', child) : child)); return node; };
const document = {
  createTreeWalker(root) { const nodes = []; const walk = node => { for (const child of node.children) { nodes.push(child); walk(child); } }; walk(root); let i = -1; return { nextNode() { this.currentNode = nodes[++i]; return this.currentNode; } }; },
  createElement: name => element(name), createTextNode: text => new DOMNode('#text', text), createDocumentFragment: () => element('#fragment'),
};
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const context = vm.createContext({ document, Node: { TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1 } });
vm.runInContext(source.slice(source.indexOf('function passageText('), source.indexOf('let popupChatIds')) + source.slice(source.indexOf('function markLinkedPassages('), source.indexOf('function showToast(')), context);
const range = (text, chat) => JSON.parse(JSON.stringify(context.passageRange(text, chat, { id: 'answer' })));
const branch = (id, quote, start) => ({ id, selectedQuote: quote, selectedStart: start, parentMessageId: 'answer' });
const marks = node => node.children.flatMap(child => [...(child.nodeName === 'mark' ? [child] : []), ...marks(child)]);

test('exact offset distinguishes repeated phrases', () => {
  assert.deepEqual(range('current work, current work', branch('a', 'current work', 14)), [14, 26]);
});
test('legacy quote and normalized line breaks resolve; missing text stays unmatched', () => {
  assert.deepEqual(range('alpha\n\n beta', { selectedQuote: 'alpha beta' }), [0, 12]);
  assert.deepEqual(range('current workspace', { selectedQuote: 'urrent wo' }), [1, 10]);
  assert.equal(range('changed answer', { selectedQuote: 'missing' }), null);
});
test('formatted passages preserve text and markup with overlapping follow-ups', () => {
  const body = element('div', 'alpha ', element('strong', 'beta'), element('BR'), 'gamma');
  const before = context.passageText(body);
  assert.equal(before, 'alpha beta\ngamma');
  const unmatched = context.markLinkedPassages(body, { id: 'answer' }, [branch('a', 'ha beta\nga', 3), branch('b', 'beta', 6)]);
  assert.equal(unmatched.length, 0);
  assert.equal(context.passageText(body), before);
  assert.equal(body.children.find(child => child.nodeName === 'strong')?.children[0].nodeName, 'mark');
  assert.equal(marks(body).length, 3);
  assert.match(marks(body)[1].title, /2 linked chats/);
  assert.equal(marks(body)[0].attrs['aria-haspopup'], 'dialog');
});
test('only the second repeated selection is marked', () => {
  const body = element('div', 'same same');
  context.markLinkedPassages(body, { id: 'answer' }, [branch('a', 'same', 5)]);
  assert.equal(marks(body).length, 1);
  assert.equal(body.children[0].data, 'same ');
});
test('unmatched legacy raw Markdown remains available as a follow-up link', () => {
  const child = branch('a', '**bold**');
  const body = element('div', element('strong', 'bold'));
  assert.equal(context.markLinkedPassages(body, { id: 'answer' }, [child])[0], child);
});

test('changed file does not mark an ambiguous repeated quote at the wrong location', () => {
  assert.equal(range('same same', { ...branch('a', 'same', 3), sourceFile: { path: 'test.txt' } }), null);
  assert.deepEqual(range('prefix same', { ...branch('a', 'same', 0), sourceFile: { path: 'test.txt' } }), [7, 11]);
});
