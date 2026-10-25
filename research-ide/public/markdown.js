// Escape source text before adding the supported Markdown tags.
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeMarkdown(value) {
  const fences = [];
  let text = escapeHtml(value).replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, code) => {
    const token = '\u0000FENCE' + fences.length + '\u0000';
    fences.push('<pre><code>' + code.trimEnd() + '</code></pre>');
    return token;
  });
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, title) => {
    const level = Math.min(hashes.length + 2, 5);
    return '<h' + level + '>' + title + '</h' + level + '>';
  });
  return text.replace(/\n/g, '<br>').replace(/\u0000FENCE(\d+)\u0000/g, (_, index) => fences[Number(index)] || '');
}

// Plain-text coordinates of this renderer, shared with server-side source validation.
export function markdownText(value) {
  return safeMarkdown(value).replace(/<br>/g, '\n').replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'").replaceAll('&amp;', '&');
}
