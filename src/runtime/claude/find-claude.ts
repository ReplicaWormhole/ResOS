import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export async function findClaude(): Promise<string | undefined> {
  const override = process.env.RESOS_CLAUDE_BIN;
  if (override && isAbsolute(override)) return override;

  const directories = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(homedir(), '.local/bin'),
  ];
  for (const directory of directories) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, 'claude');
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching other absolute directories.
    }
  }
}
