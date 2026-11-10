import {
  bufferFingerprint,
  matchesExcerpt,
  MAX_EXCERPT_CHARS,
} from '../shared/file-excerpt.js';
import type { FileExcerpt, FileNote } from '../shared/notebook-api.js';
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
  view?: EditorView;
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
  private readonly notesHost =
    document.querySelector<HTMLElement>('#editor-notes')!;
  private notes: FileNote[] = [];
  private displayedNotes?: { tab: Tab; doc: Text; notes: FileNote[] };
  private changed: () => void = () => {};
  private readonly groups = new Map<string, TabGroup>();
  private readonly editorHost =
    document.querySelector<HTMLElement>('#text-editor')!;
  private shown?: Tab;
  private projectId?: string;
  private checkingDisk = false;

  constructor(private readonly api: DesktopApi) {
    this.saveButton.addEventListener('click', () => void this.save());
    document.querySelector('#find-in-file')!.addEventListener('click', () => {
      const view = this.current?.view;
      if (view) openSearchPanel(view);
    });
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

  onBufferChange(changed: () => void): void {
    this.changed = changed;
  }

  fileSource():
    { projectId: string; path: string; unsaved: boolean } | undefined {
    const tab = this.current;
    if (this.projectId && tab)
      return { projectId: this.projectId, path: tab.path, unsaved: dirty(tab) };
  }

  captureSelection(range: Range): (() => Promise<FileExcerpt>) | undefined {
    const projectId = this.projectId;
    const tab = this.current;
    const view = tab?.view;
    if (
      !projectId ||
      !tab ||
      !view ||
      !view.contentDOM.contains(range.startContainer) ||
      !view.contentDOM.contains(range.endContainer)
    )
      return;
    const from = view.posAtDOM(range.startContainer, range.startOffset);
    const to = view.posAtDOM(range.endContainer, range.endOffset);
    const doc = tab.state.doc;
    if (to <= from || !doc.sliceString(from, to).trim()) return;
    const capturedAt = new Date().toISOString();
    const unsaved = dirty(tab);
    return async () => {
      if (this.current !== tab || tab.state.doc !== doc)
        throw new Error(
          'The selected buffer changed. Select the passage again.',
        );
      if (to - from > MAX_EXCERPT_CHARS)
        throw new Error('Select at most 12,000 characters.');
      return {
        projectId,
        path: tab.path,
        text: doc.sliceString(from, to),
        start: from,
        end: to,
        startLine: doc.lineAt(from).number,
        endLine: doc.lineAt(to - 1).number,
        capturedAt,
        unsaved,
        fingerprint: await bufferFingerprint(doc.toString()),
      };
    };
  }

  setNotes(notes: FileNote[]): void {
    this.notes = notes;
    void this.renderNotes();
  }

  private async renderNotes(): Promise<void> {
    const tab = this.current;
    const notes = this.notes;
    const doc = tab?.state.doc;
    if (
      this.displayedNotes?.tab === tab &&
      this.displayedNotes?.doc === doc &&
      this.displayedNotes?.notes === notes
    )
      return;
    this.displayedNotes = tab && doc ? { tab, doc, notes } : undefined;
    const matching = notes.filter(
      ({ excerpt }) =>
        excerpt.projectId === this.projectId && excerpt.path === tab?.path,
    );
    this.notesHost.replaceChildren();
    if (!tab || !doc || !matching.length) return;
    const fingerprint = await bufferFingerprint(doc.toString());
    if (this.current !== tab || tab.state.doc !== doc || this.notes !== notes)
      return;
    for (const { excerpt, text } of matching) {
      if (
        excerpt.fingerprint !== fingerprint ||
        doc.sliceString(excerpt.start, excerpt.end) !== excerpt.text
      )
        continue;
      const details = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = 'Note on line ' + excerpt.startLine;
      const quote = document.createElement('blockquote');
      quote.textContent = excerpt.text;
      const body = document.createElement('p');
      body.textContent = text;
      details.append(title, quote, body);
      this.notesHost.append(details);
    }
  }

  async canJump(excerpt: FileExcerpt): Promise<boolean> {
    if (this.projectId !== excerpt.projectId) return false;
    const tab = this.groups.get(excerpt.projectId)?.tabs.get(excerpt.path);
    if (tab) {
      const doc = tab.state.doc;
      return (
        (await matchesExcerpt(excerpt, doc.toString())) &&
        tab.state.doc === doc &&
        this.projectId === excerpt.projectId
      );
    }
    try {
      const snapshot = await this.api.readFile(excerpt.projectId, excerpt.path);
      if (this.groups.get(excerpt.projectId)?.tabs.has(excerpt.path))
        return this.canJump(excerpt);
      return (
        (await matchesExcerpt(excerpt, unpackFile(snapshot.text).doc)) &&
        this.projectId === excerpt.projectId
      );
    } catch {
      return false;
    }
  }

  async jump(project: Project, excerpt: FileExcerpt): Promise<boolean> {
    if (project.id !== excerpt.projectId || !(await this.canJump(excerpt)))
      return false;
    await this.open(project, excerpt.path);
    const tab = this.current;
    if (
      this.projectId !== project.id ||
      tab?.path !== excerpt.path ||
      !(await this.canJump(excerpt))
    )
      return false;
    if (this.current !== tab || !tab.view) return false;
    tab.view.dispatch({
      selection: { anchor: excerpt.start, head: excerpt.end },
      scrollIntoView: true,
    });
    tab.view.focus();
    return true;
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
          tab.view?.focus();
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
            this.changed();
            void this.renderNotes();
          }
          if (
            this.current === tab &&
            (update.docChanged || update.selectionSet)
          )
            this.renderStatus();
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
          tab.view?.focus();
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
    if (this.shown !== tab) {
      if (this.shown?.view) this.shown.view.dom.hidden = true;
      this.shown = tab;
    }
    if (tab) {
      const button = this.tabList.querySelector('[aria-selected=true]');
      if (button) this.panel.setAttribute('aria-labelledby', button.id);
      // Keep each tab's DOM input observer attached to its own buffer.
      const view = (tab.view ??= new EditorView({
        parent: this.editorHost,
        state: tab.state,
      }));
      if (view.state !== tab.state) view.setState(tab.state);
      view.dom.hidden = false;
    }
    this.renderStatus();
    void this.renderNotes();
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
      this.changed();
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
    tab.view?.destroy();
    this.changed();
    group.active = [...group.tabs.values()].at(-1);
    this.error.hidden = true;
    this.renderTabs();
    group.active?.view?.focus();
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
            this.changed();
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
