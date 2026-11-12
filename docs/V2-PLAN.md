# ResOS v2 plan

This plan extends the [v1 spec](SPEC.md). Open a local folder, start a
chat, and ask about selected text without losing your place. The v2
release adds inspectable context, Codex model controls, and a versioned
desktop installer. Additional coding harnesses are deferred.

## Workspace and selection

- Give the project sidebar independent **Files** and **Chats** disclosures.
  Keep the existing directory tree inside Files. Put **New chat** and project
  chat search alongside Chats. Keep **New chat** outside the collapsible content
  and offer **Create chat** in an empty workspace. Remember each project's
  sidebar state and keep the root chat selected while reading a nested
  discussion. Keep saved chats available when the project folder is missing.
- Add a right-click project menu with **Pin/Unpin** and **Remove project**,
  also available through Shift+F10. Pinning orders projects first; removal
  preserves folders and notebook identity so adding the same folder restores
  saved chats. Confirm removal and reject it while a response is active.
- Give chats the same right-click and keyboard menu pattern, with **Delete
  chat** and an explicit confirmation covering all linked discussions. Reject
  deletion of affected queued/running responses. Keep other chats and files,
  restore a surviving chat or the empty workspace, and persist the deletion.
- Make chat the default center view. Use a readable transcript column,
  scrollable history, a composer anchored at the bottom, and compact message
  actions. Open files in an editor tab with a clear route back to chat.
  Provide an explicit split view for reading and chatting together. Switching
  layouts preserves drafts, scroll, active tabs, and unsaved buffers.
- Provide a light theme with black text on white and a dark theme with light
  text on black and gray. Put a persistent global toggle at the bottom of the
  sidebar and apply the choice to the editor and menus too. Show user
  messages in right-aligned bubbles and assistant replies as plain content.
  Reveal message actions through a small ellipsis menu on hover or focus.
  Enter sends a message and Shift+Enter inserts a new line.
- Show a compact toolbar beside a selection in a file or one saved message.
  Support pointer selection and a keyboard route to the same actions.
  Capture the source before focus moves. Close the toolbar on Escape or when
  its source changes. Keep message edit, history, and run details in a small
  message menu. Selections in rendered math preserve the full original TeX
  expression, including inside side chats.

| Action                  | Chat passage                                                                                            | File selection                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Annotate**            | Save a local note tied to the exact revision and range.                                                 | Save a note with the captured excerpt and its file provenance. Show it at the source only when the buffer still matches.                            |
| **Ask about selection** | Open a linked side chat with pinned ancestry. Further selections inside it can open nested discussions. | Open a separate project chat seeded by the excerpt, initially in the same side panel. Keep the editor visible and the original main chat untouched. |
| **Add to chat**         | Attach the quote and source revision to the focused chat's draft.                                       | Attach the selected buffer text, path, and range to the focused chat's draft, including unsaved edits.                                              |

**Add to chat** shows a removable attachment and waits for Send.
**Annotate** is local and adds no model context on its own. The selection
menu operates on one source at a time. A whole-file question is a separate
file action and explicitly refers to the current on-disk file. Show that
distinction when the editor has unsaved changes.

Use a side panel with a source card, **Back**, and **Expand**. Clicking a
chat highlight opens its discussion. Overlapping highlights let the user
choose among matching discussions. Earlier revisions retain their links.
Keep drafts and reading position at each level. For file-origin chats,
show a file badge in Chats and preserve the captured excerpt even after the
file changes, moves, or disappears. Show file notes in a project-local list
that can also open historical excerpts. Offer source jumps only after a
content and range match. A file path is provenance for these records and
does not serve as the root of a permanent discussion tree.

## Web prototype parity

Compared desktop `9a80135` with the browser code at `dbaeb27` in the
[legacy checkout](LEGACY.md). The browser's separate Telegram app is outside
this comparison.

| Browser behavior                                                                 | Desktop v1 and proposed v2 treatment                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat-first layout, sidebar chat navigation, compact selection action             | Desktop opens a split layout and places its chat list and selection buttons in the chat pane. Restore the chat-first layout and move selection actions beside the selection.                                                                                   |
| Clickable highlights, expandable popup, overlapping-discussion chooser           | Desktop already marks linked passages and supports nested discussions, earlier revisions, and Back. Separate link buttons open discussions in the same pane. Restore click-to-open and the chooser in a side panel.                                            |
| File Read/Edit modes, whole-file questions, file-linked questions and highlights | Desktop has a tabbed editor and immutable selected-text attachments, including unsaved text. Add an explicit whole-file action and excerpt-seeded chat. Keep historical file links and exact-match jumps. Treat a distinct read-only presentation as optional. |
| Agent-side notebook lookup, bounded history, recorded prompt                     | Desktop has user-side project search and a saved structured input record. Restore bounded context and record the submitted payload. Add opt-in, project-scoped lookup where the harness can enforce the scope.                                                 |
| Model-facing revision authorship and notes                                       | The prototype includes authorship and annotations in history snapshots. Desktop stores both locally and sends neither field in its history entries. Preserve authorship in v2 payloads and attach notes explicitly.                                            |
| Drafts survive browser reload within the same browser tab                        | Desktop retains drafts while open. Decide whether to restore them across app restart separately, since unsent content would become stored data.                                                                                                                |
| Browser and tablet access over local Wi-Fi                                       | Deferred. The product stays an installable desktop app.                                                                                                                                                                                                        |

