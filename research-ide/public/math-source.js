// Delimiters are recognized before Markdown, so TeX stars/underscores stay literal.
const delimiters = [
  ['$$', '$$', true], ['\\[', '\\]', true], ['\\(', '\\)', false], ['$', '$', false],
  ...['equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*'].map(name =>
    ['\\begin{' + name + '}', '\\end{' + name + '}', true]),
];
function escaped(text, at) {
  let backslashes = 0;
  while (at > 0 && text[--at] === '\\') backslashes++;
  return backslashes % 2 === 1;
}
export function splitMath(text) {
  const parts = [];
  let cursor = 0, plainStart = 0;
  while (cursor < text.length) {
    let found = null;
    if (!escaped(text, cursor)) for (const [left, right, display] of delimiters) {
      if (!text.startsWith(left, cursor)) continue;
      if (left === '$' && (text[cursor + 1] === '$' || /\s/.test(text[cursor + 1] || ' '))) continue;
      let end = text.indexOf(right, cursor + left.length);
      while (end >= 0 && escaped(text, end)) end = text.indexOf(right, end + right.length);
      if (end < 0) continue;
      const tex = text.slice(cursor + left.length, end);
      if (left === '$' && (/\s$/.test(tex) || tex.includes('\n') || text[end + 1] === '$')) continue;
      if (!tex.trim()) continue;
      const raw = text.slice(cursor, end + right.length);
      // KaTeX needs the environment wrapper for align/equation forms.
      found = { type: 'math', raw, tex: left.startsWith('\\begin') ? raw : tex, display };
      break;
    }
    if (!found) { cursor++; continue; }
    if (cursor > plainStart) parts.push({ type: 'text', raw: text.slice(plainStart, cursor) });
    parts.push(found); cursor += found.raw.length; plainStart = cursor;
  }
  if (plainStart < text.length) parts.push({ type: 'text', raw: text.slice(plainStart) });
  return parts;
}
export function splitMessage(value) {
  const text = String(value);
  const parts = [];
  const code = /```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]+`/g;
  let cursor = 0;
  for (const match of text.matchAll(code)) {
    parts.push(...splitMath(text.slice(cursor, match.index)));
    parts.push({ type: 'code', raw: match[0], block: match[0].startsWith('```') });
    cursor = match.index + match[0].length;
  }
  parts.push(...splitMath(text.slice(cursor)));
  return parts;
}
