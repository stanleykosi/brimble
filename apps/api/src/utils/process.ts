import { spawn } from 'node:child_process';

import stripAnsi from 'strip-ansi';

import { AppError } from './errors.js';

export interface CommandResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

export interface CommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdoutLine?: (line: string) => void | Promise<void>;
  onStderrLine?: (line: string) => void | Promise<void>;
}

function createLineCollector(
  sink: string[],
  callback?: (line: string) => void | Promise<void>
): {
  collect: (chunk: Buffer) => void;
  flush: () => void;
} {
  let buffer = '';

  const emitLine = (line: string) => {
    sink.push(line);
    void callback?.(line);
  };

  return {
    collect: (chunk: Buffer) => {
    buffer += stripAnsi(chunk.toString('utf8'));

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      emitLine(line);
    }
    },
    flush: () => {
      if (buffer.length > 0) {
        emitLine(buffer);
        buffer = '';
      }
    }
  };
}

export async function runCommand(options: CommandOptions): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const collectStdout = createLineCollector(stdout, options.onStdoutLine);
    const collectStderr = createLineCollector(stderr, options.onStderrLine);

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...options.env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      collectStdout.collect(chunk);
    });

    child.stderr.on('data', (chunk) => {
      collectStderr.collect(chunk);
    });

    child.on('error', (error) => {
      reject(
        new AppError({
          code: 'VALIDATION_ERROR',
          message: `Failed to start command: ${options.command}`,
          cause: error
        })
      );
    });

    child.on('close', (code) => {
      collectStdout.flush();
      collectStderr.flush();
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}