Keep desktop project switching, conflict-aware saves, unsaved excerpts,
chat and message revision IDs, and backup/restore. Importing existing
browser notebooks is a separate migration decision. A PDF shown in the
file tree is not a supported reader input in either baseline. PDF viewing
and full TeX document preview are separate from the initial text workflow.

## Context and coding harnesses

In desktop v1, every response attempt starts a fresh ephemeral Codex thread
in the recorded project folder. ResOS assembles and saves context at queue
time. An ordinary chat includes prior questions in their current revisions,
the latest completed answer per turn when available, and saved file excerpts.
A side chat starts with a pinned snapshot through its source revision and
then includes its own turns. Sibling discussions and later parent edits
do not enter that snapshot. A queued follow-up can include the preceding
question while its answer is still running, but that answer is not added
retroactively. An explicit retry uses the original question,
attachments, and saved context for that attempt. The adapter sends the
history and excerpts as reference JSON alongside the new question.

The v1 app does not automatically send open files, a folder index, unrelated
chats, or notes. Codex can still read files and load instructions through its
own runtime. **Run context** shows the app's saved input, working directory,
and runtime IDs. It does not enumerate subsequent tool reads or everything
the harness adds. Desktop has no app-level history budget or agent-side
notebook lookup. The browser prototype applied a 90,000-character budget to
its node history and exposed a read-only search helper.

ResOS owns history, branches, annotations, and run records. The runtime
interface behind Electron's main process reports models and supported
settings, starts and cancels work, streams output, and translates tool
approval requests. Codex is the live backend for v2 and owns its
authentication.

- Show the selected model and reasoning effort in a compact composer
  button. Clicking it opens **Model**, **Reasoning effort**, and **Mode**.
  Use the installed backend's available models and supported settings. Offer
  a numeric thinking budget only when that model and harness expose one.
  Distinguish reasoning effort from the amount of chat history sent.
  Codex App Server exposes model and effort discovery through `model/list`
  and selection through `turn/start`. [Codex model discovery] ·
  [Codex turn settings]
- Save the requested run settings at acceptance and record effective values
  when the harness reports them. A change applies to future sends. **Retry**
  reuses saved settings and payload where available. If the configuration
  is unavailable, show the error and offer an explicit new run with changed
  settings. Label older records with unknown settings accordingly.
- Provide **Ask** for research and **Agent** for workspace changes. Treat
  Ask as read-only where the adapter can enforce it. Offer text-only Ask
  with explicit attachments where it cannot. Agent mode requires verified
  workspace write confinement, visible approvals, and cancellation. Keep
  requested scope and supported permission behavior visible per harness.
- Budget the context before the run. Always retain the new question,
  explicit attachments, and pinned source excerpts. Fit recent eligible
  history next and record omitted turn or revision IDs. If required input
  alone exceeds the limit, tell the user which input needs reducing before
  sending. Use adapter-specific limits when available and label estimates.
  Show an attachment and history preview, then record the exact
  input the app submitted, with working directory, settings, and runtime
  metadata. Include revision authorship when known. Keep unrelated chats
  and annotations out by default.
- Restore the prototype's on-demand notebook lookup after the context
  budget lands. Gate it on an explicit per-run choice. Scope it to the
  current project and return bounded excerpts with revision IDs. Keep notes
  private unless explicitly attached. Use a brokered read-only interface
  rather than exposing the notebook database or filesystem path to agents.
  Record lookup results separately from the initial payload.
- Ship with Codex and the existing offline demo runtime. Preserve
  experimental Claude run records as history. Before adding another live
  harness, verify its authentication, settings, streaming, cancellation,
  workspace confinement, and approval routing.

## Milestones and acceptance gates

| Milestone                         | Deliverable                                                                                                              | Exit check                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2-01 · Chat-first workspace      | Files and Chats disclosures, central chat, editor tabs and optional split                                                | Switch two projects, collapse both sections independently, open a file, and move among layouts while preserving chat scroll, drafts, and dirty buffers.                                                                                                                                                                      |
| V2-02 · Selection and discussions | Shared selection toolbar, side chat, clickable and overlapping passage links, file questions, annotation and attachments | Select the second of two identical phrases and a rendered formula. Branch twice, reopen via a highlight, and verify the parent's position and draft. Ask about an unsaved file selection, change the file, and verify the old quote remains visible without a stale jump. Annotate without a run and attach without sending. |
| V2-03 · Inspectable context       | Bounded payload, preview, run record, and scoped lookup where supported                                                  | With a long notebook and two projects, retain the pinned source and explicit attachments, report omissions, and isolate sibling and cross-project history. Verify exact submitted payload and explicit retry.                                                                                                                |
| V2-04 · Codex controls            | Capability-driven model and effort picker, Ask and Agent modes                                                           | Use protocol fixtures to test discovered settings, immutable queued settings, missing models, retry, and approvals. Verify one real disposable Codex run with a supported selection.                                                                                                                                         |
| V2-05 · Codex desktop release     | Versioned Ubuntu desktop package and checksum                                                                            | Verify the packaged Codex workflow. Install the package on clean Ubuntu and restore a v1 backup with old IDs, revisions, and links intact. Verify that experimental Claude records remain readable.                                                                                                                          |

Keep one milestone per change. Run source checks and packaged desktop
smoke tests in CI with fixture backends. Run live harness checks with
disposable projects and locally configured accounts. Record verification and
document a new runtime or storage decision when it becomes concrete.

[Codex model discovery]: https://learn.chatgpt.com/docs/app-server#list-models-modellist
[Codex turn settings]: https://learn.chatgpt.com/docs/app-server#turns
