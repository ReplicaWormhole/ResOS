# ResOS

ResOS is a desktop research IDE and Codex notebook in development. The first
milestone opens existing project folders and remembers them between launches.

## Run from source

Use the Node version in `.nvmrc` on a Linux desktop.

```sh
npm ci
npm start
```

Choose **Add Project**, then select a folder. ResOS leaves your files where
they are. The project list is saved under Electron's user-data directory as
`projects.json`. On Linux that directory defaults to `~/.config/ResOS`.
M01 requires no Codex installation or model credentials.

## Package and verify

Build the x86-64 Debian package on Ubuntu. Packaging and desktop checks use
`fakeroot`, `desktop-file-utils`, and `xvfb` where a desktop display is
unavailable.

```sh
npm run check
npm run package:linux
```

Install `release/resos_0.1.0_amd64.deb` through your package manager and
launch **ResOS** from the application menu. To exercise the packaged app in
an isolated profile without installing it system-wide:

```sh
package_root="$(mktemp -d)"
dpkg-deb -x release/resos_0.1.0_amd64.deb "$package_root"
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
- [M01 verification](docs/VERIFICATION.md)
- [Legacy prototype reference](docs/LEGACY.md)
- [Repository working agreements](AGENTS.md)
