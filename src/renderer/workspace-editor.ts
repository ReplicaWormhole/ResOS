import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { openSearchPanel } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import type {
  DesktopApi,
  Project,
  WorkspaceFile,
} from '../shared/desktop-api.js';
import { fileFormat, packFile, unpackFile } from './file-format.js';

const styleNonce = EditorView.cspNonce.of(
  document.querySelector<HTMLMetaElement>('meta[name=editor-style-nonce]')!
    .content,
);

interface Tab {
  readonly path: string;
  state: EditorState;
  cleanDoc: Text;
  revision: string;
  saving: boolean;
  diskChanged: boolean;
  notice: string;
}

interface TabGroup {
  readonly tabs: Map<string, Tab>;
  active?: Tab;
  openRequest: number;
}

function language(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.py')) return python();
  if (/\.(?:md|markdown)$/.test(lower)) return markdown();
  if (/\.(?:tex|sty|cls|bib)$/.test(lower)) return StreamLanguage.define(stex);
  return [];
}

function dirty(tab: Tab): boolean {
  return !tab.state.doc.eq(tab.cleanDoc);
}

export class WorkspaceEditor {
  private readonly tabList = document.querySelector<HTMLElement>('#file-tabs')!;
  private readonly empty =
    document.querySelector<HTMLElement>('#editor-empty')!;
  private readonly panel =
    document.querySelector<HTMLElement>('#editor-document')!;
  private readonly status =
    document.querySelector<HTMLElement>('#editor-status')!;
  private readonly error =
    document.querySelector<HTMLElement>('#editor-error')!;
  private readonly saveButton =
    document.querySelector<HTMLButtonElement>('#save-file')!;
  private readonly groups = new Map<string, TabGroup>();
  private readonly view: EditorView;
  private projectId?: string;
  private checkingDisk = false;

