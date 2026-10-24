# Fieldwork Research IDE

A small local research IDE prototype: browse and edit a project, chat with the
installed Codex agent, and open a linked chat from selected answer text. Each
branch is a real Codex app-server thread forked through the selected answer's
turn. The left navigation switches between files and a compact investigation
thread list.

Chat fills the workspace by default. Switch conversations in the left sidebar,
or select **Files & editor** to inspect and edit project files. On a tablet the
editor has a close button that returns to chat. You can keep drafting while the
agent responds, stop a response, and branch using selected text or **Ask about
this** below an answer. Drafts stay separate per chat within the browser tab.

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
with the current thread and retrieves other history on demand. Codex tool requests outside its
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
uses browser-native text editing, simple Markdown display, and no extra runtime
dependencies. It does not yet provide project switching inside one running app,
syntax highlighting, image/file attachments, or an automatic context summary.

On the development computer, `fieldwork-research-ide.service` is a transient
systemd user service so the app survives the chat session. Inspect it with
`systemctl --user status fieldwork-research-ide.service`, or stop it with
`systemctl --user stop fieldwork-research-ide.service`. It does not automatically
start after a reboot. The computer must stay awake for iPad access.
