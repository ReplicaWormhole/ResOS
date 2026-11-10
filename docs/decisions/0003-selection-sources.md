# 0003 · Selection sources and file notes

The selection toolbar captures an immutable source before a dialog or
composer takes focus. The main process validates chat quotes against the
saved message revision and project. File captures record the buffer
fingerprint, exact text and range, line numbers, and whether the selection
came from unsaved edits. Whole-file questions carry a project-relative path
for a later runtime read of the on-disk file.

A chat-passage question uses the existing discussion ancestry. A file
question starts a project chat with a file source, accessible from the chat
sidebar. Descendant discussions inherit that source. An attachment belongs
to its sent message and is retained in later eligible context. An annotation
belongs to a saved message revision or a project file capture. The runtime
receives annotations only if the user explicitly includes their text.

The notebook reads existing format-1 snapshots and writes format 2 on the
next mutation, using the same atomic replacement and backup files. Format 2
adds project-scoped file notes and optional file sources, attached passages,
and passage ranges on message notes. Existing IDs, revisions, discussions,
and runs retain their meanings. Older executables reject the newer format,
so a backup taken with v1 is the downgrade path.
