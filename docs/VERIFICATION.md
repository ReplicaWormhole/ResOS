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

## V2-04 · Codex controls

- `npm run check` passed all 23 unit tests. The protocol fixtures cover
  paginated model discovery, hidden and incompatible models, missing model
  and effort choices, confirmation of effective settings, Ask's denial
  of escalation, Agent approvals, and cancellation at the end of scoped
  setup. The notebook tests verify that preview and queue bind the selected
  settings, and that retries retain them until an explicit replacement.
- `npm run package:linux` built a scratch package using the verified Electron
  cache. The desktop entry passed `desktop-file-validate` and all seven
  desktop tests passed against the extracted executable in isolated Xvfb.
  The settings test used the Codex protocol fixture through the composer.
  The backup fixture restored data from the verified v1.0.0 executable.
- Two live source-build turns with Codex CLI 0.167.0 used a supported model
  and effort selected in the desktop composer. Ask read a disposable file
  and Agent wrote a disposable file inside the same project. Both runs
  recorded the confirmed model and effort. A separate `command/exec` probe
  using the same policies verified that read-only denied a write and
  workspace-write allowed an in-project write and denied a sibling write.
- A disposable Codex configuration with an MCP startup sentinel confirmed
  that discovery did not start the server. A per-server override disabled
  it. The adapter verifies these overrides at runtime and fails if policy
  requirements prevent their application.

## V2-05 · Codex desktop release

- The live release uses Codex. The Claude prototype and its fixture checks
  remain in Git at `471bad4` and `8693b22` for future work. The released app
  can read the prototype's saved run records, and an explicit Codex retry
  keeps the original input and attempt history.
- A clean dependency install and `npm run check` passed. All 24 source
  tests passed, including the experimental notebook compatibility check
  and the existing Codex settings, cancellation, and approval fixtures.
- The versioned Ubuntu x86-64 package and SHA-256 sidecar were verified.
  Inspection of the app archive and package metadata confirmed removal of
  the Claude adapter, its SDK, and the Bubblewrap dependency.
- A fresh Ubuntu 24.04 container installed the package using APT and
  validated its desktop entry. All seven packaged desktop tests passed.
  The restore test copied a backup from the verified v1.0.0 executable into
  a fresh profile and confirmed project IDs, revisions, and both source
  types. Chromium sandboxing remained enabled with the setuid helper
  configured inside the container.
- The packaged live smoke test used Codex CLI 0.167.0. Ask read a marker
  and Agent wrote a file in the same disposable project. Both attempts
  recorded the selected model, confirmed settings, and run IDs. No release
  has been published.

## Compact model picker · 2.0.1

- The composer shows the selected model and reasoning effort in one
  button. Its popup contains the model, effort, mode, and refresh controls.
- `npm run check` passed formatting, lint, typecheck, build, and 24 tests.
  All seven desktop tests passed against the packaged executable under
  isolated Xvfb. The settings test covers the collapsed summary, keyboard
  opening, Escape with focus restoration, outside-click dismissal, updated
  choices, and popup bounds at 640 × 420.
- Inspected dark-mode screenshots of the collapsed composer and open
  popup at the minimum window size. The Debian package and its SHA-256
  sidecar were generated for 2.0.1 and the checksum passed.

## White chat interface and keyboard sending · 2.0.2

- User messages appear in right-aligned gray bubbles and assistant replies
  show their content directly. Sender identity remains available to screen
  readers. The live runtime banner is hidden and message actions use an
  ellipsis that appears on hover or keyboard focus.
- Enter sends through the existing submit flow and Shift+Enter inserts a
  newline. Composition and repeated key events do not send. Sending also
  closes an open model picker.
- `npm run check` passed all source checks and 24 tests. All seven
  packaged desktop tests passed under isolated Xvfb. The tests exercised
  Enter, Shift+Enter, synthetic composition and repeat events, duplicate
  submission prevention, white coloring under a dark system preference,
  bubble alignment, message actions, and sender heading removal.
- Visually inspected the packaged app with sample prose and TeX at normal
  and minimum window sizes. Built the 2.0.2 Debian package and verified
  its SHA-256 sidecar.

## Light and dark theme switch · 2.0.3

- Added a global Dark mode switch in a fixed footer at the bottom of the
  sidebar. Light is the default. The saved choice applies across projects
  and restarts, including chat, menus, native controls, and the editor.
- The editor uses CodeMirror theme compartments so switching appearance
  preserves cached documents, selections, and undo history. Its existing
  highlighting package is now a direct dependency for the dark palette.
- `npm run check` passed all source checks and 24 tests. All eight packaged
  desktop tests passed under isolated Xvfb. The theme check covered keyboard
  activation, both palettes, project switches, unsaved editor text and undo,
  persistence across relaunch and reload, and footer visibility at 640 × 420.
  The model-picker check also exercised its dark appearance.
- Inspected packaged light and dark split views, the dark model picker,
  and the minimum-size sidebar. The 2.0.3 Debian package and its SHA-256
  sidecar were generated and the checksum passed.

## CI transport ordering fix · 2.0.4

- GitHub CI exposed a race when a turn-start reply and immediate notebook
  tool requests arrived in the same pipe read. The callback could run
  before the awaiting caller saved the active turn ID.
- The transport now consumes JSON lines through an async iterator, allowing
  reply continuations to update state before the next frame. The fixture
  writes the reply, notifications, and lookup requests in one batch to
  reproduce the case deterministically.
- The batched fixture failed with the previous transport and passed with
  the fix. `npm run check` passed all source checks and 24 tests, including
  rejection of lookup requests for a different thread or turn.

## Desktop and prototype history merge

- Joined the previously unrelated desktop and browser histories using an
  ours-strategy merge from the desktop branch. The resulting source layout
  uses the desktop project. Browser source is accessible at its original
  commit, linked from the prototype reference.
- Before documentation updates, the merge tree matched the existing
  desktop tree exactly. The history scan covered both branches and found
  no credentials. The merge allows `main` and `master` to advance together
  to the desktop project without a force push.

## Empty-project chat entry points · 2.0.5

- V2-01 / CHAT-01: **New chat** remains visible when Chats is collapsed.
  A project with no selected chat also has a **Create chat** button in its
  empty workspace. Both use the existing creation flow and focus the message
  box. Creation ignores another click while a request is pending.
- `npm run check` passed formatting, lint, typecheck, build, and all 24 source
  tests. The focused `empty projects` desktop regression passed from source.
  It collapses Files and Chats in two empty projects, reloads the UI, starts
  chats through both entry points, sends a demo response, and checks project
  isolation while keeping Chats collapsed.
- `npm run package:linux` and `node scripts/release-checksum.mjs` produced
  the local 2.0.5 Debian package and checksum. The package checksum passed
  verification. All nine desktop tests passed against the unpacked executable:

  ```sh
  RESOS_EXECUTABLE="$PWD/release/linux-unpacked/resos" xvfb-run -a npm run test:desktop
  ```

- Visually inspected the packaged empty workspace with both sections collapsed
  at normal and minimum window sizes. The adversarial diff review found no
  remaining defects. No live model call, system installation, or publishing
  was performed. Build and package outputs remain ignored under `dist/` and
  `release/`; screenshots were temporary files under `/tmp`.
