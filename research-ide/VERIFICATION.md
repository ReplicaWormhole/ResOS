# Manual verification, 24 October 2026

The live Wi-Fi URL was exercised in a browser, rather than only on localhost.
This reproduced a send failure: `crypto.randomUUID()` is unavailable on the
insecure LAN origin. The old handler cleared the input before throwing. Browser
message IDs now use an internal local sequence; server IDs and access keys still
use Node's cryptographic generators.

After the fix, verified through the live interface:

- Sent a prompt, received `Hello.`, and confirmed the composer stayed enabled
  during generation.
- Drafted in one chat, switched to another and drafted there, then switched back
  and recovered the first draft.
- Opened a linked chat, asked about the parent conversation, and received the
  correct answer from its inherited context.
- Created another branch and immediately entered a follow-up. The composer
  waited for branch creation, and the prompt went into the new linked chat.
- At 1024 by 450 pixels, representing the space remaining above a tablet
  keyboard, the full composer remained within the visible viewport.
- At 390 by 600 pixels, the conversation filled the screen. Opened the navigation
  drawer, inspected a file without editing it, and closed the editor to return
  to the same conversation.
- Stopped a running agent turn. The response showed `Response stopped.`, and
  the ordinary send control returned.

Adversarial review fixed a branch-creation race that could otherwise send a
fast follow-up into the parent, and prevented background file refreshes from
reopening the editor over chat. No unresolved blocking finding remains in the
reviewed interaction; the platform limits below still apply.

`node --check public/app.js` and `node --check server.mjs` passed.

These are manual Chromium browser checks at representative sizes. A physical
iPad Safari keyboard was not controlled from this machine. The user service is
transient: it survives this chat session but does not start automatically after
a computer reboot. Synthetic verification chats remain in ignored local state.
`VERIFY.txt` is the retained fixture from the original file-save check.


## Linked passage markers, 25 October 2026

Verified the existing “urrent wo” follow-up through the live Wi-Fi interface:
the original answer highlights that exact fragment, tapping it opens the saved
question and answer in a modal, and “Open chat to continue” switches to the child.
Escape closes the popup and returns focus to the marker in the parent. Repeated
the marker/popup check after restarting the service and reloading the page.
No verification conversations were created for this change.

`node --test research-ide/tests/passages.test.mjs` passes five focused tests:
exact offsets for repeated phrases, legacy quote/whitespace matching, spans
across formatting and line breaks with overlapping chats, marking only the
second repeated phrase, and fallback for unmatched older Markdown quotes.
The test harness checks the actual rendering helpers with a small DOM model;
it does not replace the live browser checks. `node --check` passes for the client
and server, and `git diff --check` passes.

Adversarial diff review found and fixed loss of popup reading position on live
updates and focus loss from rebuilding the overlapping-chat selector. No blocking
findings remain. Physical iPad Safari, browser text-selection gestures, and the
new selection-position persistence path were not exercised end to end. Older
ambiguous repeated quotes use the first occurrence because their original
position was never stored. New position metadata uses the existing ignored
local state file. No dependencies were added.


## Questions about files, 25 October 2026

Live browser verification on the Wi-Fi origin used the existing `VERIFY.txt`
fixture without changing it. Drag-selected “Second line.” in the new reading
view, opened a file chat, and asked the agent to report its received context.
The agent returned the correct path `research-ide/VERIFY.txt`, line 2, and quote.
The Open file action returned to a marked passage; tapping the marker opened
that saved conversation in a popup. Reloading preserved the source link and
marker. Switched between Edit and Read without changing the file. The whole-file
button opened a separate chat with the file path and no invented passage.
Two verification file chats remain intentionally in ignored local state (one
contains the agent context check; the whole-file chat is empty).

`node --test research-ide/tests/*.test.mjs` passes 11 tests covering file selection
normalization, invalid/oversized ranges, first-turn file context, whole-file
context, ordinary chat compatibility, and the existing marker cases plus
ambiguous matches after file changes. Live API checks reject path traversal,
invalid offsets, and selections that differ from disk. Syntax checks pass for
`server.mjs`, `file-context.mjs`, `public/app.js`, and `scripts/read_context.mjs`.
`git diff --check` passes. No dependencies were added.

Adversarial review checked draft preservation, stale file selections, source
path confinement, quote escaping, and existing chat branching. Added protection
against replacing newly typed edits with a pending file load and against
silently marking a different occurrence after an ambiguous file edit. No
blocking findings remain. Physical iPad Safari and its selection/keyboard
gestures remain untested. File markers relocate by quote when unique; they are
not a full document-version anchor system. The saved quote remains historical
context if the file later changes. Screenshots are temporary artifacts under
`/tmp/fieldwork-file-*.png`; runtime chat state remains ignored.

