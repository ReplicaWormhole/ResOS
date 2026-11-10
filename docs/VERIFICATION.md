# Desktop verification

## M01 · DESK-01 and PROJ-01

Tested locally on x86-64 Ubuntu 26.04 with Node 24.14.0 and Electron 45.2.3.

- `npm ci --offline --no-audit` installed from the lockfile using the local
  dependency cache. `npm run check` passed formatting, linting, strict
  typechecking, build, and all three registry tests.
- `npm run package:linux` produced `release/resos_0.1.0_amd64.deb`.
  `desktop-file-validate` passed on the extracted desktop entry.
- `xvfb-run -a npm run test:desktop` passed with `RESOS_EXECUTABLE` pointing to
  the extracted package. It checked the sandboxed window, cancellation, two
  projects, alias deduplication, and stable IDs after restart.
- A separate check drove the real GTK dialog in the packaged app under Xvfb.
  Cancelling left the project list empty. Selecting two directories added
  them, and both appeared after restarting in the same isolated profile.
- `gio launch` opened the executable from a staged copy of the desktop entry
  under Xvfb. The X11 window class matched the packaged entry. The check used
  an isolated profile and did not install the package on the development host.
- `actionlint` 1.7.10 passed. The hosted workflow is configured to install the
  Debian package and smoke-test it on Ubuntu 24.04. Its first hosted run is
  pending.
- `npm audit --omit=dev` reported zero advisories. The full build-tool audit
  reports one underlying moderate
  [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  propagated across development packages. These tools are absent from the
  packaged application.

Build output and installed dependencies are ignored by Git. The Debian
package is the retained local artifact.
