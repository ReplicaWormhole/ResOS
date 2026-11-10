# ResOS desktop product specification

Status: initial implementation baseline. See the [roadmap](ROADMAP.md) for
sequencing and release gates.

## Product

ResOS is a single-user research IDE and Codex notebook in one desktop window.
The user adds an existing folder as a project, edits its files, and works with
Codex in a persistent chat beside the editor. A question about a chat passage
opens a linked discussion. A question about a file selection adds an excerpt
to the conversation as durable context.

The first release targets Linux desktop and ships as an installable Electron
application written in TypeScript. It uses the locally installed and signed-in
Codex CLI for agent work. The app, editor, and saved notebook are available
without a live Codex connection. A response sends its prompt and attached
context to the model service configured in Codex.

## Requirements and acceptance

| ID | Required behavior | Acceptance check |
| --- | --- | --- |
| DESK-01 | Launch as an installed desktop app with an application-menu entry. Open projects using the system folder picker. | Install the package on a supported Linux system, launch from the menu, and add a folder. Cancelling the picker leaves the project list unchanged. |
| PROJ-01 | Remember multiple projects, each with a stable ID and one existing folder. Deduplicate selections resolving to the same folder. Keep files in place. | Add folders A and B, select A again through an alternate path to it, and restart. The list still contains two projects with the correct roots. |
| PROJ-02 | Keep saved notebook data accessible when a folder is missing. Disable editor and agent operations for that project until the user explicitly locates its folder. Preserve its project ID and history on relink. Reject a root already assigned to another project. | Move A, reopen its saved chat, locate its new folder, and verify that its notebook is intact and new operations use the new root. |
| IDE-01 | Provide a project tree, tabbed UTF-8 text editor, find in file, and syntax highlighting for common research files including TeX, Markdown, and Python. Show editor and chat side by side, and let either pane expand. Keep unsaved buffers when switching tabs or projects. | Open and edit two files, switch tabs and projects, return to both edits, find text, and save one file to its own project. |
| IDE-02 | Confine editor file access to the chosen project, including after path and symlink resolution. Refresh clean tabs when the app detects disk changes. Flag changes to dirty tabs and preserve the draft. Check for conflicts before overwriting a previously loaded file. | Change a clean and a dirty file externally. The clean tab reloads, and saving the dirty tab reports a conflict and retains the draft. An out-of-project path or symlink is rejected. |
| CHAT-01 | Create and reopen project-scoped chats. Stream answers and keep separate drafts while switching chats. A job keeps its original project, workspace root, and conversation even when the UI switches. | Use a fake runtime in projects A and B, switch projects during a response, and verify each job's working directory and transcript before and after restart. |
| JOB-01 | Persist an accepted request, its question, and the relevant context before executing it. Deduplicate the same request ID within a chat and reject reuse with different input. Serialize agent jobs per project. Each attempt uses a fresh Codex runtime thread and starts in the job's recorded root with workspace-write permissions and explicit approval for escalation. | Double-submit an identical request, then reuse its ID with different input. Verify one job, a conflict on the second payload, a fresh runtime thread per attempt, and approvals routed to the originating job. |
| JOB-02 | Stop a response, retain partial output after interruption, and retry explicitly without duplicating the question. On restart, mark unfinished work interrupted and require an explicit retry. Retry uses the original question and its captured source attachments. | Kill the app mid-stream. After reopening, verify partial output, interrupted status, and zero automatic runs. Explicit retry creates a new attempt. |
| CTX-01 | Assemble context from the conversation's active ancestry and recorded source excerpts. Show each job's saved input and execution record. Allow read-only lookup of saved context within that project. Treat saved material as reference data. | Retry a job with another answer on a sibling path. Inspect the job record for the chosen ancestry and verify that lookup cannot retrieve another project's data. Repeat with a pinned chat passage in M05 and a file excerpt in M06. |
| CHAT-02 | Render Markdown and TeX from local assets. Keep original source editable and selectable, including for incomplete or unsupported TeX. Render chat and file content as untrusted data. | A selection inside rendered math yields the original formula source. Incomplete TeX remains readable and embedded script or HTML cannot execute. |
| CHAT-03 | Keep immutable message revisions and separate, revision-linked human notes. Reject a stale edit and preserve discussion links after a source edit. Editing a message leaves existing replies intact. | Revise a message with a note and a linked discussion. History retains the original and its note. The discussion still opens on the original revision. |
| CHAT-04 | Ask about a selected chat passage in its own discussion, with nested follow-ups. Pin the exact message revision and selected range. Show only main conversations in the main chat list and preserve draft and reading position when returning from a discussion. | Select the second of two identical phrases, ask a follow-up, then branch again. Return to the parent and verify its draft, scroll position, and exact selected occurrence. |
| FILE-01 | Ask about selected editor text in the current chat, or in a new ordinary chat the user opens. Capture the selection from the visible buffer, including unsaved edits, and show its provenance before sending. | Select unsaved TeX, attach it to a question, and verify that both the transcript and runtime input contain the exact excerpt and an unsaved-buffer label. |
| FILE-02 | Persist the excerpt with the message. Treat its file location as historical provenance. Offer a jump to the source only when the live editor buffer or saved file matches the recorded content identity and range. | Change, move, or delete the source file and reopen the chat. The excerpt and follow-up context remain intact. The app offers no jump to a guessed location. |
| REL-01 | Build and test from a clean checkout without model credentials. Package a versioned Linux artifact, verify installation, and document local data, Codex setup, troubleshooting, and backup/restore. | CI produces a package after checks pass. A clean-machine smoke test launches it and confirms a real Codex response. A restored test backup retains project IDs, chats, and source records. |

