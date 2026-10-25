# Persistent notebook architecture

## Authoritative state

State version 2 owns conversations, message nodes, source links and jobs.
Conversations are UI groupings; nodes carry parentNodeId edges. Context walks
those edges, rather than the entire ordered display array. Retry answers can
share one question without including superseded siblings in the chosen path.

Completed messages have immutable revisions with IDs, text, timestamp and author
(agent or user). The current text is a convenience projection. Human revision
preserves the original message role and records human authorship. Notes have
their own IDs and identify the revision they annotate. Save conflicts are
rejected against the editor's base revision. Edits do not regenerate replies.

Branches pin parentMessageId, parentRevisionId, selected quote, rendered-text
offset and sourceContext (the ancestor snapshots when the branch was made).
Source edits leave earlier-revision links. File questions pin the path and
selected quote; whole files remain mutable workspace files, without automatic
file-version snapshots.

Version-1 migration keeps chat/message IDs, source quotes and file links. Legacy
session IDs become provenance-only legacyThreadId values. Parent paths are
reconstructed from available saved metadata; exact historical runtime inputs
cannot be reconstructed for legacy turns. An owner-only timestamped backup of
the original state is saved before migration.

## Response jobs

A send reserves the chat in memory before its first await, creates input/output
nodes, and records the job and context before acknowledging acceptance. Request
IDs deduplicate retries. Retry response reuses the question and adds an output
attempt. Subsequent questions follow the most recent output through parent edges.

Jobs execute serially within a notebook. Every attempt calls thread/start;
thread/resume and thread/fork are never used. Branch creation requires no model
connection. Notifications route by the active job's fresh thread. Late events
from other threads are ignored. Runtime resources are unsubscribed after
completion. Runtime failure stops only this server's process group before
scheduling another job; desktop agents are unaffected.

Each job saves input/output IDs, request ID, status, timestamps, runtime IDs,
context and exact prompt. Run context exposes the record. A 90,000-character
node budget preserves the focal question and lists omitted node/revision IDs.
Source quotes and paths are supplied separately. The context reader searches
messages/notes and retrieves exact revisions within the active workspace.

## Ownership and recovery

A PID ownership file prevents a second server from opening the same notebook.
A dead PID lock is reclaimed; live owners are never evicted. Atomic temporary
file replacement serializes saved snapshots with owner-only permissions. The
filesystem is the durability boundary: this is a local single-user store, not
a distributed database. Recorded snapshots grow without automatic compaction.

Startup marks queued/running work interrupted and retains partial answers.
Jobs are never replayed automatically: tools may already have modified files.
Explicit retry starts another job, not a transaction rollback. Model, network,
permission and storage errors remain possible. Fresh threads remove dependence
on conflicting ownership of previous conversation sessions.

## Nested interface

Both message views share one renderer. Wrappers identify chat, node and revision,
so selection actions identify the correct source even inside a popup. The popup
contains its own contextual button in the modal top layer. A navigation stack
preserves the parent and reading position. Back returns one level; each discussion
keeps its own draft. Editing/history opens a second modal above the discussion.

## Checks

Run node --test research-ide/tests/*.test.mjs. API tests create an isolated
notebook and mock executable in the OS temporary directory, exercising locks,
edits, pinning, runtime replacement and restart persistence. Browser checks and
physical-device limitations are recorded in VERIFICATION.md.
