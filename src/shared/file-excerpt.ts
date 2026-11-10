import type { FileExcerpt, FileSource } from './notebook-api.js';

export const MAX_FILE_EXCERPTS = 5;
export const MAX_EXCERPT_CHARS = 12_000;

export function validFilePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 4096 &&
    !path
      .split('/')
      .some(
        (part) =>
          !part || ['.', '..', '.git'].includes(part) || part.includes('\0'),
      )
  );
}

export function validFileExcerpt(item: unknown): item is FileExcerpt {
  if (!item || typeof item !== 'object') return false;
  const excerpt = item as FileExcerpt;
  return (
    typeof excerpt.projectId === 'string' &&
    excerpt.projectId.length > 0 &&
    validFilePath(excerpt.path) &&
    typeof excerpt.text === 'string' &&
    excerpt.text.length > 0 &&
    excerpt.text.length <= MAX_EXCERPT_CHARS &&
    Number.isSafeInteger(excerpt.start) &&
    excerpt.start >= 0 &&
    Number.isSafeInteger(excerpt.end) &&
    excerpt.end - excerpt.start === excerpt.text.length &&
    Number.isSafeInteger(excerpt.startLine) &&
    excerpt.startLine >= 1 &&
    Number.isSafeInteger(excerpt.endLine) &&
    excerpt.endLine ===
      excerpt.startLine +
        (excerpt.text.slice(0, -1).match(/\n/g)?.length ?? 0) &&
    typeof excerpt.capturedAt === 'string' &&
    Number.isFinite(Date.parse(excerpt.capturedAt)) &&
    typeof excerpt.unsaved === 'boolean' &&
    typeof excerpt.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(excerpt.fingerprint)
  );
}

export function validFileExcerpts(value: unknown): value is FileExcerpt[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FILE_EXCERPTS &&
    value.every(validFileExcerpt)
  );
}

export function validFileSource(value: unknown): value is FileSource {
  if (!value || typeof value !== 'object') return false;
  const { path, excerpt } = value as FileSource;
  return (
    validFilePath(path) &&
    (excerpt === undefined ||
      (validFileExcerpt(excerpt) && excerpt.path === path))
  );
}

export function copyFileExcerpt(excerpt: FileExcerpt): FileExcerpt {
  const {
    projectId,
    path,
    text,
    start,
    end,
    startLine,
    endLine,
    capturedAt,
    unsaved,
    fingerprint,
  } = excerpt;
  return {
    projectId,
    path,
    text,
    start,
    end,
    startLine,
    endLine,
    capturedAt,
    unsaved,
    fingerprint,
  };
}

export async function bufferFingerprint(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function matchesExcerpt(
  excerpt: FileExcerpt,
  buffer: string,
): Promise<boolean> {
  return (
    buffer.slice(excerpt.start, excerpt.end) === excerpt.text &&
    (await bufferFingerprint(buffer)) === excerpt.fingerprint
  );
}
