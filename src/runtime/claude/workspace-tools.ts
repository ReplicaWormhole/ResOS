import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk/core';
import { z } from 'zod';
import { MAX_LOOKUP_QUERY } from '../../notebook/lookup.js';
import type { WorkspaceSave } from '../../shared/desktop-api.js';
import {
  checkNewFilePath,
  createFile,
  listDirectory,
  readFile,
  saveFile,
} from '../../workspace/workspace-files.js';
import type { RuntimeControls } from '../chat-runtime.js';
import { runSandboxCommand } from './sandbox-command.js';

const path = z.string().min(1).max(4096);
const maxFileChunk = 12_000;

function result(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

async function respond(signal: AbortSignal, operation: () => Promise<string>) {
  try {
    signal.throwIfAborted();
    return result(await operation());
  } catch (error) {
    const detail =
      error instanceof Error && !('code' in error)
        ? error.message
        : 'The workspace operation could not be completed.';
    return result(detail, true);
  }
}

export function workspaceTools(
  root: string,
  controls: RuntimeControls,
  changeWorkspace: (
    operation: () => Promise<WorkspaceSave>,
  ) => Promise<WorkspaceSave>,
) {
  const { signal, lookupNotebook } = controls;
  const tools: NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']> =
    [
      tool(
        'list_files',
        'List regular files and directories at a relative project path. Use an empty path for the project root.',
        {
          path: z.string().max(4096),
          offset: z.number().int().min(0).optional(),
        },
        ({ path, offset = 0 }) =>
          respond(signal, async () => {
            const files = await listDirectory(root, path);
            const entries = files.slice(offset, offset + 80);
            return JSON.stringify({
              entries,
              ...(offset + entries.length < files.length
                ? { nextOffset: offset + entries.length }
                : {}),
            });
          }),
      ),
      tool(
        'read_file',
        'Read a UTF-8 project file by relative path. Use nextOffset to continue and retain the revision for edits.',
        { path, offset: z.number().int().min(0).optional() },
        ({ path, offset = 0 }) =>
          respond(signal, async () => {
            const file = await readFile(root, path);
            const text = file.text.slice(offset, offset + maxFileChunk);
            return JSON.stringify({
              text,
              revision: file.revision,
              ...(offset + text.length < file.text.length
                ? { nextOffset: offset + text.length }
                : {}),
            });
          }),
      ),
    ];
  if (controls.settings?.mode === 'agent') {
    tools.push(
      tool(
        'run_command',
        'Run a command after the user approves its exact argument vector. The working directory /workspace is a read-only project snapshot. Use /tmp for build outputs. Networking and the user home directory are unavailable.',
        {
          argv: z
            .array(
              z
                .string()
                .max(4000)
                .refine((value) => !value.includes('\0')),
            )
            .min(1)
            .max(12),
        },
        ({ argv }) =>
          respond(signal, async () => {
            if (!argv[0]) throw new Error('The command needs an executable.');
            const accept = await controls.approve({
              kind: 'Claude Code command',
              detail:
                'Read-only project snapshot with private scratch space\n\n' +
                JSON.stringify(argv, null, 2),
            });
            signal.throwIfAborted();
            if (!accept) return 'The user denied the proposed command.';
            return runSandboxCommand(root, argv, signal);
          }),
      ),
      tool(
        'write_file',
        'Create or replace a small UTF-8 project file after the user approves the full proposed content. Supply the revision from read_file to replace an existing file. Omit it only to create a new file in an existing directory.',
        {
          path,
          revision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          text: z.string().max(24_000),
        },
        ({ path, revision, text }) =>
          respond(signal, async () => {
            if (revision && (await readFile(root, path)).revision !== revision)
              return 'The file changed. Read the latest revision before proposing a write.';
            if (!revision) await checkNewFilePath(root, path);
            signal.throwIfAborted();
            const accept = await controls.approve({
              kind: revision
                ? 'Claude Code file replacement'
                : 'Claude Code file creation',
              detail: path + '\n\nProposed full contents\n\n' + text,
            });
            signal.throwIfAborted();
            if (!accept) return 'The user denied the proposed write.';
            const outcome = await changeWorkspace(() => {
              signal.throwIfAborted();
              return revision
                ? saveFile(root, path, revision, text)
                : createFile(root, path, text);
            });
            return outcome.status === 'saved'
              ? JSON.stringify(outcome)
              : 'The target already exists or changed. Read its current revision before proposing a write.';
          }),
      ),
    );
  }
  if (lookupNotebook) {
    tools.push(
      tool(
        'resos_search_notebook',
        'Search saved messages in this ResOS project. Matches include their revision IDs.',
        { query: z.string().min(1).max(MAX_LOOKUP_QUERY) },
        ({ query }) =>
          respond(signal, async () =>
            JSON.stringify(await lookupNotebook(query)),
          ),
      ),
    );
  }
  return {
    server: createSdkMcpServer({ name: 'resos', tools }),
    names: tools.map(({ name }) => 'mcp__resos__' + name),
  };
}
