import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const colors = {
  '&': {
    color: 'var(--text)',
    backgroundColor: 'var(--editor-bg)',
  },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': {
    color: 'var(--muted)',
    backgroundColor: 'var(--rail)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--editor-line)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection)',
  },
  '.cm-panels': {
    color: 'var(--text)',
    backgroundColor: 'var(--rail)',
  },
};

const light = [
  EditorView.theme(colors),
  syntaxHighlighting(defaultHighlightStyle),
];
const dark = [
  EditorView.theme(colors, { dark: true }),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: '#c4a7e7' },
      { tag: tags.name, color: '#eee' },
      { tag: [tags.string, tags.regexp], color: '#e5c890' },
      { tag: [tags.number, tags.bool, tags.null], color: '#efb48a' },
      { tag: tags.comment, color: '#a3a3a3', fontStyle: 'italic' },
      { tag: tags.heading, color: '#a9c7ff', fontWeight: 'bold' },
      { tag: tags.link, color: '#a9c7ff', textDecoration: 'underline' },
      { tag: tags.emphasis, fontStyle: 'italic' },
      { tag: tags.strong, fontWeight: 'bold' },
      { tag: tags.invalid, color: '#ff9a9a' },
    ]),
  ),
];

export function editorTheme(darkMode: boolean) {
  return darkMode ? dark : light;
}
