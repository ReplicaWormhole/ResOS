// Math is one atomic source unit: KaTeX's visual and accessibility trees must
// not duplicate text or change the saved selection offsets.
function sourceUnits(root) {
  const units = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let math = null, offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (math?.contains(node)) continue;
    const source = node.getAttribute?.('data-math-source');
    let text;
    if (source != null) { math = node; text = source; }
    else if (node.nodeType === Node.TEXT_NODE) text = node.data;
    else if (node.nodeName === 'BR') text = '\n';
    else continue;
    units.push({ node, start: offset, text, math: source != null }); offset += text.length;
  }
  return units;
}
export function passageText(root) { return sourceUnits(root).map(unit => unit.text).join(''); }
export function selectedPassage(body, range) {
  const expanded = range.cloneRange();
  const element = node => node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const startMath = element(range.startContainer)?.closest?.('[data-math-source]');
  const endMath = element(range.endContainer)?.closest?.('[data-math-source]');
  if (startMath && body.contains(startMath)) expanded.setStartBefore(startMath);
  if (endMath && body.contains(endMath)) expanded.setEndAfter(endMath);
  const prefix = document.createRange(); prefix.selectNodeContents(body); prefix.setEnd(expanded.startContainer, expanded.startOffset);
  const raw = passageText(expanded.cloneContents());
  return { quote: raw.trim(), start: passageText(prefix.cloneContents()).length + raw.length - raw.trimStart().length };
}

export function passageRange(text, chat, message) {
  if (chat.parentRevisionId && chat.parentRevisionId !== message.revisionId) return null;
  const quote = chat.selectedQuote || '';
  if (!quote) {
    return null;
  }
  if (
    Number.isInteger(chat.selectedStart) &&
    chat.parentMessageId === message.id &&
    text.slice(chat.selectedStart, chat.selectedStart + quote.length) === quote
  ) {
    return [chat.selectedStart, chat.selectedStart + quote.length];
  }
  const start = text.indexOf(quote);
  if (chat.sourceFile && start !== text.lastIndexOf(quote)) {
    return null;
  }
  if (start >= 0) {
    return [start, start + quote.length];
  }
  // Older selections may use browser-inserted newlines or raw Markdown.
  const normalized = [];
  const positions = [];
  for (let i = 0; i < text.length; i++) {
    const char = /\s/.test(text[i]) ? ' ' : text[i];
    if (char === ' ' && normalized.at(-1) === ' ') {
      continue;
    }
    normalized.push(char);
    positions.push(i);
  }
  const needle = quote.replace(/\s+/g, ' ').trim();
  const index = normalized.join('').indexOf(needle);
  return index < 0 || !needle ? null : [positions[index], positions[index + needle.length - 1] + 1];
}

export function markLinkedPassages(body, message, children, onOpen) {
  if (!children.length) {
    return [];
  }
  const text = passageText(body);
  const ranges = children.map(chat => ({
    chat,
    range: passageRange(text, chat, message)
  })).filter(item => item.range);
  const nodes = sourceUnits(body);
  for (const { node, start, text: source, math } of nodes) {
    if (math) {
      const linked = ranges.filter(item => item.range[0] < start + source.length && item.range[1] > start);
      if (linked.length) {
        const mark = makeMark(linked, source, onOpen);
        node.replaceWith(mark); mark.append(node);
      }
      continue;
    }
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const cuts = new Set([0, node.length]);
    for (const { range: [a, b] } of ranges) {
      if (a < start + node.length && b > start) {
        cuts.add(Math.max(0, a - start));
        cuts.add(Math.min(node.length, b - start));
      }
    }
    const points = [...cuts].sort((a, b) => a - b);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const linked = ranges.filter(item => item.range[0] < start + b && item.range[1] > start + a);
      const textNode = document.createTextNode(node.data.slice(a, b));
      if (!linked.length) {
        fragment.append(textNode);
        continue;
      }
      const mark = makeMark(linked, textNode.data, onOpen);
      mark.append(textNode);
      fragment.append(mark);
    }
    node.replaceWith(fragment);
  }
  return children.filter(chat => !ranges.some(item => item.chat.id === chat.id));
}

function makeMark(linked, label, onOpen) {
  const mark = document.createElement('mark');
  mark.className = 'linked-passage';
  mark.tabIndex = 0;
  mark.setAttribute('role', 'button');
  mark.setAttribute('aria-haspopup', 'dialog');
  mark.title = 'View ' + linked.length + ' linked chat' + (linked.length > 1 ? 's' : '');
  mark.setAttribute('aria-label', mark.title + ': ' + label);
  const open = event => {
    event.preventDefault();
    event.stopPropagation();
    if (window.getSelection()?.toString()) {
      return;
    }
    onOpen(linked.map(item => item.chat.id));
  };
  mark.addEventListener('click', open);
  mark.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      window.getSelection()?.removeAllRanges();
      open(event);
    }
  });
  return mark;
}
