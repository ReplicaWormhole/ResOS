import type {
  ChatApi,
  Harness,
  HarnessCatalog,
  RunMode,
  RunSettings,
} from '../shared/notebook-api.js';
import {
  harnessLabels,
  validHarness,
  validateModelSelection,
} from '../shared/run-settings.js';

export class RunSettingsControl {
  private readonly host = document.querySelector<HTMLElement>('#run-settings')!;
  private readonly model =
    document.querySelector<HTMLSelectElement>('#run-model')!;
  private readonly effort =
    document.querySelector<HTMLSelectElement>('#run-effort')!;
  private readonly mode =
    document.querySelector<HTMLSelectElement>('#run-mode')!;
  private readonly harness =
    document.querySelector<HTMLSelectElement>('#run-harness')!;
  private readonly refresh =
    document.querySelector<HTMLButtonElement>('#refresh-models')!;
  private readonly status = document.querySelector<HTMLElement>(
    '#run-settings-status',
  )!;
  private readonly drafts = new Map<string, RunSettings>();
  private catalog?: HarnessCatalog;
  private harnesses?: Harness[];
  private choice?: Harness;
  private readonly banner =
    document.querySelector<HTMLElement>('#chat-runtime')!;
  private projectId?: string;
  private chatId?: string;
  private available = false;
  private loading = false;
  private request = 0;

  constructor(
    private readonly api: ChatApi,
    private readonly changed: () => void,
  ) {
    this.refresh.addEventListener('click', () => void this.load());
    this.harness.addEventListener('change', () => {
      if (validHarness(this.harness.value)) void this.load(this.harness.value);
    });
    this.mode.addEventListener('change', () =>
      this.save({ mode: this.mode.value as RunMode }),
    );
    this.effort.addEventListener('change', () =>
      this.save({ effort: this.effort.value || undefined }),
    );
    this.model.addEventListener('change', () => {
      const model = this.catalog?.models.find(
        ({ id }) => id === this.model.value,
      );
      if (model) this.save({ model: model.id, effort: model.defaultEffort });
    });
  }

  show(projectId: string | undefined, available: boolean): void {
    if (projectId === this.projectId && available === this.available) return;
    this.projectId = projectId;
    this.available = available;
    this.catalog = undefined;
    this.choice = undefined;
    this.loading = false;
    this.request++;
    this.status.textContent = '';
    this.host.hidden = !available;
    if (available) void this.load();
  }

  selectChat(chatId: string | undefined): void {
    if (this.chatId === chatId) return;
    this.chatId = chatId;
    const settings = chatId ? this.drafts.get(chatId) : undefined;
    if (settings && this.available && settings.harness !== this.choice)
      void this.load(settings.harness);
    else this.render();
  }

  selected(): RunSettings | undefined {
    const settings = this.chatId && this.drafts.get(this.chatId);
    if (!settings || !this.catalog || settings.harness !== this.catalog.harness)
      return;
    try {
      validateModelSelection(this.catalog.models, settings);
      return settings;
    } catch {
      return;
    }
  }

  private save(patch: Partial<RunSettings>): void {
    if (!this.chatId) return;
    const current = this.drafts.get(this.chatId);
    if (!current) return;
    this.drafts.set(this.chatId, { ...current, ...patch });
    this.render();
    this.changed();
  }

  supportsNotebookLookup(): boolean {
    return this.catalog?.supportsNotebookLookup === true;
  }

  private async load(harness?: Harness): Promise<void> {
    const projectId = this.projectId;
    if (!projectId || !this.available) return;
    const request = ++this.request;
    this.catalog = undefined;
    if (harness) this.choice = harness;
    this.loading = true;
    this.status.textContent = 'Loading harness settings…';
    this.render();
    this.changed();
    try {
      const harnesses = this.harnesses ?? (await this.api.listHarnesses());
      if (request !== this.request) return;
      this.harnesses = harnesses;
      const selected =
        this.choice && harnesses.includes(this.choice)
          ? this.choice
          : harnesses[0];
      if (!selected) throw new Error('No coding harnesses are available.');
      this.choice = selected;
      this.render();
      const catalog = await this.api.harnessCatalog(projectId, selected);
      if (request !== this.request) return;
      this.catalog = catalog;
      this.status.textContent = '';
    } catch (error) {
      if (request === this.request)
        this.status.textContent =
          error instanceof Error ? error.message : String(error);
    } finally {
      if (request === this.request) {
        this.loading = false;
        this.render();
        this.changed();
      }
    }
  }

  private render(): void {
    const catalog = this.catalog;
    this.host.hidden = !this.available || this.choice === 'demo';
    this.banner.textContent =
      this.choice === 'demo'
        ? 'Demo runtime · Responses are generated locally.'
        : this.choice
          ? harnessLabels[this.choice] +
            ' · Messages and selected context go to the configured model service.'
          : '';
    this.refresh.disabled = this.loading;
    this.harness.replaceChildren(
      ...(this.harnesses ?? []).map((id) => new Option(harnessLabels[id], id)),
    );
    this.harness.value = this.choice ?? '';
    this.harness.disabled = !this.harnesses || this.harnesses.length < 2;
    this.model.disabled = !catalog || !this.chatId;
    this.mode.disabled = !catalog || !this.chatId;
    this.effort.disabled = true;
    if (!catalog || !this.chatId) return;
    let settings = this.drafts.get(this.chatId);
    if (!settings || settings.harness !== catalog.harness) {
      const model =
        catalog.models.find(({ isDefault }) => isDefault) ?? catalog.models[0];
      settings = {
        harness: catalog.harness,
        mode: catalog.modes.includes('ask') ? 'ask' : catalog.modes[0]!,
        ...(model ? { model: model.id, effort: model.defaultEffort } : {}),
      };
      this.drafts.set(this.chatId, settings);
    }
    this.mode.replaceChildren(
      ...catalog.modes.map(
        (mode) => new Option(mode === 'ask' ? 'Ask' : 'Agent', mode),
      ),
    );
    this.mode.value = settings.mode;
    const policy =
      settings.mode === 'ask'
        ? 'Read-only tools · No escalation'
        : settings.harness === 'claude'
          ? 'Project file changes and sandboxed commands require approval'
          : 'Project writes · Approval for escalation';
    this.model.replaceChildren(
      ...catalog.models.map(({ id, label }) => new Option(label, id)),
    );
    const selectedModel = catalog.models.find(
      ({ id }) => id === settings.model,
    );
    if (settings.model && !selectedModel) {
      const option = new Option(
        settings.model + ' (unavailable)',
        settings.model,
      );
      option.disabled = true;
      this.model.append(option);
    }
    this.model.value = settings.model ?? '';
    this.effort.replaceChildren(
      new Option('Harness default', ''),
      ...(selectedModel?.efforts ?? []).map(
        (effort) => new Option(effort, effort),
      ),
    );
    if (settings.effort && !selectedModel?.efforts.includes(settings.effort)) {
      const option = new Option(
        settings.effort + ' (unavailable)',
        settings.effort,
      );
      option.disabled = true;
      this.effort.append(option);
    }
    this.effort.value = settings.effort ?? '';
    this.effort.disabled = !selectedModel?.efforts.length;
    this.status.textContent = this.selected()
      ? policy
      : 'Select an available model and effort.';
  }
}
