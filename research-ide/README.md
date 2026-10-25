# Fieldwork Research IDE

A local research notebook: browse files, converse with Codex, revise messages,
add notes, and open discussions from saved passages. The conversation is
persistent state; each response job uses a fresh runtime thread and recorded
context. Chats never resume old agent sessions. The left navigation switches
between files and main conversations. Follow-up
chats stay attached to their source passages and files, and do not appear in the
conversation list. While reading a follow-up, its main conversation stays selected
in the sidebar. File discussions are opened from the file’s highlights or question
list.

Chat fills the workspace by default. Switch conversations in the left sidebar,
or select **Files & editor** to inspect and edit project files. On a tablet the
editor has a close button that returns to chat. You can keep drafting while the
agent responds, stop a response, and branch using selected text or **Ask about
this** below an answer. Drafts stay separate per chat within the browser tab.

Passages with linked follow-up chats are highlighted in the original answer.
Click or tap a highlight to read and continue the follow-up in a popup. Its
composer supports Send, Stop, streamed replies, and permission requests. Choose
**Expand chat** when you want more room; the draft follows you between views. Close the popup with ×, Escape, or a tap outside it to
keep reading the original. Overlapping follow-ups offer a chat selector. Existing
saved quotes receive highlights too; older quotes without an exact match appear
as a follow-up button under the answer. New selections record their position so
repeated phrases can be distinguished. Older selections only stored the quote,
so a repeated phrase in an older answer is matched to its first occurrence.

Files open in a reading view. Select a passage and choose **Ask about selection**,
or use **Ask about file** for a question about the whole file. A separate chat
keeps the source path, line number, and selected quote visible. **Open file**
returns to the source. Selected passages with questions are highlighted; tapping
them opens the same conversation popup used for chat answers. Questions about
the whole file and passages that have changed remain in the list below the file.
Use **Edit** to change the file and **Read** to return to its marked reading view.
Save edits before asking about them. The agent receives the saved quote and path
and can read the file for more context. This supports the UTF-8 text files already
available in the browser; PDF/image document viewing is not included.

## Run

Requires Node.js and the Codex CLI installed and signed in on this computer.
From this directory:

```sh
node server.mjs --workspace /absolute/path/to/project
```

Then open <http://127.0.0.1:8788/>. Choose another local port with `--port`, or
set `CODEX_BIN` if the CLI is not named `codex` on `PATH`. Stop with Ctrl+C.
By default the server binds only to loopback. The selected directory is the Codex working
directory and workspace-write sandbox root. When needed, the agent can search
saved chats with the read-only helper at `scripts/read_context.mjs`; it starts
with the saved node path and retrieves other history on demand. Codex tool requests outside its
sandbox can ask for approval in the chat pane.

Local Wi-Fi access can be enabled explicitly with `--host <this-computer-LAN-IP>`.
This prints a private access link with a per-run key, required for all workspace
and chat APIs. Open that complete link on the other device. This mode is plain
HTTP for a trusted local Wi-Fi network; it is not an Internet hosting setup.
UI message IDs work on this HTTP origin without secure-context-only APIs.

Chats, selected passages, and the local tree are stored in `.local/state.json`
with owner-only file permissions. They are not committed. Conversations are
sent to the configured Codex model service as part of ordinary Codex use.

## Scope

See [MVP.md](MVP.md) for the interaction and acceptance criteria. The prototype
uses browser-native text editing, supported Markdown and bundled KaTeX maths.
No npm installation or external rendering service is needed. It does not yet provide project switching inside one running app,
syntax highlighting, image/file attachments, or an automatic context summary.

## How the browser code works

Both user questions and agent answers render inline maths with $...$ or
\(...\), and display maths with $$...$$ or \[...\]. Common equation and align
environments work too. Notes and source quotes use the same renderer; editor
text and revision history retain editable TeX source. Code stays literal.
Incomplete expressions remain readable until the closing delimiter arrives;
invalid or unsupported commands remain visible rather than breaking the chat.
This is math typesetting, not a full LaTeX document/package compiler.

KaTeX 0.19.1, its stylesheet and fonts are served from this computer, with no CDN
request. Formulas are atomic source units for passage selection: selecting part
of a rendered formula attaches its full original TeX to the discussion. Message
source and saved revisions are unchanged by rendering.

Messages now have stable node IDs, parent edges, immutable text revisions and
revision authorship. **Edit** creates a human revision, **Add note** keeps your
thoughts separately, and **History** shows all versions. Editing never regenerates
descendants automatically. Earlier discussions retain their source revision and
remain accessible through an **earlier revision** link.

