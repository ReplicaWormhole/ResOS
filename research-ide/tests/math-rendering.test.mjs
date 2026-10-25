import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeMarkdown, safePlainMath, markdownText, displayChatTitle } from '../public/markdown.js';
import { splitMessage } from '../public/math-source.js';
import { branchChat, finalizeRevision } from '../notebook-state.mjs';

const formulas = [String.raw`\(x^2+\alpha\)`, String.raw`\[\Omega=f(z)\,dz^1\wedge\cdots\wedge dz^n.\]`,
  '$x_i^2$', '$$\\sum_{i=1}^n i$$', String.raw`\begin{align}a&=b\\c&=d\end{align}`];
test('questions and responses render all supported inline/display delimiter styles', () => {
  for (const source of formulas) for (const render of [safeMarkdown, safePlainMath]) {
    const html = render(source);
    assert.match(html, /class="katex"/);
    assert.match(html, /data-math-source=/);
    assert.doesNotMatch(html, /katex-error/);
  }
});
test('math is protected from Markdown and source coordinates preserve original TeX', () => {
  const text = String.raw`Before **bold** \(x^{*}+y^{*}\) after.`;
  assert.equal(markdownText(text), String.raw`Before bold \(x^{*}+y^{*}\) after.`);
  assert.doesNotMatch(safeMarkdown(text), /katex-error/);
  const answer = { id: 'answer', role: 'assistant', text, status: 'complete' };
  finalizeRevision(answer);
  const quote = String.raw`\(x^{*}+y^{*}\)`;
  assert.equal(branchChat({ id: 'chat', messages: [answer] }, { parentMessageId: 'answer', parentRevisionId: answer.revisionId,
    selectedQuote: quote, selectedStart: markdownText(text).indexOf(quote) }).selectedQuote, quote);
});
test('code, escaped dollars and ordinary currency stay literal', () => {
  const code = '`$x$`\n```tex\n\\[x^2\\]\n```';
  assert.doesNotMatch(safeMarkdown(code), /class="katex"/);
  assert.doesNotMatch(safePlainMath(code), /class="katex"/);
  assert.equal(splitMessage(String.raw`Pay \$5 and $10 or $20.`).filter(part => part.type === 'math').length, 0);
  assert.equal(splitMessage('Price $5 and $10.').filter(part => part.type === 'math').length, 0);
});
test('malformed and streaming-incomplete TeX never crashes the message renderer', () => {
  for (const render of [safeMarkdown, safePlainMath]) {
    assert.doesNotThrow(() => render(String.raw`\[\frac{\]`));
    assert.match(render(String.raw`\[\frac{\]`), /katex-error|math-error/);
    assert.equal(render(String.raw`still writing \[x^2`), String.raw`still writing \[x^2`);
    assert.match(render(String.raw`now complete \[x^2\]`), /class="katex"/);
    assert.doesNotThrow(() => render(String.raw`\(\def\x{\x}\x\)`));
  }
});
test('untrusted math cannot load images, inject HTML or create executable links', () => {
  const html = safeMarkdown(String.raw`\(\includegraphics{https://example.com/track}\) \(\href{javascript:alert(1)}{x}\) <img src=x onerror=alert(1)>`);
  assert.doesNotMatch(html, /<img|href="javascript:|<script/);
  assert.ok(html.includes('&lt;img'));
  assert.doesNotMatch(safeMarkdown(String.raw`[x](https://example.com/\(x\))`), /href="[^\"]*<span/);
});
test('macros cannot leak from one expression/message into another', () => {
  safeMarkdown(String.raw`\(\gdef\privateMacro{42}\privateMacro\)`);
  assert.match(safeMarkdown(String.raw`\(\privateMacro\)`), /<mtext>\\privateMacro<\/mtext>/);
});

test('automatic equation titles stay readable without a truncated TeX fragment', () => {
  assert.equal(displayChatTitle({ title: 'About: truncated source', selectedQuote: String.raw`\[x^2\]` }), 'About this equation');
  assert.equal(displayChatTitle({ title: 'My own title', selectedQuote: String.raw`\[x^2\]` }), 'My own title');
});
