import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceSave,
} from '../shared/desktop-api.js';

const maxBytes = 4 * 1024 * 1024;
const directoryFlags =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const readFlags =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function components(value: string): string[] {
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error('Invalid workspace path.');
  if (value === '') return [];
  const parts = value.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part === '.git' ||
        part.includes('\0'),
    )
  ) {
    throw new Error('Invalid workspace path.');
  }
  return parts;
}

function descriptorPath(handle: FileHandle): string {
  return '/proc/self/fd/' + handle.fd;
}

// Resolve descendants relative to open directory descriptors on Linux. A path
// component replaced by a symbolic link cannot redirect the next operation.
async function inDirectory<T>(
  root: string,
  parts: readonly string[],
  action: (directory: string, checkLocation: () => Promise<void>) => Promise<T>,
): Promise<T> {
  let handle = await open(root, directoryFlags);
  try {
    for (const part of parts) {
      const previous = handle;
      handle = await open(join(descriptorPath(previous), part), directoryFlags);
      await previous.close();
    }

    const directory = descriptorPath(handle);
    const expected = join(root, ...parts);
    async function checkLocation(): Promise<void> {
      if ((await realpath(directory)) !== expected)
        throw new Error('The workspace directory moved.');
    }
    await checkLocation();
    return await action(directory, checkLocation);
  } finally {
    await handle.close();
  }
}

async function readSnapshot(
  path: string,
): Promise<WorkspaceFile & { mode: number }> {
  const file = await open(path, readFlags);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) throw new Error('Only regular files can be edited.');
    if (before.size > maxBytes)
      throw new Error('The editor supports files up to 4 MiB.');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (
      BigInt(length) !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error('The file changed while it was being read. Try again.');
    }
    const content = bytes.subarray(0, length);
    let text: string;
    try {
      text = decoder.decode(content);
    } catch {
      throw new Error('The file is not valid UTF-8.');
    }
    if (text.includes('\0')) throw new Error('The file contains binary data.');
    return {
      text,
      revision: createHash('sha256').update(content).digest('hex'),
      mode: Number(before.mode) & 0o777,
    };
  } finally {
    await file.close();
  }
}

async function withFile<T>(
  root: string,
  relative: string,
  action: (
    path: string,
    directory: string,
    checkLocation: () => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const parents = components(relative);
  const name = parents.pop();
  if (!name) throw new Error('Choose a workspace file.');
  return inDirectory(root, parents, (directory, checkLocation) =>
    action(join(directory, name), directory, checkLocation),
  );
}

export async function listDirectory(
  root: string,
  relative: string,
): Promise<WorkspaceEntry[]> {
  return inDirectory(
    root,
    components(relative),
    async (directory, checkLocation) => {
      const entries = await readdir(directory, { withFileTypes: true });
      await checkLocation();
      return entries
        .filter(
          (entry) =>
            entry.name !== '.git' && (entry.isDirectory() || entry.isFile()),
        )
        .map((entry): WorkspaceEntry => ({
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
        }))
        .sort(
          (a, b) =>
            a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
        );
    },
  );
}

export async function readFile(
  root: string,
  relative: string,
): Promise<WorkspaceFile> {
  return withFile(root, relative, async (path, _directory, checkLocation) => {
    const { text, revision } = await readSnapshot(path);
    await checkLocation();
    return { text, revision };
  });
}

export async function saveFile(
  root: string,
  relative: string,
  revision: string,
  text: string,
): Promise<WorkspaceSave> {
  if (
    typeof revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(revision) ||
    typeof text !== 'string' ||
    Buffer.byteLength(text) > maxBytes ||
    text.includes('\0') ||
    !text.isWellFormed()
  ) {
    throw new Error('Invalid editor contents or file revision.');
  }
  return withFile(root, relative, async (path, directory, checkLocation) => {
    const original = await readSnapshot(path);
    if (original.revision !== revision) return { status: 'conflict' };

    const temporary = join(directory, '.resos-' + randomUUID() + '.tmp');
    const file = await open(temporary, 'wx', 0o600);
    let renamed = false;
    try {
      try {
        await file.writeFile(text, 'utf8');
        await file.chmod(original.mode);
      } finally {
        await file.close();
      }
      const latest = await readSnapshot(path);
      if (latest.revision !== revision || latest.mode !== original.mode) {
        return { status: 'conflict' };
      }
      await checkLocation();
      await rename(temporary, path);
      renamed = true;
      return {
        status: 'saved',
        revision: createHash('sha256').update(text).digest('hex'),
      };
    } finally {
      if (!renamed) await unlink(temporary);
    }
  });
}