Select a passage inside a popup to open another discussion. **Back** returns one
level, preserving drafts and reading position. **Run context** shows the exact
saved input and execution record. **Retry response** creates a fresh job for a
failed/stopped response without duplicating its question.

See [ARCHITECTURE.md](ARCHITECTURE.md) for migration and recovery contracts.
Version-1 state is backed up before migration. Jobs run serially within the
notebook and interrupted jobs are never automatically replayed after restart.
Other agent applications are not stopped.

`public/index.html` defines the panels and controls, `public/app.css` styles them,
and the browser loads `public/app.js` as a native JavaScript module. No bundler
or frontend framework is required. The server serves the imported modules too.

| File | Responsibility |
| --- | --- |
| `public/app.js` | UI controller: active chat, open file, editor state, drafts, navigation, rendering, and action handlers. |
| `public/browser-session.js` | Safe session storage and authenticated JSON requests to the server. |
| `public/markdown.js` | Escapes HTML, then renders the supported subset of Markdown. |
| `public/passages.js` | Maps text selections to offsets and highlights passages with linked chats. Receives a callback to open those chats. |
| `public/branch-popup.js` | Owns the linked-chat dialog, composer/drafts, chat choices, and reading position. |
| `public/conversation-events.js` | Applies streamed message events to conversation data, without touching the DOM or making requests. |
| `public/message-view.js` | Shared message actions, notes and source markers in both views. |
| `notebook-state.mjs` | Migration, revision history, message ancestry and pinned context. |
| `job-runner.mjs` | Fresh response jobs, serialization, stop, retry and crash recovery. |
| `server.mjs` | Workspace file access, saved conversations, Codex app-server integration, and the browser event stream. |

The main flows are:

1. **Startup:** `initialize()` registers handlers once. `boot()` fetches
   `/api/state`, loads the file tree, restores the selected chat and its draft,
   and connects an `EventSource` to `/api/events`. Reconnecting replaces the
   stream without registering the UI handlers again.
2. **Sending:** `sendMessage()` immediately adds a local user message and an
   assistant placeholder, then posts to `/api/chat/send`. The agent runs on the
   server. `handleEvent()` receives progress; `applyConversationEvent()` assigns
   server message IDs, appends text chunks, and marks completion. `renderChat()`
   updates changed message elements while preserving reading position. A state
   refresh reconciles the local view with the server; pending sends retain their
   optimistic messages until the send request settles.
3. **Files:** `openFile()` fetches saved text, ignores superseded loads, and
   protects edits typed while loading. Read mode shows linked passages; Edit mode
   uses the textarea. `saveFile()` sends its contents to `/api/file`, retaining
   the original newline convention.
4. **Questions about passages:** `showSelectionAction()` records the selected
   text and its position. `branchFromSelection()` pins a saved source node and
   revision; `askAboutFile()` creates a chat tied to a file or file selection.
   `markLinkedPassages()` marks matching text. Activating a mark opens the popup;
   its composer sends to that linked conversation, while **Expand chat** selects
   the conversation in the main panel.

The server owns saved conversation and file data. The browser owns transient
state such as open panels, selections and scroll positions. Drafts and the
active chat ID live in session storage, separate for each browser tab. Passage
offsets count rendered text, including line breaks, rather than HTML or raw
Markdown; this is what lets selections cross formatting boundaries.

Run the dependency-free checks from the repository root:

```sh
node --test research-ide/tests/*.test.mjs
node --check research-ide/public/app.js
```

The tests include model/rendering checks and an isolated HTTP server with a mock
runtime, without model calls or writes to your notebook. They cover passage
matching, overlap and activation, file context, API errors and authentication,
storage failure, HTML escaping, and streamed message reconciliation. The
passage tests use a small DOM harness; browser checks are recorded separately
in [VERIFICATION.md](VERIFICATION.md).

An optional browser regression script serves an isolated in-memory API fixture
and the actual client assets. It does not start Codex or change saved workspace
data. Supply an existing Playwright installation and, optionally, a Chromium
executable:

```sh
node research-ide/tests/browser-smoke.mjs /absolute/path/to/playwright/index.mjs /absolute/path/to/chromium
```

On the development computer, `fieldwork-research-ide.service` is a transient
systemd user service so the app survives the chat session. Inspect it with
`systemctl --user status fieldwork-research-ide.service`, or stop it with
`systemctl --user stop fieldwork-research-ide.service`. It does not automatically
start after a reboot. The computer must stay awake for iPad access.
