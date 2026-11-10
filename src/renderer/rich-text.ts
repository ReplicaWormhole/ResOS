import katex from 'katex';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';

interface Span {
  start: number;
  end: number;
}

interface MathSpan extends Span {
  tex: string;
  display: boolean;
}

interface Leaf extends Span {
  node: HTMLElement;
  atomic: boolean;
}

const mathDelimiters: readonly (readonly [string, string, boolean])[] = [
  ['$$', '$$', true],
  ['\\[', '\\]', true],
  ['\\(', '\\)', false],
  ['$', '$', false],
  ...[
    'equation',
    'equation*',
    'align',
    'align*',
    'alignat',
    'alignat*',
    'gather',
    'gather*',
    'multline',
    'multline*',
  ].map(
    (name) => ['\\begin{' + name + '}', '\\end{' + name + '}', true] as const,
  ),
];

function offsets(node: Nodes): Span | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && end !== undefined) return { start, end };
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) for (const child of node.children) walk(child, visit);
}

function escaped(source: string, offset: number): boolean {
  let count = 0;
  while (offset > 0 && source[--offset] === '\\') count++;
  return count % 2 === 1;
}

function mathSpans(source: string, ignored: Span[]): MathSpan[] {
  const spans: MathSpan[] = [];
  let nextIgnored = 0;
  for (let start = 0; start < source.length; start++) {
    while (ignored[nextIgnored] && ignored[nextIgnored]!.end <= start)
      nextIgnored++;
    const ignore = ignored[nextIgnored];
    if (ignore && ignore.start <= start) {
      start = ignore.end - 1;
      continue;
    }
    for (const [open, close, display] of mathDelimiters) {
      if (!source.startsWith(open, start) || escaped(source, start)) continue;
      const inside = start + open.length;
      if (
        open === '$' &&
        (source[inside] === '$' || /\s/.test(source[inside] ?? ' '))
      )
        continue;
      let closing = source.indexOf(close, inside);
      while (closing >= 0 && escaped(source, closing))
        closing = source.indexOf(close, closing + close.length);
      const end = closing + close.length;
      if (closing < 0 || (ignore && end > ignore.start)) continue;
      const content = source.slice(inside, closing);
      if (
        !content.trim() ||
        (open === '$' &&
          (/\s$/.test(content) ||
            content.includes('\n') ||
            source[end] === '$'))
      )
        continue;
      spans.push({
        start,
        end,
        tex: open.startsWith('\\begin') ? source.slice(start, end) : content,
        display,
      });
      start = end - 1;
      break;
    }
  }
  return spans;
}

const blockTags: Partial<Record<Nodes['type'], string>> = {
  paragraph: 'p',
  strong: 'strong',
  emphasis: 'em',
  blockquote: 'blockquote',
  listItem: 'li',
  code: 'pre',
  inlineCode: 'code',
  link: 'span',
  linkReference: 'span',
};

