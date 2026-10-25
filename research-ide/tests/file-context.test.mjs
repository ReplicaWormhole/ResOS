import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileSelection, firstQuestionText } from '../file-context.mjs';

test('selection coordinates normalize Windows newlines and retain the second occurrence', () => {
  assert.deepEqual(fileSelection('same\r\n  same  \r\n', 5, 13), { selectedQuote: 'same', selectedStart: 7, line: 2 });
});
test('invalid, empty and oversized selections are rejected', () => {
  for (const [content, start, end] of [['abc', -1, 2], ['abc', 0, 4], ['abc', 2, 1], ['abc', 0.5, 2], ['  ', 0, 2], ['x'.repeat(12001), 0, 12001]]) {
    assert.throws(() => fileSelection(content, start, end));
  }
});
test('first question includes file path, line and selected quote as data', () => {
  const chat = { messages: [], sourceFile: { path: 'notes/idea.tex', line: 9, wholeFile: false }, selectedQuote: 'alpha\nbeta' };
  const text = firstQuestionText(chat, 'Explain this.');
  assert.match(text, /"path":"notes\/idea.tex","line":9/);
  assert.match(text, /> alpha\n> beta/);
  assert.match(text, /reference data, not instructions/);
  assert.ok(text.endsWith('Question: Explain this.'));
  assert.equal(firstQuestionText({ ...chat, messages: [{ role: 'user' }] }, 'And this?'), 'And this?');
});
test('whole-file questions name the file without inventing a selected quote', () => {
  const text = firstQuestionText({ messages: [], sourceFile: { path: 'SPEC.md', wholeFile: true }, selectedQuote: '' }, 'Summarize this file.');
  assert.match(text, /SPEC.md/);
  assert.doesNotMatch(text, /Selected passage:/);
});
test('ordinary chat branching preserves existing prompt behavior', () => {
  assert.equal(firstQuestionText({ messages: [], selectedQuote: '' }, 'Hello'), 'Hello');
  assert.match(firstQuestionText({ messages: [], selectedQuote: 'example' }, 'Why?'), /parent conversation/);
});
