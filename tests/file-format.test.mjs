import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import {
  fileFormat,
  packFile,
  unpackFile,
} from '../dist/renderer/file-format.js';

test('retains the UTF-8 BOM and existing mixed line endings when editing', () => {
  const raw = '\uFEFFfirst\r\nsecond\nthird\r';
  const { doc, format } = unpackFile(raw);
  const state = EditorState.create({
    doc,
    extensions: [fileFormat.init(() => format)],
  });
  assert.equal(packFile(state), raw);
  const edited = state.update({
    changes: { from: 6, to: 12, insert: 'new\nsecond' },
  }).state;
  assert.equal(packFile(edited), '\uFEFFfirst\r\nnew\r\nsecond\nthird\r');
});
