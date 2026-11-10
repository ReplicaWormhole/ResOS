import { EventEmitter, on } from 'node:events';
import type {
  ChatRequest,
  ChatRuntime,
  RuntimeControls,
} from '../chat-runtime.js';
import { formatInitialInput } from '../../notebook/prepare-context.js';
import type { HarnessModel } from '../../shared/notebook-api.js';
import {
  validSettingId,
  validateModelSelection,
} from '../../shared/run-settings.js';
import { codexModels } from './model-catalog.js';
import { object, StdioRpc } from './stdio-rpc.js';

const approvalMethods = new Map([
  ['item/commandExecution/requestApproval', 'Command execution'],
  ['item/fileChange/requestApproval', 'File changes'],
  ['item/permissions/requestApproval', 'Additional permissions'],
]);

const notebookTool = {
  type: 'function',
  name: 'resos_search_notebook',
  description:
    'Search recent saved message revisions in the current ResOS project. Returns short excerpts and their source IDs. Does not read files or notes.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Literal phrase to search for' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

const disabledFeatures = [
  'apps',
  'hooks',
  'plugins',
  'remote_plugin',
  'skill_mcp_dependency_install',
  'multi_agent',
  'in_app_browser',
  'in_app_local_automation',
];

const scopedOverrides = [
  ...disabledFeatures.map((feature) => 'features.' + feature + '=false'),
  'web_search="disabled"',
];

export class CodexRuntime implements ChatRuntime {
  readonly supportsNotebookLookup = true;
  private readonly clients = new Set<StdioRpc>();

  constructor(
    private readonly executable: string,
    private readonly clientVersion = 'dev',
  ) {}

  close(): void {
    for (const client of this.clients) client.close();
  }

  private async connect(
    cwd: string,
    overrides: readonly string[],
    experimental: boolean,
    signal?: AbortSignal,
  ): Promise<StdioRpc> {
    signal?.throwIfAborted();
    const client = new StdioRpc(this.executable, cwd, overrides);
    this.clients.add(client);
    const cancel = () => client.close();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await client.call('initialize', {
        ...(experimental ? { capabilities: { experimentalApi: true } } : {}),
        clientInfo: {
          name: 'resos',
          title: 'ResOS',
          version: this.clientVersion,
        },
      });
      client.notify('initialized');
      return client;
    } catch (error) {
      this.disconnect(client);
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  private disconnect(client: StdioRpc): void {
    this.clients.delete(client);
    client.close();
  }

  async listModels(cwd: string): Promise<HarnessModel[]> {
    const client = await this.connect(cwd, scopedOverrides, false);
    try {
      return await codexModels(client);
    } finally {
      this.disconnect(client);
    }
  }

  private async scopedClient(
    cwd: string,
    controls: RuntimeControls,
  ): Promise<StdioRpc> {
    const experimental = !!controls.lookupNotebook;
    const open = (overrides: readonly string[]) =>
      this.connect(cwd, overrides, experimental, controls.signal);
    let client = await open(controls.settings ? scopedOverrides : []);
    if (!controls.settings) return client;
    const cancel = () => client.close();
    controls.signal.addEventListener('abort', cancel, { once: true });
    try {
      const read = async () =>
        object((await client.call('config/read', { cwd })).config);
      const enabledMcp = (config: Record<string, unknown>) =>
        Object.entries(object(config.mcp_servers))
          .filter(([, value]) => object(value).enabled !== false)
          .map(([name]) => name);
      let config = await read();
      const servers = enabledMcp(config);
      if (servers.length) {
        if (servers.some((name) => !/^[A-Za-z0-9_-]+$/.test(name)))
          throw new Error(
            'Codex has an MCP server name that cannot be disabled safely.',
          );
        this.disconnect(client);
        client = await open([
          ...scopedOverrides,
          ...servers.map((name) => 'mcp_servers.' + name + '.enabled=false'),
        ]);
        config = await read();
      }
      const features = object(config.features);
      if (
        config.web_search !== 'disabled' ||
        disabledFeatures.some((feature) => features[feature] !== false) ||
        enabledMcp(config).length
      ) {
        throw new Error(
          'Codex could not verify that external tools are disabled for this scoped run.',
        );
      }
      return client;
    } catch (error) {
      this.disconnect(client);
      throw error;
    } finally {
      controls.signal.removeEventListener('abort', cancel);
    }
  }

  async *stream(
    request: ChatRequest,
    controls: RuntimeControls,
  ): AsyncGenerator<string> {
    controls.signal.throwIfAborted();
    const client = await this.scopedClient(request.cwd, controls);
    const ask = controls.settings?.mode === 'ask';
    const approvalPolicy = ask ? 'never' : 'on-request';
    const events = new EventEmitter();
    const notifications = on(events, 'message');
    let threadId: string | undefined;
    let turnId: string | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const output = new Map<string, string>();
    const fileChanges = new Map<string, string>();
    const requests = new Map<string | number, AbortController>();

    function stop(): void {
      if (!threadId || !turnId) {
        client.close();
        return;
      }
      void client
        .call('turn/interrupt', { threadId, turnId })
        .catch(() => client.close());
      stopTimer = setTimeout(() => client.close(), 3000);
    }
    controls.signal.addEventListener('abort', stop, { once: true });
    client.on('closed', (error: Error) =>
      events.emit('message', 'closed', { error }),
    );
    client.on(
      'notification',
      (method: string, params: Record<string, unknown>) => {
        if (!threadId || params.threadId !== threadId) return;
        if (method === 'item/started') {
          const item = object(params.item);
          if (
            item.type === 'fileChange' &&
            typeof item.id === 'string' &&
            Array.isArray(item.changes)
          ) {
            fileChanges.set(item.id, JSON.stringify(item.changes, null, 2));
          }
        }
        if (
          method === 'serverRequest/resolved' &&
          (typeof params.requestId === 'number' ||
            typeof params.requestId === 'string')
        ) {
          requests.get(params.requestId)?.abort();
        }
        if (method === 'turn/started') {
          const id = object(params.turn).id;
          if (typeof id === 'string') turnId ??= id;
        }
        events.emit('message', method, params);
      },
    );
    client.on(
      'request',
      (
        id: string | number,
        method: string,
        params: Record<string, unknown>,
      ) => {
        if (method === 'item/tool/call') {
          const lookup = controls.lookupNotebook;
          const { query } = object(params.arguments);
          const respond = (success: boolean, text: string) => {
            if (!closed && !controls.signal.aborted)
              client.respond(id, {
                success,
                contentItems: [{ type: 'inputText', text }],
              });
          };
          if (
            !lookup ||
            !threadId ||
            !turnId ||
            params.threadId !== threadId ||
            params.turnId !== turnId ||
            params.tool !== notebookTool.name ||
            params.namespace != null ||
            typeof query !== 'string'
          ) {
            respond(false, 'Notebook lookup is unavailable for this request.');
            return;
          }
          void lookup(query).then(
            (matches) => respond(true, JSON.stringify(matches)),
            () =>
              respond(
                false,
                'Notebook lookup could not complete. Check the query and the per-run limit.',
              ),
          );
          return;
        }
        const kind = approvalMethods.get(method);
        if (!kind) {
          client.unsupported(id);
          return;
        }
        const scope =
          params.threadId === threadId &&
          !!threadId &&
          typeof params.turnId === 'string' &&
          (!turnId || params.turnId === turnId);
        const permissions = Object.fromEntries(
          Object.entries(object(params.permissions)).filter(
            ([, value]) => value != null,
          ),
        );
        const changes =
          typeof params.itemId === 'string'
            ? fileChanges.get(params.itemId)
            : undefined;
        const detail = [
          typeof params.reason === 'string' ? params.reason : '',
          typeof params.command === 'string' ? params.command : '',
          typeof params.cwd === 'string'
            ? 'Working directory: ' + params.cwd
            : '',
          typeof params.grantRoot === 'string'
            ? 'Requested root: ' + params.grantRoot
            : '',
          params.networkApprovalContext
            ? JSON.stringify(params.networkApprovalContext)
            : '',
          params.permissions ? JSON.stringify(permissions) : '',
          changes ?? '',
        ]
          .filter(Boolean)
          .join('\n');
        // Only expose approval when a concrete action or scope is available for review.
        const reviewable = !!(
          params.command ||
          params.networkApprovalContext ||
          params.permissions ||
          params.grantRoot ||
          changes
        );
        const expires = new AbortController();
        requests.set(id, expires);
        const decide =
          !ask && scope && reviewable && !controls.signal.aborted
            ? controls.approve({ kind, detail }, expires.signal)
            : Promise.resolve(false);
        void decide
          .catch(() => false)
          .then((accept) => {
            requests.delete(id);
            if (closed || expires.signal.aborted) return;
            accept &&= !controls.signal.aborted;
            if (method === 'item/permissions/requestApproval') {
              client.respond(id, {
                permissions: accept ? permissions : {},
                scope: 'turn',
              });
            } else {
              client.respond(id, { decision: accept ? 'accept' : 'decline' });
            }
          });
      },
    );

    try {
      controls.signal.throwIfAborted();
      const settings = controls.settings;
      if (settings?.model)
        validateModelSelection(await codexModels(client), settings);
      const started = await client.call('thread/start', {
        cwd: request.cwd,
        sandbox: ask ? 'read-only' : 'workspace-write',
        approvalPolicy,
        ...(settings?.model ? { model: settings.model } : {}),
        ...(settings?.effort
          ? { config: { model_reasoning_effort: settings.effort } }
          : {}),
        approvalsReviewer: 'user',
        ephemeral: true,
        ...(controls.lookupNotebook ? { dynamicTools: [notebookTool] } : {}),
      });
      const id = object(started.thread).id;
      if (typeof id !== 'string')
        throw new Error('Codex did not return a thread ID.');
      threadId = id;
      const effective = {
        ...(validSettingId(started.model) ? { model: started.model } : {}),
        ...(validSettingId(started.reasoningEffort)
          ? { effort: started.reasoningEffort }
          : {}),
      };
      if (
        settings &&
        (started.approvalPolicy !== approvalPolicy ||
          started.cwd !== request.cwd ||
          object(started.sandbox).type !==
            (ask ? 'readOnly' : 'workspaceWrite'))
      )
        throw new Error(
          'Codex did not confirm the requested workspace and permissions.',
        );
      if (
        (settings?.model && effective.model !== settings.model) ||
        (settings?.effort && effective.effort !== settings.effort)
      )
        throw new Error(
          'Codex did not confirm the requested model or reasoning effort. Refresh the catalog and start a new run.',
        );
      const turn = await client.call('turn/start', {
        threadId,
        cwd: request.cwd,
        approvalPolicy,
        approvalsReviewer: 'user',
        ...(settings?.model ? { model: settings.model } : {}),
        ...(settings?.effort ? { effort: settings.effort } : {}),
        sandboxPolicy: ask
          ? { type: 'readOnly', networkAccess: false }
          : {
              type: 'workspaceWrite',
              writableRoots: [request.cwd],
              networkAccess: false,
              excludeTmpdirEnvVar: true,
              excludeSlashTmp: true,
            },
        input: [
          {
            type: 'text',
            text:
              controls.initialInput ??
              formatInitialInput(request, !!controls.lookupNotebook),
            text_elements: [],
          },
        ],
      });
      const startedTurnId = object(turn.turn).id;
      if (typeof startedTurnId !== 'string')
        throw new Error('Codex did not return a turn ID.');
      turnId = startedTurnId;
      await controls.identify?.(
        threadId,
        turnId,
        effective.model || effective.effort ? effective : undefined,
      );
      for await (const [method, raw] of notifications) {
        const params = object(raw);
        if (method === 'closed') throw params.error;
        if (method === 'turn/completed') {
          const completed = object(params.turn);
          if (completed.id !== turnId) continue;
          if (completed.status === 'completed') return;
          if (completed.status === 'interrupted')
            throw new DOMException('Response interrupted.', 'AbortError');
          throw new Error(
            String(object(completed.error).message ?? 'The Codex turn failed.'),
          );
        }
        if (params.turnId !== turnId) continue;
        const item = object(params.item);
        const delta =
          method === 'item/agentMessage/delta' &&
          typeof params.delta === 'string'
            ? { id: params.itemId, text: params.delta }
            : method === 'item/completed' &&
                item.type === 'agentMessage' &&
                typeof item.text === 'string' &&
                !output.has(String(item.id))
              ? { id: item.id, text: item.text }
              : undefined;
        if (delta?.text && typeof delta.id === 'string') {
          const previous = output.get(delta.id);
          const separator = previous === undefined && output.size ? '\n\n' : '';
          output.set(delta.id, (previous ?? '') + delta.text);
          yield separator + delta.text;
        }
      }
    } finally {
      closed = true;
      for (const pending of requests.values()) pending.abort();
      clearTimeout(stopTimer);
      controls.signal.removeEventListener('abort', stop);
      await notifications.return?.();
      this.disconnect(client);
    }
  }
}
