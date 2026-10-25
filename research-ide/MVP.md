# Research IDE MVP

## Product goal

A private, local, single-user research workspace that feels like a small IDE:
project files are visible and editable, while a normal Codex agent is available
in a persistent chat pane. The user mostly works by talking to the agent. They
can select text in an assistant answer and open an independent linked chat from
that point, keeping the main line of work uncluttered.

The existing 2d area-law proof explorer is a visual reference for focused,
readable panes, restrained color, and putting detail next to the current work.
It is not the application architecture or source of truth.

## First usable slice

1. Launch the app against one explicitly chosen local workspace directory.
2. Browse files, open a text file, edit it, and save it.
3. Start a chat and converse with the installed Codex app-server using that
   workspace as the agent's working directory. Refresh the file view when the
   agent changes workspace files.
4. Select a passage in an assistant answer and create a separate chat by
   pinning the saved source node and revision. Carry the selected text
   as a visible source quote and ask a follow-up there.
5. Continue each chat independently, switch between chats, and navigate their
   parent/child links through source highlights and popups. Only main chats
   appear in the conversation list; file discussions remain with their files.
6. Start each agent response with the saved node path; let it search saved chats
   and inspect the parent path through a small local context reader.
7. Preserve the chats and source links across app restarts.

## Interface

- Chat is the primary workspace, with a conversation list on the left. The file
  editor opens on demand, beside chat on a wide screen or over it on a tablet.
- Left navigation switches between a project file tree and the main chat list.
  Follow-ups are opened from source passages or the question list in a file.
- Chat is a familiar transcript and composer. A small action appears when text
  is selected in an assistant answer: **Ask about selection**.
- A branch shows its origin quote and a link back to its parent. Switching chats
  changes the transcript without merging histories.
- The composer remains visible and editable during generation. Each conversation
  has its own draft, and a Stop control cancels an active turn. The transcript
  scrolls independently of the composer and preserves reading position.
- On smaller screens navigation opens as a drawer. The layout follows the visual
  viewport as a software keyboard opens. Inputs use 16px text to avoid Safari's
  focus zoom. An answer also has an Ask about this action for touch use.
- Quiet borders, neutral surfaces, readable system typography, and restrained
  teal accents keep the focus on the conversation.

## Implementation boundary

- Local web app, bound to loopback by default, with explicit keyed LAN access
  for another device on the user's Wi-Fi.
- Codex app-server is the agent runtime, so the prototype does not implement a
  model loop or tool harness of its own.
- The server is started with one workspace root. The file API is confined to
  that workspace. Codex starts there with a workspace-write sandbox and requests
  approval for additional permissions. Hidden VCS/runtime directories are omitted
  from the browser's file tree.
- The app owns message nodes, revisions, notes, source links and response jobs.
  Codex runtime threads execute individual jobs and remain replaceable.
- A small read-only context helper lets the normal agent search saved chats on
  demand; historical messages are data, not instructions.
- No production dependencies; use the installed Node runtime and browser APIs.

## Explicitly deferred

Cross-project memory, automatic research summaries, multi-agent workflows,
collaboration, remote access, model selection, publishing, and a large graph
visualization. Source links provide simple navigation, not an additional research model.

## Acceptance checks

- The local app starts with a chosen workspace and shows its files and a usable
  editor.
- Saving a file changes the file on disk within the chosen workspace.
- A real Codex app-server thread can answer a prompt and its reply streams in the
  chat pane.
- A branch created from a selected answer pins its source revision, contains
  the selected quote, and is linked to the parent through a passage highlight or follow-up button.
- A follow-up in either chat uses its saved path; reopening the app
  restores the source links and messages.
- The agent can retrieve a matching result from another saved chat by using the
  context helper, with its chat ID/title available for provenance.
- Path traversal cannot read or write outside the chosen workspace.

## Known limit for this prototype

The app-server API is experimental. This MVP targets the version installed on
the development machine and documents the CLI dependency at launch. It is a
local prototype, not a portable packaged IDE.