export function renderRichText(source: string, marks: readonly Span[] = []) {
  const ignored: Span[] = [];
  const original = fromMarkdown(source);
  walk(original, (node) => {
    const span = offsets(node);
    if (span && ['inlineCode', 'code', 'html'].includes(node.type))
      ignored.push(span);
  });
  const math = mathSpans(source, ignored);
  let cursor = 0;
  const protectedSource =
    math
      .map(({ start, end }) => {
        const segment =
          source.slice(cursor, start) + '\uE000'.repeat(end - start);
        cursor = end;
        return segment;
      })
      .join('') + source.slice(cursor);
  const root = document.createElement('div');
  root.className = 'chat-rich';
  const leaves: Leaf[] = [];

  function addLeaf(
    parent: HTMLElement,
    span: Span,
    text: string,
    formula?: MathSpan,
  ): void {
    if (span.start === span.end || !text) return;
    const atomic = !!formula || span.end - span.start !== text.length;
    const points = atomic
      ? [span.start, span.end]
      : [
          ...new Set([
            span.start,
            span.end,
            ...marks
              .flatMap((mark) => [mark.start, mark.end])
              .filter((offset) => offset > span.start && offset < span.end),
          ]),
        ].sort((a, b) => a - b);
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1]!;
      const end = points[index]!;
      const node = document.createElement(
        marks.some((mark) => mark.start < end && mark.end > start)
          ? 'mark'
          : 'span',
      );
      node.textContent = atomic
        ? text
        : text.slice(start - span.start, end - span.start);
      if (formula) {
        node.classList.add('chat-math');
        if (formula.display) node.classList.add('chat-display-math');
        try {
          node.innerHTML = katex.renderToString(formula.tex, {
            output: 'mathml',
            displayMode: formula.display,
            throwOnError: true,
            trust: false,
            strict: 'ignore',
            maxExpand: 1000,
            maxSize: 20,
          });
        } catch {
          // Unsupported TeX keeps its original source visible.
        }
      }
      parent.append(node);
      leaves.push({ start, end, node, atomic });
    }
  }

  function text(parent: HTMLElement, span: Span, decoded: string): void {
    const formulas = math.filter(
      (part) => part.start >= span.start && part.end <= span.end,
    );
    if (!formulas.length) {
      const raw = source.slice(span.start, span.end);
      if (
        raw.includes('\\(') ||
        raw.includes('\\[') ||
        raw.includes('\\begin{')
      ) {
        addLeaf(parent, span, raw);
        return;
      }
      // Use the exact subrange when Markdown stripped only a prefix/suffix.
      const offset = raw.indexOf(decoded);
      if (offset >= 0) {
        addLeaf(
          parent,
          {
            start: span.start + offset,
            end: span.start + offset + decoded.length,
          },
          decoded,
        );
      } else {
        addLeaf(parent, span, decoded);
      }
      return;
    }
    let start = span.start;
    for (const formula of formulas) {
      addLeaf(
        parent,
        { start, end: formula.start },
        source.slice(start, formula.start),
      );
      addLeaf(
        parent,
        formula,
        source.slice(formula.start, formula.end),
        formula,
      );
      start = formula.end;
    }
    addLeaf(parent, { start, end: span.end }, source.slice(start, span.end));
  }

  function render(node: Nodes, parent: HTMLElement): void {
    const span = offsets(node);
    if (node.type === 'text' && span) return text(parent, span, node.value);
    if (node.type === 'break' || node.type === 'thematicBreak') {
      parent.append(
        document.createElement(node.type === 'break' ? 'br' : 'hr'),
      );
      return;
    }
    if (node.type === 'definition') return;
    if (node.type === 'html' && span)
      return addLeaf(parent, span, source.slice(span.start, span.end));
    if ((node.type === 'image' || node.type === 'imageReference') && span) {
      return addLeaf(parent, span, source.slice(span.start, span.end));
    }
    const tag =
      node.type === 'heading'
        ? 'h' + Math.min(node.depth + 2, 6)
        : node.type === 'list'
          ? node.ordered
            ? 'ol'
            : 'ul'
          : blockTags[node.type];
    const container = tag ? document.createElement(tag) : parent;
    if (node.type === 'link') {
      container.classList.add('chat-link');
      container.title = node.url;
    }
    if ('children' in node) {
      for (const child of node.children) render(child, container);
    } else if ('value' in node && typeof node.value === 'string' && span) {
      if (node.type === 'code' || node.type === 'inlineCode') {
        const raw = source.slice(span.start, span.end);
        const offset = raw.indexOf(
          node.value,
          node.type === 'inlineCode' ? 1 : 0,
        );
        if (offset >= 0)
          addLeaf(
            container,
            {
              start: span.start + offset,
              end: span.start + offset + node.value.length,
            },
            node.value,
          );
        else addLeaf(container, span, node.value);
      } else {
        addLeaf(container, span, node.value);
      }
    }
    if (container !== parent) parent.append(container);
  }
  render(math.length ? fromMarkdown(protectedSource) : original, root);

  function selection(range: Range): Span | undefined {
    if (
      range.collapsed ||
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    )
      return;
    let start: number | undefined;
    let end: number | undefined;
    for (const leaf of leaves) {
      const target = leaf.atomic ? leaf.node : leaf.node.firstChild;
      if (!target || !range.intersectsNode(target)) continue;
      const from =
        !leaf.atomic && range.startContainer === target
          ? leaf.start + range.startOffset
          : leaf.start;
      const to =
        !leaf.atomic && range.endContainer === target
          ? leaf.start + range.endOffset
          : leaf.end;
      if (from >= to) continue;
      start ??= from;
      end = to;
    }
    if (start !== undefined && end !== undefined) return { start, end };
  }

  return { root, selection };
}
