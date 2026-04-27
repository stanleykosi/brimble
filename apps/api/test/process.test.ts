import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

import { runCommand } from '../src/utils/process.js';

function createChildProcessMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  return child;
}

describe('runCommand', () => {
  it('closes stdin and disables git terminal prompts for child commands', async () => {
    const child = createChildProcessMock();
    spawnMock.mockReturnValueOnce(child as never);

    const resultPromise = runCommand({
      command: 'git',
      args: ['clone', '--depth=1', 'https://github.com/example/repo', '/tmp/repo']
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth=1', 'https://github.com/example/repo', '/tmp/repo'],
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_TERMINAL_PROMPT: '0'
        }),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    );

    child.stdout.end('ok\n');
    child.stderr.end('warn\n');
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      code: 0,
      stdout: ['ok'],
      stderr: ['warn']
    });
  });
});
