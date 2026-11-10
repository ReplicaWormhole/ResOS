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

## Discussions and revisions

Select a passage in a saved message and choose **Ask about selection**. The
discussion keeps the original source range and revision. Select any part of
rendered math to quote the complete TeX expression. Use **Back to parent** to
return to the draft and reading position you left. Main conversations remain
in the dropdown, and follow-ups open from their source messages.

**Edit message** creates a revision and leaves existing replies and links
intact. **Add note** records a separate note on that revision. **Revision
history** shows the original Markdown and TeX. Unsupported math stays readable
as source.

## Questions about file selections

Select text in the editor and choose **Ask about file selection**. The chat
composer shows the excerpt, its original line range, and whether it came
from an unsaved buffer. Send your question in that chat, or create a new
ordinary chat before attaching the selection.

The excerpt stays with the message and supplies context to later turns even
if the source file moves or changes. **Jump to file excerpt** appears when
the current buffer or file still matches the captured content and range.
Use **Remove excerpt** to detach a draft before sending.

## Package and verify

Build the x86-64 Debian package on Ubuntu. Packaging and desktop checks use
`fakeroot`, `desktop-file-utils`, and `xvfb` where a desktop display is
unavailable.

```sh
npm run check
npm run package:linux
```

Install `release/resos_0.6.0_amd64.deb` through your package manager and
launch **ResOS** from the application menu. To exercise the packaged app in
an isolated profile without installing it system-wide:

```sh
package_root="$(mktemp -d)"
dpkg-deb -x release/resos_0.6.0_amd64.deb "$package_root"
desktop-file-validate "$package_root/usr/share/applications/resos.desktop"
RESOS_EXECUTABLE="$package_root/opt/ResOS/resos" xvfb-run -a npm run test:desktop
```

The desktop test uses real Electron windows, IPC, and storage. It substitutes
the folder picker's result so it can run unattended. To check the native
dialog, launch the packaged app, cancel one folder selection, then add two
folders and verify they both reappear after quitting and relaunching.

## Project documentation

- [Spec and acceptance checks](docs/SPEC.md)
- [Milestones, CI, and release gates](docs/ROADMAP.md)
- [Desktop foundation decision](docs/decisions/0001-desktop-foundation.md)
- [Notebook storage and prototype import](docs/decisions/0002-notebook-storage.md)
- [Milestone verification](docs/VERIFICATION.md)
- [Legacy prototype reference](docs/LEGACY.md)
- [Repository working agreements](AGENTS.md)
