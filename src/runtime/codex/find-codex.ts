import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

async function executableIn(
  directories: string[],
): Promise<string | undefined> {
  for (const directory of directories) {
    if (!directory.startsWith('/')) continue;
    const path = join(directory, 'codex');
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Continue searching the user's other binary directories.
    }
  }
}

export async function findCodex(): Promise<string> {
  if (process.env.RESOS_CODEX_BIN) return process.env.RESOS_CODEX_BIN;
  const home = homedir();
  const found = await executableIn([
    ...(process.env.PATH ?? '').split(delimiter),
    join(home, '.local/bin'),
  ]);
  if (found) return found;

  // A launcher started from the desktop may not inherit a terminal's nvm PATH.
  const nodeVersions = join(
    process.env.NVM_DIR || join(home, '.nvm'),
    'versions/node',
  );
  try {
    const versions = (await readdir(nodeVersions)).filter((entry) =>
      /^v\d+\.\d+\.\d+$/.test(entry),
    );
    versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    return (
      (await executableIn(
        versions.map((version) => join(nodeVersions, version, 'bin')),
      )) ?? 'codex'
    );
  } catch {
    return 'codex';
  }
}
