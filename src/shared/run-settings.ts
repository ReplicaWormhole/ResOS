import type { Harness, HarnessModel, RunSettings } from './notebook-api.js';

export function validHarness(value: unknown): value is Harness {
  return value === 'demo' || value === 'codex' || value === 'claude';
}

export const harnessLabels: Record<Harness, string> = {
  demo: 'ResOS demo',
  codex: 'Codex',
  claude: 'Claude Code',
};

export function validRunSettings(value: unknown): value is RunSettings {
  if (!value || typeof value !== 'object') return false;
  const { harness, mode, model, effort } = value as RunSettings;
  return (
    validHarness(harness) &&
    (mode === 'ask' || (harness !== 'demo' && mode === 'agent')) &&
    (model === undefined || (harness !== 'demo' && validSettingId(model))) &&
    (effort === undefined || (model !== undefined && validSettingId(effort)))
  );
}

export function validSettingId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !/\s/.test(value)
  );
}

export function validateModelSelection(
  models: HarnessModel[],
  settings: RunSettings,
): void {
  if (settings.model === undefined) return;
  const model = models.find(({ id }) => id === settings.model);
  if (!model)
    throw new Error(
      'The saved model is unavailable: ' +
        settings.model +
        '. Select an available model and start a new run.',
    );
  if (settings.effort !== undefined && !model.efforts.includes(settings.effort))
    throw new Error(
      'The saved reasoning effort is unavailable for ' +
        settings.model +
        '. Select a supported effort and start a new run.',
    );
}
