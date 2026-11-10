import { query } from '@anthropic-ai/claude-agent-sdk/core';
import type {
  EffortLevel,
  ModelInfo,
  Options,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk/core';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { formatInitialInput } from '../../notebook/prepare-context.js';
import type { WorkspaceSave } from '../../shared/desktop-api.js';
import type { HarnessModel, RunMode } from '../../shared/notebook-api.js';
import {
  validSettingId,
  validateModelSelection,
} from '../../shared/run-settings.js';
import type {
  ChatRequest,
  ChatRuntime,
  RuntimeControls,
} from '../chat-runtime.js';
import { workspaceTools } from './workspace-tools.js';

const exec = promisify(execFile);
const startupTimeoutMs = 20_000;
const effortLevels = new Set<EffortLevel>([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
const systemPrompt = [
  'You are the coding and research assistant inside ResOS.',
  'The user selected a local project. Its root is represented by relative paths in the provided ResOS workspace tools.',
  'Use those tools to inspect the project. Consult its root AGENTS.md when the task involves working in the project.',
  'Only use the ResOS tools you are offered. File writes and commands require user approval in ResOS.',
  'A denied or unavailable tool action must not be worked around.',
].join(' ');

function modelsFrom(catalog: ModelInfo[]): HarnessModel[] {
  const models = new Map<string, HarnessModel>();
  for (const model of catalog) {
    const id = model.resolvedModel ?? model.value;
    if (!validSettingId(id) || typeof model.displayName !== 'string') continue;
    const previous = models.get(id);
    models.set(id, {
      id,
      label: previous?.label ?? model.displayName,
      efforts: [
        ...new Set([
          ...(previous?.efforts ?? []),
          ...(model.supportedEffortLevels ?? []).filter((effort) =>
            effortLevels.has(effort),
          ),
        ]),
      ],
      isDefault: model.value === 'default' || previous?.isDefault === true,
    });
  }
  return [...models.values()];
}

async function requireCompatibleCli(binary: string): Promise<void> {
  let version: string;
  try {
    ({ stdout: version } = await exec(binary, ['--version'], {
      cwd: '/',
      timeout: 5000,
      maxBuffer: 4096,
    }));
  } catch {
    throw new Error(
      'Claude Code could not start. Check its executable and sign-in.',
    );
  }
  const match = /^(\d+)\.(\d+)\.(\d+)\s/.exec(version);
  if (
    !match ||
    Number(match[1]) < 2 ||
    (Number(match[1]) === 2 &&
      (Number(match[2]) < 1 ||
        (Number(match[2]) === 1 && Number(match[3]) < 248)))
  ) {
    throw new Error('ResOS requires Claude Code 2.1.248 or later.');
  }
}

export class ClaudeRuntime implements ChatRuntime {
  readonly supportsNotebookLookup = true;
  readonly modes: RunMode[] = ['ask', 'agent'];

  constructor(
    private readonly binary: string,
    private readonly changeWorkspace: (
      operation: () => Promise<WorkspaceSave>,
    ) => Promise<WorkspaceSave> = (operation) => operation(),
  ) {}

  private options(cwd: string, abortController: AbortController): Options {
    return {
      cwd,
      abortController,
      pathToClaudeCodeExecutable: this.binary,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      settings: { disableAllHooks: true },
      extraArgs: { 'disable-slash-commands': null },
      permissionMode: 'default',
      canUseTool: async () => ({
        behavior: 'deny',
        message: 'Only ResOS tools are available in this session.',
      }),
      env: { ...process.env, ENABLE_TOOL_SEARCH: 'false' },
    };
  }

  async listModels(): Promise<HarnessModel[]> {
    await requireCompatibleCli(this.binary);
    const cwd = await mkdtemp(join(tmpdir(), 'resos-claude-'));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), startupTimeoutMs);
    const run = query({
      prompt: (async function* (): AsyncIterable<SDKUserMessage> {})(),
      options: this.options(cwd, controller),
    });
    try {
      return modelsFrom(await run.supportedModels());
    } catch {
      throw new Error(
        'Claude Code model discovery failed. Check its installation and sign-in.',
      );
    } finally {
      clearTimeout(timer);
      run.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }

  async *stream(request: ChatRequest, controls: RuntimeControls) {
    const { signal, settings, lookupNotebook } = controls;
    await requireCompatibleCli(this.binary);
    signal.throwIfAborted();
    const cwd = await mkdtemp(join(tmpdir(), 'resos-claude-'));
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();

    const input = Promise.withResolvers<SDKUserMessage | undefined>();
    const turnId = randomUUID();
    const timer = setTimeout(stop, startupTimeoutMs);
    let run: ReturnType<typeof query> | undefined;
    try {
      const { server, names } = workspaceTools(
        request.cwd,
        controls,
        this.changeWorkspace,
      );
      const effort = settings?.effort as EffortLevel | undefined;
      run = query({
        prompt: (async function* () {
          const message = await input.promise;
          if (message) yield message;
        })(),
        options: {
          ...this.options(cwd, controller),
          canUseTool: async (name, input) =>
            names.includes(name)
              ? { behavior: 'allow', updatedInput: input }
              : {
                  behavior: 'deny',
                  message: 'Only ResOS tools are available in this session.',
                },
          mcpServers: { resos: server },
          model: settings?.model,
          effort,
          systemPrompt,
          includePartialMessages: true,
        },
      });
      const catalog = await run.supportedModels();
      const models = modelsFrom(catalog);
      if (settings) validateModelSelection(models, settings);
      const expectedModel = catalog.find(
        ({ resolvedModel }) =>
          resolvedModel && resolvedModel === settings?.model,
      )?.resolvedModel;
      clearTimeout(timer);
      signal.throwIfAborted();
      input.resolve({
        type: 'user',
        message: {
          role: 'user',
          content:
            controls.initialInput ??
            formatInitialInput(request, !!lookupNotebook),
        },
        parent_tool_use_id: null,
        uuid: turnId,
        client_composed: true,
      });
      let initialized = false;
      let streamedText = false;
      let hasText = false;
      for await (const message of run) {
        signal.throwIfAborted();
        if (message.type === 'system' && message.subtype === 'init') {
          if (
            message.tools.some((name) => !names.includes(name)) ||
            message.plugins.some(({ path }) => path !== 'builtin') ||
            message.mcp_servers.some(({ name }) => name !== 'resos') ||
            !message.mcp_servers.some(
              ({ name, status }) => name === 'resos' && status === 'connected',
            )
          ) {
            throw new Error(
              'Claude Code did not confirm the ResOS tool boundary.',
            );
          }
          if (expectedModel && message.model !== expectedModel)
            throw new Error('Claude Code reported a different model.');
          if (effort && message.effort != null && message.effort !== effort)
            throw new Error(
              'Claude Code reported a different reasoning effort.',
            );
          await controls.identify?.(message.session_id, turnId, {
            model: message.model,
            ...(message.effort ? { effort: message.effort } : {}),
          });
          initialized = true;
        }
        if (!initialized) continue;
        if (message.type === 'stream_event' && !message.parent_tool_use_id) {
          const { event } = message;
          if (event.type === 'message_start') streamedText = false;
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            streamedText = hasText = true;
            yield event.delta.text;
          }
        } else if (
          message.type === 'assistant' &&
          !message.parent_tool_use_id
        ) {
          if (message.error === 'authentication_failed')
            throw new Error(
              'Claude Code rejected its saved credentials. Sign in again with claude auth login.',
            );
          if (message.error && message.error !== 'max_output_tokens')
            throw new Error(
              'The Claude Code model returned an error (' +
                message.error +
                ').',
            );
          if (!streamedText) {
            for (const block of message.message.content) {
              if (block.type === 'text') {
                hasText = true;
                yield block.text;
              }
            }
          }
          streamedText = false;
        } else if (message.type === 'result') {
          if ('api_error_status' in message && message.api_error_status === 401)
            throw new Error(
              'Claude Code rejected its saved credentials. Sign in again with claude auth login.',
            );
          if (message.subtype !== 'success' || message.is_error)
            throw new Error(
              'Claude Code could not complete the response. Check its sign-in and try again.',
            );
          if (!hasText && message.result) yield message.result;
          return;
        }
      }
      throw new Error('Claude Code stopped before completing the response.');
    } finally {
      clearTimeout(timer);
      input.resolve(undefined);
      signal.removeEventListener('abort', stop);
      controller.abort();
      run?.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }
}
