import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { delimiter, dirname, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';

type JsonObject = Record<string, unknown>;
type RpcId = string | number;

export function object(value: unknown): JsonObject {
  return value && typeof value === 'object' ? (value as JsonObject) : {};
}

export class StdioRpc extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    (error?: Error, result?: JsonObject) => void
  >();
  private nextId = 0;
  private failure?: Error;

  constructor(executable: string, cwd: string) {
    super();
    this.child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd,
      env: isAbsolute(executable)
        ? {
            ...process.env,
            PATH: [dirname(executable), process.env.PATH]
              .filter(Boolean)
              .join(delimiter),
          }
        : process.env,
      detached: true,
      stdio: 'pipe',
    });
    this.child.on('error', (error) =>
      this.fail(
        new Error(
          'Could not start Codex. Install the Codex CLI on PATH or set RESOS_CODEX_BIN. ' +
            error.message,
        ),
      ),
    );
    this.child.on('close', (code, signal) =>
      this.fail(
        new Error('Codex app-server exited (' + (signal ?? code) + ').'),
      ),
    );
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on(
      'line',
      (line) => {
        let message: JsonObject;
        try {
          message = object(JSON.parse(line));
        } catch {
          this.fail(new Error('Codex returned invalid JSON.'));
          return;
        }
        if (this.failure) return;
        const { id, method } = message;
        if (typeof method === 'string') {
          const params = object(message.params);
          if (typeof id === 'string' || typeof id === 'number')
            this.emit('request', id, method, params);
          else this.emit('notification', method, params);
        } else if (typeof id === 'number') {
          const settle = this.pending.get(id);
          if (!settle) return;
          const error = object(message.error);
          if (message.error)
            settle(new Error(String(error.message ?? 'Codex request failed.')));
          else settle(undefined, object(message.result));
        }
      },
    );
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const settle of this.pending.values()) settle(error);
    this.emit('closed', error);
  }

  private send(message: JsonObject): void {
    if (!this.failure) this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  call(method: string, params: JsonObject): Promise<JsonObject> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex did not acknowledge ' + method + '.'));
      }, 30_000);
      this.pending.set(id, (error, result) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(error);
        else resolve(result!);
      });
      this.send({ id, method, params });
    });
  }

  notify(method: string): void {
    this.send({ method, params: {} });
  }

  respond(id: RpcId, result: JsonObject): void {
    this.send({ id, result });
  }

  unsupported(id: RpcId): void {
    this.send({
      id,
      error: {
        code: -32601,
        message: 'This client does not support this request.',
      },
    });
  }

  close(): void {
    this.fail(new Error('Codex connection closed.'));
    if (
      this.child.pid &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    ) {
      try {
        process.kill(-this.child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }
}