  constructor(private readonly api: DesktopApi) {
    this.view = new EditorView({
      parent: document.querySelector<HTMLElement>('#text-editor')!,
      extensions: [styleNonce],
    });
    this.saveButton.addEventListener('click', () => void this.save());
    document
      .querySelector('#find-in-file')!
      .addEventListener('click', () => openSearchPanel(this.view));
    document
      .querySelector('#reload-file')!
      .addEventListener('click', () => void this.reload());
    document
      .querySelector('#close-file')!
      .addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 's' &&
        this.current
      ) {
        event.preventDefault();
        void this.save();
      }
    });
    window.addEventListener('focus', () => void this.checkDisk());
    window.setInterval(() => void this.checkDisk(), 1500);
  }

  show(project: Project): void {
    this.projectId = project.id;
    this.group(project.id);
    this.error.hidden = true;
    this.renderTabs();
    void this.checkDisk();
  }

  hide(): void {
    this.projectId = undefined;
    this.renderTabs();
  }

  async open(project: Project, path: string): Promise<void> {
    const group = this.group(project.id);
    const request = ++group.openRequest;
    try {
      let tab = group.tabs.get(path);
      if (!tab) {
        const snapshot = await this.api.readFile(project.id, path);
        tab = group.tabs.get(path);
        if (!tab) {
          const blank = EditorState.create();
          tab = {
            path,
            state: blank,
            cleanDoc: blank.doc,
            revision: snapshot.revision,
            saving: false,
            diskChanged: false,
            notice: '',
          };
          this.applySnapshot(tab, snapshot);
          group.tabs.set(path, tab);
        }
      }
      if (request === group.openRequest) group.active = tab;
      if (this.projectId === project.id) {
        this.renderTabs();
        if (request === group.openRequest) {
          this.error.hidden = true;
          this.view.focus();
        }
      }
    } catch (error) {
      if (this.projectId === project.id && request === group.openRequest)
        this.showError(error);
    }
  }

  private group(id: string): TabGroup {
    let group = this.groups.get(id);
    if (!group) {
      group = { tabs: new Map(), openRequest: 0 };
      this.groups.set(id, group);
    }
    return group;
  }

  private get current(): Tab | undefined {
    return this.projectId ? this.groups.get(this.projectId)?.active : undefined;
  }

  private applySnapshot(tab: Tab, snapshot: WorkspaceFile): void {
    const { doc, format } = unpackFile(snapshot.text);
    const anchor = Math.min(tab.state.selection.main.head, doc.length);
    tab.state = EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        basicSetup,
        language(tab.path),
        fileFormat.init(() => format),
        styleNonce,
        EditorView.contentAttributes.of({ 'aria-label': 'File contents' }),
        EditorView.updateListener.of((update) => {
          tab.state = update.state;
          if (update.docChanged && this.current === tab) {
            tab.notice = '';
            this.renderStatus();
          }
        }),
      ],
    });
    tab.cleanDoc = tab.state.doc;
    tab.revision = snapshot.revision;
    tab.diskChanged = false;
  }

  private activate(group: TabGroup, tab: Tab): void {
    group.openRequest++;
    group.active = tab;
    this.error.hidden = true;
    this.renderTabs();
  }

  private renderTabs(): void {
    const group = this.projectId ? this.groups.get(this.projectId) : undefined;
    this.tabList.replaceChildren();
    if (group) {
      const tabs = [...group.tabs.values()];
      for (const [index, tab] of tabs.entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'workspace-tab-' + index;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', 'editor-document');
        button.setAttribute('aria-selected', String(group.active === tab));
        button.tabIndex = group.active === tab ? 0 : -1;
        button.title = tab.path;
        button.dataset.path = tab.path;
        button.textContent = tab.path.split('/').at(-1)!;
        button.setAttribute('aria-label', button.textContent);
        button.addEventListener('click', () => {
          this.activate(group, tab);
          this.view.focus();
        });
        button.addEventListener('keydown', (event) => {
          let next: number;
          switch (event.key) {
            case 'ArrowLeft':
              next = (index + tabs.length - 1) % tabs.length;
              break;
            case 'ArrowRight':
              next = (index + 1) % tabs.length;
              break;
            case 'Home':
              next = 0;
              break;
            case 'End':
              next = tabs.length - 1;
              break;
            default:
              return;
          }
          event.preventDefault();
          this.activate(group, tabs[next]!);
          this.tabList
            .querySelector<HTMLButtonElement>('[aria-selected=true]')
            ?.focus();
        });
        this.tabList.append(button);
      }
    }
    this.renderEditor();
  }

  private renderEditor(): void {
    const tab = this.current;
    this.panel.hidden = !tab;
    this.empty.hidden = Boolean(tab);
    if (tab) {
      const button = this.tabList.querySelector('[aria-selected=true]');
      if (button) this.panel.setAttribute('aria-labelledby', button.id);
      if (this.view.state !== tab.state) this.view.setState(tab.state);
    }
    this.renderStatus();
  }

  private renderStatus(): void {
    const group = this.projectId ? this.groups.get(this.projectId) : undefined;
    for (const button of this.tabList.querySelectorAll<HTMLButtonElement>(
      'button',
    )) {
      const tab = group?.tabs.get(button.dataset.path!);
      button.classList.toggle('dirty', Boolean(tab && dirty(tab)));
      button.classList.toggle('disk-changed', Boolean(tab?.diskChanged));
    }
    const tab = group?.active;
    this.saveButton.disabled = !tab || tab.saving || !dirty(tab);
    if (!tab) return;
    let status =
      tab.notice || (dirty(tab) ? 'Unsaved changes' : 'Saved on disk');
    if (tab.diskChanged) {
      status = dirty(tab)
        ? 'The disk version changed or is unavailable. Your draft is preserved.'
        : 'The disk version is unavailable.';
    }
    this.status.textContent =
      tab.path + ' · ' + (tab.saving ? 'Saving…' : status);
  }

  private async save(): Promise<void> {
    const id = this.projectId;
    const tab = this.current;
    if (!id || !tab || tab.saving || !dirty(tab)) return;
    const state = tab.state;
    tab.saving = true;
    this.error.hidden = true;
    this.renderStatus();
    try {
      const result = await this.api.saveFile(
        id,
        tab.path,
        tab.revision,
        packFile(state),
      );
      if (result.status === 'saved') {
        tab.revision = result.revision;
        tab.cleanDoc = state.doc;
        tab.diskChanged = false;
        tab.notice = dirty(tab) ? '' : 'Saved on disk';
      } else {
        tab.diskChanged = true;
      }
    } catch (error) {
      if (this.current === tab) this.showError(error);
      tab.diskChanged = true;
    } finally {
      tab.saving = false;
      this.renderStatus();
    }
  }

  private async reload(): Promise<void> {
    const id = this.projectId;
    const tab = this.current;
    if (!id || !tab || tab.saving) return;
    if (
      dirty(tab) &&
      !window.confirm('Discard the draft and reload this file from disk?')
    )
      return;
    const state = tab.state;
    const revision = tab.revision;
    try {
      const snapshot = await this.api.readFile(id, tab.path);
      if (
        tab.saving ||
        tab.revision !== revision ||
        !tab.state.doc.eq(state.doc)
      )
        return;
      this.applySnapshot(tab, snapshot);
      tab.notice = 'Reloaded from disk';
      if (this.current === tab) {
        this.error.hidden = true;
        this.renderEditor();
      }
    } catch (error) {
      if (this.current === tab) this.showError(error);
    }
  }

  private close(): void {
    const tab = this.current;
    if (!this.projectId || !tab || tab.saving) return;
    if (
      dirty(tab) &&
      !window.confirm('Close this tab and discard its unsaved draft?')
    )
      return;
    const group = this.group(this.projectId);
    group.openRequest++;
    group.tabs.delete(tab.path);
    group.active = [...group.tabs.values()].at(-1);
    this.error.hidden = true;
    this.renderTabs();
    if (group.active) this.view.focus();
  }

  private async checkDisk(): Promise<void> {
    if (this.checkingDisk) return;
    this.checkingDisk = true;
    try {
      for (const [id, group] of this.groups) {
        for (const tab of group.tabs.values()) {
          if (tab.saving) continue;
          const revision = tab.revision;
          let snapshot: WorkspaceFile | undefined;
          try {
            snapshot = await this.api.readFile(id, tab.path);
          } catch {
            // Keep the last readable contents if the file disappears or becomes invalid.
          }
          if (
            tab.saving ||
            tab.revision !== revision ||
            group.tabs.get(tab.path) !== tab
          )
            continue;
          tab.diskChanged = !snapshot || snapshot.revision !== revision;
          if (snapshot && tab.diskChanged && !dirty(tab)) {
            this.applySnapshot(tab, snapshot);
            tab.notice = 'Updated from disk';
          }
        }
      }
      this.renderEditor();
    } finally {
      this.checkingDisk = false;
    }
  }

  private showError(error: unknown): void {
    this.error.textContent =
      error instanceof Error ? error.message : String(error);
    this.error.hidden = false;
  }
}
