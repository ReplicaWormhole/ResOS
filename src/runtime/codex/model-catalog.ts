import type { HarnessModel } from '../../shared/notebook-api.js';
import { validSettingId } from '../../shared/run-settings.js';
import { object } from './stdio-rpc.js';
import type { StdioRpc } from './stdio-rpc.js';

export async function codexModels(client: StdioRpc): Promise<HarnessModel[]> {
  const models = new Map<string, HarnessModel>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.call('model/list', {
      cursor,
      includeHidden: false,
    });
    if (!Array.isArray(page.data))
      throw new Error('Codex returned an invalid model catalog.');
    for (const raw of page.data) {
      const entry = object(raw);
      const id = entry.model;
      if (
        entry.hidden ||
        !validSettingId(id) ||
        (Array.isArray(entry.inputModalities) &&
          !entry.inputModalities.includes('text'))
      )
        continue;
      const efforts = Array.isArray(entry.supportedReasoningEfforts)
        ? [
            ...new Set(
              entry.supportedReasoningEfforts
                .map((effort: unknown) => object(effort).reasoningEffort)
                .filter(validSettingId),
            ),
          ]
        : [];
      const defaultEffort =
        validSettingId(entry.defaultReasoningEffort) &&
        efforts.includes(entry.defaultReasoningEffort)
          ? entry.defaultReasoningEffort
          : undefined;
      models.set(id, {
        id,
        label: typeof entry.displayName === 'string' ? entry.displayName : id,
        efforts,
        ...(defaultEffort ? { defaultEffort } : {}),
        isDefault: entry.isDefault === true,
      });
    }
    cursor =
      typeof page.nextCursor === 'string' && page.nextCursor
        ? page.nextCursor
        : undefined;
    if (cursor && (cursors.has(cursor) || cursors.size >= 15))
      throw new Error('Codex returned an invalid model catalog cursor.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...models.values()];
}
