import katex from './vendor/katex/katex.mjs';
import { splitMessage } from './math-source.js';

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
const mathCache = new Map();
function mathMarkup(part) {
  if (mathCache.has(part.raw)) return mathCache.get(part.raw);
  let rendered;
  try {
    rendered = katex.renderToString(part.tex, { displayMode: part.display, throwOnError: false,
      trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml' });
  } catch {
    rendered = '<span class="math-error">' + escapeHtml(part.raw) + '</span>';
  }
  const html = '<span class="math-expression' + (part.display ? ' math-display' : '') + '" data-math-source="' + escapeHtml(part.raw) + '">' + rendered + '</span>';
  if (mathCache.size >= 256) mathCache.delete(mathCache.keys().next().value);
  mathCache.set(part.raw, html);
  return html;
}
function renderText(value, markdown, math) {
  const protectedParts = [];
  let text = splitMessage(value).map(part => {
    if (part.type === 'text') return escapeHtml(part.raw.replaceAll('\u0000', '\ufffd'));
    let html;
    if (part.type === 'math') html = math ? mathMarkup(part) : escapeHtml(part.raw);
    else if (markdown) {
      html = part.block ? '<pre><code>' + escapeHtml(part.raw.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trimEnd()) + '</code></pre>'
        : '<code>' + escapeHtml(part.raw.slice(1, -1)) + '</code>';
    } else html = (part.block ? '<pre><code>' : '<code>') + escapeHtml(part.raw) + (part.block ? '</code></pre>' : '</code>');
    const token = '\u0000PART' + protectedParts.length + '\u0000';
    protectedParts.push(html); return token;
  }).join('');
  if (markdown) {
    // Protected markup must never be substituted into an href attribute.
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)\u0000]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    text = text.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, title) => '<h' + Math.min(hashes.length + 2, 5) + '>' + title + '</h' + Math.min(hashes.length + 2, 5) + '>');
  }
  return text.replace(/\n/g, '<br>').replace(/\u0000PART(\d+)\u0000/g, (_, index) => protectedParts[Number(index)] || '');
}
export function safeMarkdown(value) { return renderText(value, true, true); }
export function safePlainMath(value) { return renderText(value, false, true); }
// Source coordinates remain TeX, independent of the visual/MathML glyph tree.
export function markdownText(value) {
  return renderText(value, true, false).replace(/<br>/g, '\n').replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'").replaceAll('&amp;', '&');
}
