// A single text coordinate system for selections and rendered Markdown, including line breaks.
export function passageText(root) {
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType === Node.TEXT_NODE) {
      text += walker.currentNode.data;
    } else if (walker.currentNode.nodeName === 'BR') {
      text += '\n';
    }
  }
  return text;
}

export function passageRange(text, chat, message) {
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
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) {
      nodes.push({
        node,
        start: offset
      });
      offset += node.length;
    } else if (node.nodeName === 'BR') {
      offset++;
    }
  }
  for (const { node, start } of nodes) {
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
      const mark = document.createElement('mark');
      mark.className = 'linked-passage';
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
      mark.setAttribute('aria-haspopup', 'dialog');
      mark.title = 'View ' + linked.length + ' linked chat' + (linked.length > 1 ? 's' : '');
      mark.setAttribute('aria-label', mark.title + ': ' + textNode.data);
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
      mark.append(textNode);
      fragment.append(mark);
    }
    node.replaceWith(fragment);
  }
  return children.filter(chat => !ranges.some(item => item.chat.id === chat.id));
}
