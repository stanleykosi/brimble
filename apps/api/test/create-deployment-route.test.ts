import path from 'node:path';

import { FormData, File } from 'formdata-node';
import type { DeploymentDetail } from '@brimble/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/env.js';
import { createTestConfig, encodeFormData } from './helpers.js';

const { moveFileMock } = vi.hoisted(() => ({
  moveFileMock: vi.fn()
}));

vi.mock('../src/utils/filesystem.js', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/filesystem.js')>(
    '../src/utils/filesystem.js'
  );

  moveFileMock.mockImplementation(actual.moveFile);

  return {
    ...actual,
    moveFile: moveFileMock
  };
});

import { buildApp, type ApiContext } from '../src/app.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  moveFileMock.mockReset();
  const actual = await vi.importActual<typeof import('../src/utils/filesystem.js')>(
    '../src/utils/filesystem.js'
  );
  moveFileMock.mockImplementation(actual.moveFile);

  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

function createPlannedDeployment(config: AppConfig): DeploymentDetail {
  const now = new Date().toISOString();

  return {
    id: 'dep_testarchive',
    projectId: 'project_local',
    slug: 'dep-testarchive',
    sourceType: 'archive',
    sourceGitUrl: null,
    sourceArchiveFilename: 'sample.tgz',
    sourceArchivePath: null,
    sourceRootPath: path.join(config.STORAGE_ROOT, 'workspaces', 'dep_testarchive', 'src'),
    status: 'pending',
    substage: 'queued',
    statusReason: null,
    imageTag: null,
    containerName: null,
    containerId: null,
    routeMode: 'hostname',
    routeHost: 'dep-testarchive.localhost',
    routePath: null,
    liveUrl: null,
    internalPort: null,
    railpackPlanPath: null,
    railpackInfoPath: null,
    buildStartedAt: null,
    buildFinishedAt: null,
    deployStartedAt: null,
    deployFinishedAt: null,
    runningAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

async function createRouteTestApp() {
  const { config, cleanup } = await createTestConfig();
  cleanups.push(cleanup);

  const deploymentService = {
    listDeployments: vi.fn(() => []),
    getDeployment: vi.fn(),
    planPendingDeployment: vi.fn(() => createPlannedDeployment(config)),
    persistPendingDeployment: vi.fn(
      (deployment: Parameters<ApiContext['deploymentService']['persistPendingDeployment']>[0]) =>
        deployment
    )
  } satisfies ApiContext['deploymentService'];
  const queueService = {
    kick: vi.fn()
  } satisfies ApiContext['queueService'];
  const app = await buildApp({
    config,
    deploymentService,
    deploymentEventService: {
      getLatestSequence: () => 0,
      list: () => [],
      subscribe: () => () => {}
    } satisfies ApiContext['deploymentEventService'],
    queueService
  });

  cleanups.push(async () => {
    await app.close();
  });

  return {
    app,
    deploymentService,
    queueService
  };
}

describe('create deployment route', () => {
  it('does not persist or queue archive deployments when storing the uploaded archive fails', async () => {
    const { app, deploymentService, queueService } = await createRouteTestApp();
    moveFileMock.mockRejectedValueOnce(new Error('disk full'));

    const formData = new FormData();
    formData.set('sourceType', 'archive');
    formData.set(
      'archiveFile',
      new File([Buffer.from('hello')], 'sample.tgz', {
        type: 'application/gzip'
      })
    );

    const encoded = encodeFormData(formData);
    const response = await app.inject({
      method: 'POST',
      url: '/api/deployments',
      headers: encoded.headers,
      payload: encoded.payload
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toBe('disk full');
    expect(deploymentService.planPendingDeployment).toHaveBeenCalledTimes(1);
    expect(deploymentService.persistPendingDeployment).not.toHaveBeenCalled();
    expect(queueService.kick).not.toHaveBeenCalled();
  });
});
