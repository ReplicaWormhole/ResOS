# ResOS

ResOS is a desktop research IDE and Codex notebook in development. Open an
existing folder as a project, browse its files, and edit them in tabs.

## Run from source

Use the Node version in `.nvmrc` on a Linux desktop.

```sh
npm ci
npm start
```

Choose **Add Project**, then select a folder. ResOS leaves your files where
they are. The project list is saved under Electron's user-data directory as
`projects.json`. On Linux that directory defaults to `~/.config/ResOS`.
This build requires no Codex installation or model credentials. The chat pane
is reserved for M03.

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

## Package and verify

Build the x86-64 Debian package on Ubuntu. Packaging and desktop checks use
`fakeroot`, `desktop-file-utils`, and `xvfb` where a desktop display is
unavailable.

```sh
npm run check
npm run package:linux
```

Install `release/resos_0.2.0_amd64.deb` through your package manager and
launch **ResOS** from the application menu. To exercise the packaged app in
an isolated profile without installing it system-wide:

```sh
package_root="$(mktemp -d)"
dpkg-deb -x release/resos_0.2.0_amd64.deb "$package_root"
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
- [Milestone verification](docs/VERIFICATION.md)
- [Legacy prototype reference](docs/LEGACY.md)
- [Repository working agreements](AGENTS.md)
