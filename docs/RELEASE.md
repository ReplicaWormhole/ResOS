# ResOS desktop release guide

The supported package is an Ubuntu 24.04 or later x86-64 Debian package.
Codex is the live harness. Install its CLI separately and sign in as your
desktop user.

## Verify and install

Verify and install from the directory containing the package and its checksum.

```sh
sha256sum -c resos_2.0.4_amd64.deb.sha256
sudo apt install ./resos_2.0.4_amd64.deb
```

Quit an older ResOS session before upgrading. The same install command
upgrades earlier desktop milestones and uses their existing profile. Launch
**ResOS** from the application menu. Add a project folder or reopen one
from the sidebar.

Run `codex --version` and `codex login status` in a terminal to check your
installation. Run `codex login` if needed. ResOS also looks in local nvm
installations. If the app reports that it cannot start Codex, set the absolute
path explicitly when launching from a terminal.

```sh
RESOS_CODEX_BIN="$(command -v codex)" /opt/ResOS/resos
```

A folder that has moved can be reconnected with **Locate folder**. Its
existing notebook is keyed by project ID and stays visible while the folder
is unavailable. Check the error shown by a failed attempt and use
**Run context** to see its saved working directory and input. Codex sends
questions and selected context to the model service configured in the CLI.

## Back up and restore notebook data

Quit ResOS before copying. The app keeps project IDs and locations in
`projects.json` and conversation data in `notebook.json` under
`${XDG_CONFIG_HOME:-$HOME/.config}/ResOS`. The notebook includes messages,
revisions, file and message notes, discussions, excerpts, and recorded runs. Keep the backup
private because these files can contain sensitive text. Project files,
Codex credentials, and in-session drafts are separate.

```sh
umask 077
data_dir="${XDG_CONFIG_HOME:-$HOME/.config}/ResOS"
backup_dir="$(mktemp -d "$HOME/ResOS-backup.XXXXXX")"
for file in projects.json notebook.json; do
  if test -f "$data_dir/$file"; then
    install -m 600 "$data_dir/$file" "$backup_dir/$file"
  fi
done
printf 'Backup saved in %s\n' "$backup_dir"
```

First restore to a fresh profile. Set `backup_dir` to the backup you want
to restore. Reopen projects and verify the chats before using the restored
profile for new work.

```sh
umask 077
restore_config="$(mktemp -d "$HOME/ResOS-restore.XXXXXX")"
install -d -m 700 "$restore_config/ResOS"
for file in projects.json notebook.json; do
  if test -f "$backup_dir/$file"; then
    install -m 600 "$backup_dir/$file" "$restore_config/ResOS/$file"
  fi
done
XDG_CONFIG_HOME="$restore_config" /opt/ResOS/resos
```

To use the restored profile as the default, quit ResOS, move the current
`ResOS` configuration directory aside, then move the verified `ResOS`
directory from the restore profile into its place. Keep the original
directory until you have checked the restored data. The desktop release uses
its own notebook format, with [prototype import deferred](decisions/0002-notebook-storage.md).

When a v1 notebook is opened in a newer build that supports annotations,
its IDs and source links are preserved. The next saved change upgrades the
notebook format. Keep a v1 backup if you need to reopen that data in v1.
Experimental Claude run records remain readable. To retry a failed one
with Codex, choose **Run with current settings**.

## Build and test the release

Use a clean checkout, Node from `.nvmrc`, and the Ubuntu packages
`binutils`, `fakeroot`, `desktop-file-utils`, `xvfb`, `xauth`, and `xz-utils`.

```sh
npm ci
npm run release:linux
(cd release && sha256sum -c resos_2.0.4_amd64.deb.sha256)
sudo apt install ./release/resos_2.0.4_amd64.deb
RESOS_EXECUTABLE=/opt/ResOS/resos xvfb-run -a npm run test:desktop
```

The automated suite uses the demo runtime or protocol fixtures and supplies
the folder picker's result. To check the native dialog, launch ResOS from the
application menu, cancel a folder selection, then add two folders and verify
that both reappear after relaunching.

For a live check with a signed-in CLI and a disposable project and profile,
run the desktop Codex smoke test.

```sh
RESOS_EXECUTABLE=/opt/ResOS/resos xvfb-run -a node scripts/desktop-codex-smoke.mjs
```

The [Build desktop release](../.github/workflows/desktop-release.yml) workflow
accepts a version on the dispatch revision or an exact `v`-prefixed tag.
It checks the version, builds the package, installs it on Ubuntu 24.04,
runs the desktop suite, and uploads the package and checksum as workflow
artifacts. GitHub requires the workflow file to be present on the default
branch before manual dispatch. This repository currently defaults to the
legacy `master` branch. The desktop workflow is available locally and can
be activated when the desktop branch is promoted. Publishing a GitHub
Release is a separate action. [GitHub manual dispatch documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
