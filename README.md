# ResOS

ResOS is a desktop research IDE and Codex notebook in development. Open an
existing folder as a project, edit its files in tabs, and keep a separate chat
history for each project.

## Run from source

Use the Node version in `.nvmrc` on a Linux desktop.

```sh
npm ci
npm start
```

Choose **Add Project**, then select a folder. ResOS leaves your files where
they are. The project list is saved under Electron's user-data directory as
`projects.json`. On Linux that directory defaults to `~/.config/ResOS`.
The editor and saved notebook are available without a live Codex connection.

## Workspace layout

Chat opens in the main workspace by default. The left sidebar has separate
**Files** and **Chats** sections that you can collapse independently. Their
open state is saved for each project. Start or switch chats and search the
project's saved conversations under **Chats**.

Opening a file from Chat view shows the editor. Use **Chat**, **Editor**, or
**Split view** above the workspace to choose what is visible. Changing views
keeps open tabs, edits, chat drafts, and reading position.

## Workspace editor

Open a file from the project tree. The editor highlights TeX, Markdown, and
Python, with plain text for other supported files. Use **Ctrl+S** to save and
**Ctrl+F** to find text. Use the Left and Right arrow keys in the tab list to
switch files. Tabs and unsaved drafts stay with their project while the app
is open. Closing a dirty tab asks before discarding its draft.

Open files are checked for external edits. A clean tab reloads automatically.
A dirty tab keeps its draft and reports a conflict if you try to save against
an outdated disk version. **Reload file** lets you discard the draft explicitly.
The editor supports regular UTF-8 text files up to 4 MiB and omits symbolic
links and .git metadata from the file tree.

To run a development build alongside your installed app with a separate
project list, use:

```sh
XDG_CONFIG_HOME="$HOME/.config/resos-dev" npm start
```

## Project chat

Install the Codex CLI and sign in with `codex login`. ResOS looks for Codex on
`PATH`, in `~/.local/bin`, and in local nvm installations. Set
`RESOS_CODEX_BIN` to an executable path to override discovery.

Choose **New chat** and send a message. ResOS starts a fresh Codex thread per
attempt and streams the reply. The prompt and saved context go to the model
service configured in your Codex installation. Requests to escalate command,
file, or permission scope appear in the originating project for your decision.

Use **Stop response** to cancel a queued or running attempt and **Retry
response** to run the same question again. **Run context** shows the saved
input, working directory, and execution record. **Search project chats**
finds text in the current project's saved conversations. Drafts stay separate
while the app is open, and saved questions and replies survive a restart.

Use `RESOS_RUNTIME=demo npm start` for a local demo without model calls. An
opt-in live check is `npm run build && xvfb-run -a node scripts/desktop-codex-smoke.mjs`.
The check uses a disposable workspace and user-data directory.

If a project folder moves, open that project and choose **Locate folder**.
Its conversation history stays accessible while the folder is missing.
Choose the new location to re-enable the editor and sending. The notebook
is saved beside the registry in the app data directory as `notebook.json`.

## Questions and annotations

Select text in a saved chat message or the editor to show the selection
toolbar. Use **Alt+Shift+A** to focus the actions from the keyboard and
**Escape** to dismiss them.

- **Annotate** saves a local note for the selected passage. Open file notes
  under **Chats** to revisit the original text after a file changes.
- **Ask about selection** opens a side chat. A chat passage pins its exact
  revision and can have nested discussions. Click a highlighted passage to
  reopen one, or choose among its linked discussions. Use **Expand** for more
  room and **Back to parent** to return to the draft and reading position you
  left. A file selection creates a file chat with its own entry in **Chats**.
- **Add to chat** adds a removable quote to the current draft. The quote is
  sent when you send the message. Unsaved editor text is labeled as such.

A file chat or note retains the captured excerpt even if the file moves or
changes. **Jump to file excerpt** appears only when the current buffer or
file matches. **Ask about saved file** starts a separate chat that refers
to the current file on disk, with confirmation if the editor has unsaved
changes.

Select any part of a rendered formula to capture the full TeX expression.
Open **Message actions** to edit a message, add a general note, inspect
revision history, or view a response's run context. Editing preserves
existing replies and their source links.

## Package and verify

On Ubuntu x86-64, use the Node version in `.nvmrc` and install the
packaging and display tools listed in the [release guide](docs/RELEASE.md).

```sh
npm ci
npm run release:linux
```

The command checks the source, builds the Debian package, and writes a
SHA-256 checksum in `release/`. See the [release guide](docs/RELEASE.md)
for installation, verification, troubleshooting, and backup and restore.

## Project documentation

- [Spec and acceptance checks](docs/SPEC.md)
- [Milestones, CI, and release gates](docs/ROADMAP.md)
- [Desktop foundation decision](docs/decisions/0001-desktop-foundation.md)
- [Notebook storage and prototype import](docs/decisions/0002-notebook-storage.md)
- [Milestone verification](docs/VERIFICATION.md)
- [Legacy prototype reference](docs/LEGACY.md)
- [Repository working agreements](AGENTS.md)
