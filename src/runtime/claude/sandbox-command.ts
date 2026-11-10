import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotWorkspace } from '../../workspace/workspace-files.js';

const timeoutMs = 60_000;
const maxOutput = 24_000;

// Linux x86-64 classic BPF. Reject alternate ABIs, socket creation and
// io_uring. The latter can perform socket operations outside this filter.
function socketFilter(): Buffer {
  const loadWord = 0x20;
  const jumpIfEqual = 0x15;
  const returnValue = 0x06;
  const instructions = [
    [loadWord, 0, 0, 4], // seccomp_data.arch
    [jumpIfEqual, 1, 0, 0xc000003e], // AUDIT_ARCH_X86_64
    [returnValue, 0, 0, 0x80000000], // KILL_PROCESS
    [loadWord, 0, 0, 0], // seccomp_data.nr
    [0x54, 0, 0, 0xbfffffff], // AND: normalize x32 syscall numbers
    [jumpIfEqual, 2, 0, 41], // socket
    [jumpIfEqual, 1, 0, 425], // io_uring_setup
    [returnValue, 0, 0, 0x7fff0000], // ALLOW
    [returnValue, 0, 0, 0x00050001], // ERRNO | EPERM
  ] as const;
  const filter = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, yes, no, value], index) => {
    const offset = index * 8;
    filter.writeUInt16LE(code, offset);
    filter.writeUInt8(yes, offset + 2);
    filter.writeUInt8(no, offset + 3);
    filter.writeUInt32LE(value, offset + 4);
  });
  return filter;
}

export async function runSandboxCommand(
  root: string,
  argv: string[],
  signal: AbortSignal,
): Promise<string> {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error(
      'Claude Code commands require the ResOS Linux x64 sandbox.',
    );
  const deadline = AbortSignal.timeout(timeoutMs);
  const stop = AbortSignal.any([signal, deadline]);
  const directory = await mkdtemp(join(tmpdir(), 'resos-command-'));
  try {
    const snapshot = join(directory, 'workspace');
    const filterPath = join(directory, 'seccomp.bpf');
    await mkdir(snapshot, { mode: 0o700 });
    await snapshotWorkspace(root, snapshot, stop);
    await writeFile(filterPath, socketFilter(), { flag: 'wx', mode: 0o600 });
    const filter = await open(filterPath, 'r');
    try {
      stop.throwIfAborted();
      const args = [
        '--unshare-all',
        '--unshare-user',
        '--disable-userns',
        '--die-with-parent',
        '--new-session',
        '--cap-drop',
        'ALL',
        '--dev',
        '/dev',
        '--size',
        String(512 * 1024 * 1024),
        '--tmpfs',
        '/tmp',
        '--ro-bind',
        '/usr',
        '/usr',
        '--symlink',
        'usr/bin',
        '/bin',
        '--symlink',
        'usr/lib',
        '/lib',
        '--symlink',
        'usr/lib64',
        '/lib64',
        '--ro-bind',
        snapshot,
        '/workspace',
        '--chdir',
        '/workspace',
        '--clearenv',
        '--setenv',
        'PATH',
        '/usr/bin:/bin',
        '--setenv',
        'HOME',
        '/tmp',
        '--setenv',
        'LANG',
        'C.UTF-8',
        '--seccomp',
        '3',
        '--',
        ...argv,
      ];
      const child = spawn('/usr/bin/bwrap', args, {
        cwd: '/',
        env: {},
        signal: stop,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'pipe', filter.fd],
      });
      return await new Promise<string>((resolve, reject) => {
        let startupError: Error | undefined;
        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8').on('data', (text: string) => {
          stdout = (stdout + text).slice(0, maxOutput + 1);
        });
        child.stderr?.setEncoding('utf8').on('data', (text: string) => {
          stderr = (stderr + text).slice(0, maxOutput + 1);
        });
        child.on('error', (error) => {
          startupError = error;
        });
        child.once('close', (code) => {
          if (stop.aborted) reject(stop.reason);
          else if (startupError)
            reject(
              new Error(
                'The command sandbox could not start. Check that Bubblewrap is installed.',
              ),
            );
          else
            resolve(
              JSON.stringify({
                exitCode: code,
                stdout: stdout.slice(0, maxOutput),
                stderr: stderr.slice(0, maxOutput),
                truncated:
                  stdout.length > maxOutput || stderr.length > maxOutput,
              }),
            );
        });
      });
    } finally {
      await filter.close();
    }
  } catch (error) {
    if (deadline.aborted && !signal.aborted)
      throw new Error('The command exceeded the 60-second sandbox limit.', {
        cause: error,
      });
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
