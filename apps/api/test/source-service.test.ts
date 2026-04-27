import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SourceService, getZipEntryPermissions } from '../src/services/source-service.js';
import { createTestConfig } from './helpers.js';

describe('getZipEntryPermissions', () => {
  it('preserves executable permission bits from zip metadata', () => {
    const executableScriptMode = 0o100755 << 16;

    expect(getZipEntryPermissions(executableScriptMode)).toBe(0o755);
  });

  it('returns null when a zip entry does not expose unix permission bits', () => {
    expect(getZipEntryPermissions(0)).toBeNull();
  });
});

describe('SourceService.cleanupWorkspace', () => {
  it('removes deployment workspaces when KEEP_WORKSPACES is false', async () => {
    const { config, cleanup } = await createTestConfig();

    try {
      config.KEEP_WORKSPACES = false;
      const service = new SourceService(config, {} as never);
      const workspaceRoot = path.join(config.STORAGE_ROOT, 'workspaces', 'dep_cleanup');

      await mkdir(workspaceRoot, { recursive: true });
      await writeFile(path.join(workspaceRoot, 'artifact.txt'), 'artifact');

      await service.cleanupWorkspace('dep_cleanup');

      await expect(writeFile(path.join(workspaceRoot, 'artifact.txt'), 'artifact')).rejects.toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('preserves deployment workspaces when KEEP_WORKSPACES is true', async () => {
    const { config, cleanup } = await createTestConfig();

    try {
      config.KEEP_WORKSPACES = true;
      const service = new SourceService(config, {} as never);
      const workspaceRoot = path.join(config.STORAGE_ROOT, 'workspaces', 'dep_keep');
      const artifactPath = path.join(workspaceRoot, 'artifact.txt');

      await mkdir(workspaceRoot, { recursive: true });
      await writeFile(artifactPath, 'artifact');

      await service.cleanupWorkspace('dep_keep');

      await expect(writeFile(artifactPath, 'still-here')).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
