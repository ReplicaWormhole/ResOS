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

## M02 · IDE-01 and IDE-02

Tested locally on x86-64 Ubuntu 26.04 with Node 24.14.0 and Electron 45.2.3.

- `npm run check` passed formatting, linting, strict typechecking, the renderer
  bundle, and all eight unit tests. Tests cover workspace confinement, stale
  saves, invalid or oversized text, ordinary file modes, and preservation of
  the UTF-8 BOM and mixed line endings.
- `xvfb-run -a npm run test:desktop` passed both desktop tests. The editor
  test covers nested file navigation, keyboard tab switching, a selected
  search match, TeX/Markdown/Python highlighting, unsaved buffers across
  projects, keyboard saves, clean refresh, dirty conflicts, explicit reload,
  and both pane layouts.
- `npm run package:linux` produced `resos_0.2.0_amd64.deb`.
  `desktop-file-validate` and both desktop tests passed on the extracted
  package. The restart test created projects with the M01 package and
  opened that profile in M02, retaining both stable IDs.
  [Hosted M02 CI](https://github.com/ReplicaWormhole/ResOS/actions/runs/42827344107)
  also installed the package and passed the desktop tests on Ubuntu 24.04.
- `npm audit --omit=dev` reported zero production dependency advisories.
  CodeMirror is bundled into the renderer, with dependency licenses present
  in the application archive. esbuild is used for the renderer build.

File saves use a content revision check immediately before an atomic rename.
There is a small race if an unrelated writer changes the file between the
final check and the rename. Tabs and drafts live in memory while the
application is open.

## M03 · PROJ-02 and CHAT-01

Tested locally on x86-64 Ubuntu 26.04 with Node 24.14.0 and Electron 45.2.3.

- `npm run check` passed formatting, linting, typechecking, build, and all
  eleven unit tests. The notebook tests cover partial writes, project/chat/cwd
  isolation, startup recovery, and rejection of an unsupported snapshot.
- `xvfb-run -a npm run test:desktop` passed all three tests. The chat test
  switches projects during a response, exercises separate chat drafts,
  verifies chat and file behavior while a folder is missing, rejects relinking
  to a second project's root, and reopens the original history after relink
  and restart. The saved attempt working directories match the roots at send.
- `npm run package:linux` produced `resos_0.3.0_amd64.deb`.
  `desktop-file-validate` and all three desktop tests passed on the extracted
  package. The first desktop test opened a profile created by M02 in M03.
  See the [storage decision](decisions/0002-notebook-storage.md) for
  persistence and prototype import scope.

Notebook storage rewrites a local JSON snapshot for each streamed chunk.
Chat drafts live in memory while the application is open.

## M04 · JOB-01, JOB-02, and CTX-01

- `npm run check` passed all 14 unit tests. Fixtures verify fresh stdio
  initialization, explicit sandbox settings, a file-change approval and
  foreign notification filtering. Notebook tests cover FIFO queueing across
  conversations, deduplication, cross-project approval isolation, stop,
  restart recovery, and retry with saved context and relink confirmation.
- `npm run package:linux` built `resos_0.4.0_amd64.deb`. The desktop file
  passed validation and all three deterministic desktop tests passed against
  the extracted package.
- `node scripts/codex-smoke.mjs` and the packaged
  `xvfb-run -a node scripts/desktop-codex-smoke.mjs` returned the expected
  markers using signed-in Codex CLI 0.167.0. The desktop check also verified
  that the saved working directory, thread ID, and turn ID match the run.
  Real-model checks used disposable fixtures. The live checks did not
  request any tool approvals.

Protocol fields were checked against the installed CLI's generated bindings
and the [official app-server documentation](https://learn.chatgpt.com/docs/app-server).
The desktop client handles concrete command, file-change, and permission
approval requests. Other interactive app-server requests receive an
unsupported-method error.

## M05 · CHAT-02, CHAT-03, and CHAT-04

- `npm run check` passed all 15 unit tests. Notebook tests verify that edits
  preserve the original run and revision-linked notes, stale edits fail, and
  discussions use their pinned ancestry even after the parent is revised.
- `npm run package:linux` built `resos_0.5.0_amd64.deb`. The desktop file
  passed validation and all four desktop tests passed on the extracted
  package. The new test covers literal HTML, incomplete TeX, selection of the
  second repeated phrase, selection inside rendered MathML, nested navigation,
  draft and scroll restoration, revision history, and earlier-revision links.
- `npm audit --omit=dev` reported zero production advisories. Markdown
  is rendered from parsed nodes, and KaTeX uses native MathML with trust
  disabled and bounded macro expansion. A Markdown text run that cannot be
  aligned to source offsets after parsing is treated as one source unit.

## M06 · FILE-01 and FILE-02

- `npm run check` passed all 16 unit tests. The new tests verify project
  boundaries, exact buffer identity and range, immutable attachments,
  idempotent sends, retry, and use in later context. The stdio fixture
  also verifies that the Codex turn includes the captured excerpt and
  unsaved-buffer flag as reference data.
- `npm run package:linux` built `resos_0.6.0_amd64.deb`. The desktop file
  passed validation and all five desktop tests passed on the extracted
  package. The excerpt check captured unsaved TeX, jumped to the matching
  live selection, hid the jump after an edit, moved the file, and confirmed
  the saved excerpt was still available after reopening and on a later turn.

The fingerprint covers the full visible text buffer, using the editor's
normalized line endings. External changes are rechecked periodically and
every jump validates the range again before selecting it.

## M07 · REL-01

- A clean staged source snapshot passed `npm ci` and `npm run check` with
  Node 24.14.0 and no model credentials. All 16 unit tests passed.
  `npm run package:linux` built `resos_1.0.0_amd64.deb` with a cached
  Electron 45.2.3 archive verified against the pinned Electron checksums.
  The generated sidecar passed `sha256sum -c`.
- `desktop-file-validate` and all six desktop tests passed on the extracted
  package under Xvfb. The restore fixture checks full equality of the saved
  project and conversations, then opens the restored note, excerpt, and
  discussion's original revision. The tab test verifies both drafts exactly
  after an immediate switch. The project persistence check also opened a
  profile created with the 0.6.0 package.
- `xvfb-run -a node scripts/desktop-codex-smoke.mjs` passed on the extracted
  1.0.0 package with Codex CLI 0.167.0, including a streamed response and
  persisted run IDs in a disposable project and profile.
- A fresh Ubuntu 24.04 x86-64 container installed the same package using
  `apt-get install`. The desktop entry passed validation and `ldd` found
  every linked library. The container used Xvfb and the setuid Chromium
  sandbox because it could not create unprivileged user namespaces. All
  six desktop tests and the live Codex smoke test passed against the
  installed executable. The live check used the signed-in host CLI over
  a temporary Unix socket without mounting credentials in the container.
- `actionlint` 1.7.10 passed both workflows. The manual release workflow
  has not run on GitHub. It needs to be present on the repository's default
  branch, currently the legacy `master`, before it can be dispatched.

## V2-01 · Chat-first workspace

- `npm run check` passed all 16 unit tests.
- `npm run package:linux` built a scratch package with the checksum-verified
  Electron 45.2.3 cache. `desktop-file-validate` passed, and all six
  `npm run test:desktop` tests passed against the extracted executable
  under Xvfb with the host Wayland display variables unset.
- The workspace tests cover keyboard disclosure, independent section state
  across project switches and restart, draft and reading-position retention,
  file conflicts, and a usable transcript at the 640 × 420 minimum size.
  The visual check at the minimum size led to a narrower sidebar and shorter
  composer. Runs that inherited the host Wayland display intermittently
  entered different text from the test fixtures. The isolated Xvfb run
  passed with the same executable and fixtures.

## V2-02 · Selection and discussions

- `npm run check` passed all 17 unit tests. The tests cover the format-1
  upgrade, cross-project attachment rejection, immutable excerpts and chat
  quotes, and exclusion of annotations from the submitted context. The
  Codex protocol fixture verifies the file and passage fields sent to the
  app server.
- `npm run package:linux` built a scratch Debian package with the verified
  Electron cache. The desktop entry passed `desktop-file-validate` and all
  six desktop tests passed on the extracted executable under isolated Xvfb.
- The desktop tests exercise the keyboard selection toolbar, repeated
  phrases, preserved selection during an unrelated refresh, nested TeX
  discussions, clickable highlights with overlapping links, expand and
  back navigation, and attachment removal before sending. The file check
  verifies annotations, file-side and whole-file questions, and saved
  historical sources after a file changes and moves. The toolbar and side
  chat were also inspected in a running desktop window.
- Repeated the packaged desktop suite with the verified v1.0.0 executable
  as the source of the backup. Restoring it in the new package preserved
  project IDs, notes, revisions, and both source types. Saving a new chat
  wrote format 2 while retaining the original conversations.

## V2-03 · Inspectable context

- `npm run check` passed all 19 unit tests. A long-history fixture checked
  the byte limit with Unicode, pinned quotes, current attachments, omitted
  revision IDs, stale-preview rejection, project and sibling isolation,
  and reuse of the exact input on retry. The protocol fixture verified the
  saved text sent to Codex and rejected lookup calls from other threads
  and turns.
- `npm run package:linux` built a scratch Debian package using the verified
  Electron cache. The desktop entry passed `desktop-file-validate`. All
  six desktop tests passed against the extracted package under isolated
  Xvfb, including context preview, sending reviewed input, opening the
  prepared text, and restoring a backup made with the v1.0.0 executable.
- A live source-build check with Codex CLI 0.167.0 used two disposable
  projects. An opt-in lookup returned a marker from another chat in the
  originating project and omitted the matching marker in the second
  project. The saved submitted text matched the review, and lookup was
  off for the next draft. The byte cap covers the app's initial text.
  Harness-added input and later tool results have separate limits.
