# Fieldwork Research IDE

A local research notebook for working with project files and Codex. Keep persistent
conversations, ask follow-up questions about selected passages, and return to the
exact source revision behind a discussion.

## Features

- Chat with Codex while browsing and editing a local project.
- Open nested discussions from passages in answers or files.
- Edit messages with revision history and add separate human notes.
- Render Markdown and TeX mathematics using bundled KaTeX assets.
- Stream responses, stop jobs, and retry failed responses.
- Keep notebook state locally between restarts.

This is a single-user prototype. Each response uses a fresh Codex runtime thread
with saved context; jobs run serially within the notebook.

## Quick start

Install Node.js (verified with Node 24) and the Codex CLI, then sign in to Codex
on the computer that will run the app. No npm installation or frontend build is
required; KaTeX is included with its license under `research-ide/public/vendor/`.

```sh
git clone https://github.com/ReplicaWormhole/hds.git
cd hds
node research-ide/server.mjs --workspace /absolute/path/to/your/project
```

Open <http://127.0.0.1:8788/>. The workspace argument selects the files the app
browses and the working directory for Codex. Use `--port 8790` to change the port,
or set `CODEX_BIN` to the path of your Codex CLI. Stop the server with Ctrl+C.

For explicit access over trusted local Wi-Fi, add `--host <your-computer-LAN-IP>`
and open the complete access link printed by the server on your other device.
That link contains a per-run access key. This mode uses plain HTTP and is intended
for a trusted local network; do not expose it to the public Internet.

## Local data and credentials

Notebook conversations, selections, backups, and writer state live in
`research-ide/.local/`, which Git ignores. Codex authentication remains in your
local Codex installation; this repository does not require checked-in API keys.
Conversation context is sent to the model service configured in Codex.

Environment files, common credential stores, private-key files, dependency
directories, and local state are excluded by `.gitignore`. Keep access links,
authentication tokens, and personal documents outside tracked files. Ignore rules
do not protect a secret deliberately added with `git add --force` or previously
committed to history.

## Repository guide

| Path | Contents |
| --- | --- |
| [research-ide/](research-ide/) | Runnable notebook prototype and tests. |
| [research-ide/README.md](research-ide/README.md) | Detailed interactions, module guide, and browser checks. |
| [research-ide/ARCHITECTURE.md](research-ide/ARCHITECTURE.md) | Persistence, context, migration, and recovery contracts. |
| [research-ide/MVP.md](research-ide/MVP.md) | Notebook scope and acceptance criteria. |
| [research-ide/VERIFICATION.md](research-ide/VERIFICATION.md) | Recorded manual checks and known limitations. |
| [SPEC.md](SPEC.md) | Separate draft specification for a Telegram-first personal document assistant. Its document ingestion and reminder features are not implemented by this notebook. |

## Verification

From the repository root:

```sh
node --test research-ide/tests/*.test.mjs
node --check research-ide/server.mjs
node --check research-ide/public/app.js
```

The tests use isolated fixtures and a mock runtime, without model calls or changes
to your saved notebook. Optional Playwright instructions are in the detailed
README. Physical tablet behavior and real model/network availability need separate
manual verification.