## Browser client readability refactor, 25 October 2026

Extracted browser storage/JSON transport, Markdown rendering, passage matching
and highlighting, the linked-chat popup, and streamed conversation updates into
native JavaScript modules. The controller now has explicit startup and grouped
event registration. Navigation uses DOM construction and text content instead
of long interpolated HTML strings. No runtime dependencies were added.

Verification from the repository root:

- `node --test research-ide/tests/*.test.mjs` passed. Running each test file
  directly also passed all 20 individual cases (8 client, 7 passage, 5 file
  context). These include API authentication/errors, unavailable storage,
  escaping, optimistic message reconciliation, completion statuses, and passage
  activation by pointer and keyboard.
- `node --check` passed for all six browser modules and the browser smoke script.
- `node research-ide/tests/browser-smoke.mjs <playwright-module> <chromium-executable>`
  passed with the locally installed Playwright and Chromium. Its isolated HTTP
  fixture exercised authenticated module loading, draft switching and reload,
  safe message rendering, linked popups, parent/source navigation, file editing
  and saving, selected/whole-file questions, answer branching, streamed output,
  stop, approvals, and mobile navigation. No browser console or page errors
  occurred. The fixture keeps all chat/file mutations in memory.
- `git diff --check` passed.

Adversarial review checked the extra module imports, event registration,
callback wiring, text escaping, selection offsets, and retained load/send race
guards. A status-map lookup introduced during extraction was replaced with
explicit status comparisons, preserving the original handling of unknown
statuses; a regression test covers it. No unresolved blocking findings remain.
This validates the browser against simulated server responses; a fresh live
Codex turn and physical iPad Safari were not exercised for this refactor.


## Main conversations only, 25 October 2026

The sidebar now lists root chats without a file source. Chat follow-ups (including
nested ones) and file questions remain saved and accessible through the existing
passage markers, fallback buttons, file question lists, and source navigation.
The main ancestor stays selected when a chat follow-up is active. New main chats
and main-chat drafts remain visible under the existing empty-chat rules.

`node --test research-ide/tests/*.test.mjs` passes all 23 tests, including three
new navigation tests covering active follow-ups, file questions, nested ancestors,
cycles/missing IDs, main drafts and non-mutation of saved data. Syntax checks and
`git diff --check` pass. In the live browser, verified the filtered sidebar,
opened the existing “urrent wo” popup, then continued into that follow-up: the
sidebar still contained only main chats. No chats were created or removed.

Adversarial review found no blocking issues. Physical iPad Safari was not tested;
this change uses the existing responsive list and popup controls. Screenshot
`/tmp/fieldwork-main-conversations.png` is a temporary preview artifact.


## Continue inside popups, 25 October 2026

Popups now contain a composer, Send/Stop controls, working status, visible send
errors, and the shared permission controls. Expand chat changes the viewing area;
it is no longer required to reply. Popup and full-view drafts share the existing
per-chat session-storage key, while parent drafts remain separate.

Live verification used the existing whole-file `VERIFY.txt` test chat. Sent two
consecutive messages entirely in the popup and received `POPUP_OK` and
`SECOND_POPUP_OK`. Verified that the main chat draft survived a popup send, a
popup draft moved into the expanded composer, survived reload, returned to the
popup, and synchronized back after closing. No test chats were created or files
edited. Two successful verification turns remain in ignored saved state.

The older “About: Hello.” test chat returned an agent runtime error that its
thread already has an active writer. Its failed question and restored draft
remain saved. No other agent process was interrupted to remove that lock. This
is a remaining runtime limitation for that old thread; the fresh-thread popup
check completed both turns successfully.

`node --test research-ide/tests/*.test.mjs` passes all 24 tests. The new popup
DOM/event test covers target chat IDs, separate drafts for overlapping chats,
failed-send restoration, busy-chat send protection, Stop/permission callbacks,
expansion, and reopening drafts edited in the full view. Syntax checks pass for
`public/app.js` and `public/branch-popup.js`; `git diff --check` passes. Permission
and Stop actions were tested via callbacks; their controls appeared during the
live response, but no live permission request was induced.

Adversarial review fixed draft loss when returning from a popup to the same
chat, restoration after shared-sender errors, and forwarding DOM click events
as chat IDs to the Stop handler. No blocking issue remains in the changed UI.
Physical iPad Safari keyboard behavior is not verified. No dependencies added.
Screenshot `/tmp/fieldwork-popup-replies.png` is temporary; the test drafts live
only in the temporary browser tab's session storage.
