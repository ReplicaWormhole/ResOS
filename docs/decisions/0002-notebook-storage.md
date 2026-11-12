# 0002 · Local notebook storage and prototype import

## Decision

Keep the existing project registry and store notebook data separately in a
versioned, owner-readable JSON file under Electron's user-data directory.
Stable project IDs link the two records. Moving a folder only updates the
registry. Serialize notebook mutations and atomically replace the snapshot.
Persist each accepted question, attempt, and streamed chunk. On startup,
mark unfinished attempts interrupted and keep any saved partial response.

Project pinning and removal use optional `pinned` and `removed` flags in the
version-1 registry. Removed entries stay in that file to preserve their IDs,
but are excluded from the sidebar and workspace operations. Removing a project
clears its pin and leaves notebook records and workspace files untouched.
Adding the same resolved folder restores its original registry entry. Registry
mutations remain serialized and atomic. Removing a project with an active
response is rejected before changing the registry.

Chat deletion is a separate notebook mutation. It atomically removes the
selected conversation and descendants linked through their discussion source.
It rejects queued or running attempts within that subtree. Other conversations
and independent file notes remain. Historical quotes and context snapshots
already saved in another chat retain their captured text even when their
source is deleted. Renderer caches and unsent quotes from deleted chats are
cleared after deletion. The app offers no undo for chat deletion.

The M03 desktop app starts with a fresh notebook. Browser notebook import
is outside the current release scope. The legacy checkout remains the
reference and retains its data. A future import would read a copy and
preserve source IDs, revisions, and links where the browser recorded them.

The built-in M03 runtime streams a clearly labelled demo response locally.
The runtime interface receives an immutable project, conversation, and
working-directory snapshot. The Codex adapter will use that boundary in M04.
