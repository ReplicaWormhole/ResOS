# 0002 · Local notebook storage and prototype import

## Decision

Keep the existing project registry and store notebook data separately in a
versioned, owner-readable JSON file under Electron's user-data directory.
Stable project IDs link the two records. Moving a folder only updates the
registry. Serialize notebook mutations and atomically replace the snapshot.
Persist each accepted question, attempt, and streamed chunk. On startup,
mark unfinished attempts interrupted and keep any saved partial response.

The M03 desktop app starts with a fresh notebook. Browser notebook import
is outside the current release scope. The legacy checkout remains the
reference and retains its data. A future import would read a copy and
preserve source IDs, revisions, and links where the browser recorded them.

The built-in M03 runtime streams a clearly labelled demo response locally.
The runtime interface receives an immutable project, conversation, and
working-directory snapshot. The Codex adapter will use that boundary in M04.
