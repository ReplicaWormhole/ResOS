import { MapMode, StateField } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';

interface FileFormat {
  readonly bom: string;
  readonly lineEnding: string;
  readonly otherEndings: ReadonlyMap<number, string>;
}

const utf8Bom = '\uFEFF';

export function unpackFile(raw: string): { doc: string; format: FileFormat } {
  const bom = raw.startsWith(utf8Bom) ? utf8Bom : '';
  const text = raw.slice(bom.length);
  const lineEnding = text.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const otherEndings = new Map<number, string>();
  let removed = 0;
  const doc = text.replace(/\r\n|\r|\n/g, (ending: string, offset: number) => {
    if (ending !== lineEnding) otherEndings.set(offset - removed, ending);
    removed += ending.length - 1;
    return '\n';
  });
  return { doc, format: { bom, lineEnding, otherEndings } };
}

export const fileFormat = StateField.define<FileFormat>({
  create: () => ({ bom: '', lineEnding: '\n', otherEndings: new Map() }),
  update(format, transaction) {
    if (!transaction.docChanged || !format.otherEndings.size) return format;
    const otherEndings = new Map<number, string>();
    for (const [offset, ending] of format.otherEndings) {
      const position = transaction.changes.mapPos(
        offset,
        1,
        MapMode.TrackAfter,
      );
      if (
        position !== null &&
        transaction.newDoc.sliceString(position, position + 1) === '\n'
      ) {
        otherEndings.set(position, ending);
      }
    }
    return { ...format, otherEndings };
  },
});

export function packFile(state: EditorState): string {
  const { bom, lineEnding, otherEndings } = state.field(fileFormat);
  return (
    bom +
    state.doc
      .toString()
      .replace(
        /\n/g,
        (_newline: string, offset: number) =>
          otherEndings.get(offset) ?? lineEnding,
      )
  );
}