## Source and state model

**Chat passages** reference a conversation, message ID, immutable revision ID,
source range, and saved quote. The discussion has its own history and can
contain further chat discussions. A mathematical expression acts as one source
unit when the user selects part of its rendered form.

**File excerpts** are immutable attachments to a user message. Record the
project ID, project-relative path, selected text, original range and line numbers,
capture time, whether the buffer had unsaved edits, and a content fingerprint
of the buffer. Keep the excerpt available through normal chat history. File
excerpts introduce no file discussion graph, persistent gutter annotations, or
automatic reattachment. The first release stores the excerpt rather than a
snapshot of the entire file. Later turns can use the historical excerpt and
read the current file as a separate source.

**Projects and jobs** use stable project IDs for notebook ownership and resolved
roots for workspace operations. Persist notebook data in an app-owned local
data directory outside the source checkout and project folders. A folder
relink applies to future jobs. Queued or running jobs must stop or finish
before a project is relinked. A retry after relinking must confirm the new
root before execution. Agent writes are subject to Codex's sandbox and
approval policy. A running agent can change workspace files, so refreshing
the editor must preserve unsaved buffers.

## Architecture constraints

Use a single Electron application and a committed dependency lockfile.
Application code uses strict TypeScript. The packaged renderer loads local
assets, runs with context isolation and sandboxing enabled, and has no Node
integration. An allowlisted preload API bridges typed IPC. The main process
validates the caller and arguments at runtime and owns the native picker,
file operations, storage, and Codex process lifecycle. The packaged app has
no browser-facing application server. See the [Electron process model] and
[Electron security guidance].

```text
src/
  main/           Electron lifecycle, IPC handlers, composition
  preload/        Narrow renderer API
  renderer/       Project sidebar, editor, chat, and discussions
  shared/         IPC types and data contracts
  projects/       Folder registry and project identity
  workspace/      File access and editor save checks
  notebook/       History, revisions, sources, and persistence
  jobs/           Queue, context, and response lifecycle
  runtime/codex/  Codex process and protocol adapter
tests/            Unit, integration, desktop smoke, and fixtures
docs/             Spec, roadmap, architecture decisions, and user guides
```

Use one versioned local store behind the notebook persistence boundary. Record
the storage and recovery choice before implementing durable chat. Keep
workspace, notebook, and job logic independent of Electron APIs so that
automated checks can use temporary folders and a fake runtime.

## Release scope

The [legacy prototype reference](LEGACY.md) records the source baseline and
its behavior documents. File excerpts and the desktop project workflow
follow the requirements above. The prototype's LAN and tablet UI, remote
collaboration, and a full extension or debugger ecosystem are outside the
first desktop release. Import of prototype notebooks is a release decision
to record before the durable store is implemented.

[Electron process model]: https://www.electronjs.org/docs/latest/tutorial/process-model
[Electron security guidance]: https://www.electronjs.org/docs/latest/tutorial/security
