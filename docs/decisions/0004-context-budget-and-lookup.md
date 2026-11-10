# 0004 · Bounded input and project notebook lookup

ResOS builds the initial text in the main process. Both preview and queue
acceptance use the same builder. Sending from a preview checks its digest
against the current payload, context metadata, and working directory. A
changed input requires a fresh preview. An ordinary send also applies the
budget.

Use a default cap of 64,000 UTF-8 bytes for the initial text, including its
reference-data framing. An adapter can provide its own cap. This byte
measurement gives a predictable input limit while tokenization and the
harness's own input vary. The current question, explicit attachments,
file source, and pinned discussion quotes are required. Recent turns fill
the remaining space. Omitted or reduced turns are listed by IDs, and a
reduced turn keeps its pinned quote. If the required material alone
exceeds the cap, queue acceptance fails with guidance to reduce it.

Each new attempt saves the assembled text and context record before it
runs. An accepted Codex turn adds a submission timestamp and runtime IDs.
Retry keeps the original prepared text and lookup choice. Older attempts
without a saved text payload use their recorded history under the current
budget on explicit retry. A retry still confirms a changed project root.

The Codex adapter registers a read-only dynamic tool only when the user
opts in for that send. Each tool request must match the active thread and
turn. A main-process callback binds the request to the original project,
searches saved messages, and returns up to five excerpts with revision IDs.
Each run can make up to four lookups. Search does not return notes or
expose a database path. These limits apply to the ResOS lookup tool.
Other filesystem access follows the harness's permission policy.
Accepted search results are stored separately from the initial input.

The new attempt fields are optional in the existing notebook format.
Older saved chats and runs retain their IDs and original context records.
