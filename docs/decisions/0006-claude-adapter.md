# Claude Code adapter and command isolation

ResOS routes each attempt to its recorded harness. The application owns
the notebook and context budget. Both Codex and Claude receive the same
prepared text format, and each attempt starts a fresh session.

## Claude Code settings and authentication

The Electron main process uses the Claude Agent SDK with an independently
installed Claude Code executable. Credentials stay with the CLI. ResOS
queries the installed CLI for model and effort choices and prefers its
canonical model IDs when reported. The supported catalog exposes discrete
effort levels. Session initialization supplies the effective model and
supplies the effective effort when the CLI reports it.

The minimum CLI version is 2.1.248, which supports submitting the exact
ResOS prompt as literal content without file-mention expansion or slash
command dispatch. The adapter uses a private working directory, disables
built-in tools and filesystem settings sources, and registers only the
in-process ResOS MCP server. The CLI's own built-in plugins can appear in
initialization. ResOS checks the announced tool and MCP server lists and
rejects non-bundled plugins. CLI installation and machine administrator
configuration are trusted host inputs. [Claude Agent SDK options](https://code.claude.com/docs/en/agent-sdk/typescript)

## Project tools and approvals

ResOS implements file and notebook access in the main process. Ask offers
file listing and reads. Each run can opt in to project-scoped notebook
lookup. Agent offers file creation and replacement and a command tool.
Creation cannot overwrite an existing entry. Replacements require the
current file revision. The approval shows the target and proposed content
or the exact argument vector. The approval applies to the originating job
once and expires when the job stops.

Bubblewrap runs approved commands in a mount, user, process, and network
namespace with an empty inherited environment. Commands get a read-only
snapshot of regular project files, read-only system binaries and libraries,
and size-limited private scratch storage. A seccomp filter blocks sockets
and io_uring so commands cannot contact a host Unix socket. If isolation
cannot initialize, the command fails. File writes go through the same
workspace boundary as editor saves. [Linux seccomp filter documentation](https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html)
