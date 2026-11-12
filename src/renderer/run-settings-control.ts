import type {
  ChatApi,
  HarnessCatalog,
  RunMode,
  RunSettings,
} from '../shared/notebook-api.js';
import { validateModelSelection } from '../shared/run-settings.js';

export class RunSettingsControl {
  private readonly host = document.querySelector<HTMLElement>('#run-settings')!;
  private readonly model =
    document.querySelector<HTMLSelectElement>('#run-model')!;
  private readonly effort =
    document.querySelector<HTMLSelectElement>('#run-effort')!;
  private readonly mode =
    document.querySelector<HTMLSelectElement>('#run-mode')!;
  private readonly toggle = document.querySelector<HTMLButtonElement>(
    '#run-settings-toggle',
  )!;
  private readonly summary = document.querySelector<HTMLElement>(
    '#run-settings-summary',
  )!;
  private readonly menu =
    document.querySelector<HTMLElement>('#run-settings-menu')!;
  private readonly refresh =
    document.querySelector<HTMLButtonElement>('#refresh-models')!;
  private readonly status = document.querySelector<HTMLElement>(
    '#run-settings-status',
  )!;
  private readonly drafts = new Map<string, RunSettings>();
  private catalog?: HarnessCatalog;
  private projectId?: string;
  private chatId?: string;
  private available = false;
  private loading = false;
  private request = 0;

  constructor(
    private readonly api: ChatApi,
    private readonly changed: () => void,
  ) {
    this.menu.addEventListener('beforetoggle', (event) => {
      this.toggle.setAttribute(
        'aria-expanded',
        String((event as ToggleEvent).newState === 'open'),
      );
    });
    this.refresh.addEventListener('click', () => void this.load());
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

  close(): void {
    this.menu.hidePopover();
  }

  show(projectId: string | undefined, available: boolean): void {
    if (projectId === this.projectId && available === this.available) return;
    this.close();
    this.projectId = projectId;
    this.available = available;
    this.catalog = undefined;
    this.loading = false;
    this.request++;
    this.status.textContent = '';
    this.host.hidden = !available;
    if (available) void this.load();
  }

  selectChat(chatId: string | undefined): void {
    if (this.chatId === chatId) return;
    this.close();
    this.chatId = chatId;
    this.render();
  }

  forgetChats(ids: readonly string[]): void {
    for (const id of ids) this.drafts.delete(id);
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

  private async load(): Promise<void> {
    const projectId = this.projectId;
    if (!projectId || !this.available) return;
    const request = ++this.request;
    this.catalog = undefined;
    this.loading = true;
    this.status.textContent = 'Loading models…';
    this.render();
    this.changed();
    try {
      const catalog = await this.api.harnessCatalog(projectId);
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
    this.host.hidden = !this.available || catalog?.harness === 'demo';
    if (this.host.hidden) this.close();
    this.summary.textContent = this.loading
      ? 'Loading models…'
      : catalog
        ? 'Choose model'
        : 'Model settings unavailable';
    this.toggle.title = this.status.textContent;
    this.refresh.disabled = this.loading;
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
      new Option('Default', ''),
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
    const valid = this.selected() !== undefined;
    this.status.textContent = valid
      ? policy
      : 'Select an available model and effort.';
    const thinking = settings.effort
      ? settings.effort[0]!.toUpperCase() + settings.effort.slice(1)
      : 'Default';
    this.summary.textContent =
      (selectedModel?.label ?? settings.model ?? 'Choose model') +
      ' · ' +
      thinking +
      (valid ? '' : ' (unavailable)');
    this.toggle.title = this.status.textContent;
  }
}
