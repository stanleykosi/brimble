import { describe, expect, it, vi } from 'vitest';

import { PipelineService } from '../src/services/pipeline-service.js';
import { AppError } from '../src/utils/errors.js';
import { createGitPendingDeploymentInput, createTestRepositories } from './helpers.js';

describe('PipelineService', () => {
  it('records a terminal failure before route cleanup retries and preserves the original error', async () => {
    const repos = await createTestRepositories();

    try {
      const deployment = repos.deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

      let applyRoutesCalls = 0;
      const captureRuntimeLogTail = vi.fn(async () => ['runtime tail']);
      const stopAndRemoveContainer = vi.fn(async () => {});
      const cleanupWorkspace = vi.fn(async () => {});

      const service = new PipelineService(
        repos.deploymentService,
        repos.deploymentEventService,
        {
          acquireSource: async () => '/tmp/source',
          cleanupWorkspace
        } as never,
        {
          prepare: async () => ({
            planPath: '/tmp/railpack-plan.json',
            infoPath: '/tmp/railpack-info.json'
          }),
          buildImage: async () => 'ghcr.io/brimble/test:latest'
        } as never,
        {
          startContainer: async () => ({
            containerName: 'brimble-test-container',
            containerId: 'container-123',
            internalPort: 3000
          }),
          captureRuntimeLogTail,
          stopAndRemoveContainer
        } as never,
        {
          applyRoutes: async () => {
            applyRoutesCalls += 1;
            throw new AppError({
              code: 'CADDY_LOAD_FAILED',
              message:
                applyRoutesCalls === 1 ? 'primary caddy route load failed' : 'cleanup caddy route load failed'
            });
          },
          waitForDeployment: async () => {}
        } as never
      );

      await expect(service.processDeployment(deployment.id)).rejects.toMatchObject({
        code: 'CADDY_LOAD_FAILED',
        message: 'primary caddy route load failed'
      });

      const failedDeployment = repos.deploymentService.getDeployment(deployment.id);
      expect(failedDeployment.status).toBe('failed');
      expect(failedDeployment.statusReason).toBe('primary caddy route load failed');
      expect(failedDeployment.failedAt).not.toBeNull();
      expect(failedDeployment.liveUrl).toBeNull();

      expect(captureRuntimeLogTail).toHaveBeenCalledWith('brimble-test-container');
      expect(stopAndRemoveContainer).toHaveBeenCalledWith('brimble-test-container');
      expect(cleanupWorkspace).toHaveBeenCalledWith(deployment.id);

      const systemEvents = repos.deploymentEventService
        .list(deployment.id)
        .filter((event) => event.eventType === 'system');

      expect(
        systemEvents.some(
          (event) =>
            'code' in event.payload &&
            event.payload.code === 'CADDY_LOAD_FAILED' &&
            event.payload.message === 'primary caddy route load failed'
        )
      ).toBe(true);
      expect(
        systemEvents.some(
          (event) =>
            'code' in event.payload &&
            event.payload.code === 'CADDY_ROUTE_CLEANUP_FAILED' &&
            event.payload.message === 'Failed to rebuild Caddy routes during failure cleanup'
        )
      ).toBe(true);
    } finally {
      await repos.cleanup();
    }
  });

  it('cleans the workspace after a successful deployment reaches running state', async () => {
    const repos = await createTestRepositories();

    try {
      const deployment = repos.deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

      const cleanupWorkspace = vi.fn(async () => {});

      const service = new PipelineService(
        repos.deploymentService,
        repos.deploymentEventService,
        {
          acquireSource: async () => '/tmp/source',
          cleanupWorkspace
        } as never,
        {
          prepare: async () => ({
            planPath: '/tmp/railpack-plan.json',
            infoPath: '/tmp/railpack-info.json'
          }),
          buildImage: async () => 'ghcr.io/brimble/test:latest'
        } as never,
        {
          startContainer: async () => ({
            containerName: 'brimble-test-container',
            containerId: 'container-123',
            internalPort: 3000
          })
        } as never,
        {
          applyRoutes: async () => {},
          waitForDeployment: async () => {}
        } as never
      );

      const runningDeployment = await service.processDeployment(deployment.id);

      expect(runningDeployment.status).toBe('running');
      expect(cleanupWorkspace).toHaveBeenCalledWith(deployment.id);
    } finally {
      await repos.cleanup();
    }
  });

  it('clears the live URL when a deployment is forced into failed state', async () => {
    const repos = await createTestRepositories();

    try {
      const deployment = repos.deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

      repos.deploymentService.transitionStatus(deployment.id, 'building', {
        substage: 'source_fetching'
      });
      repos.deploymentService.transitionStatus(deployment.id, 'deploying', {
        substage: 'container_starting'
      });
      repos.deploymentService.transitionStatus(deployment.id, 'running', {
        substage: 'complete',
        patch: {
          liveUrl: 'http://dep-test.localhost:8080/'
        }
      });

      const failedDeployment = repos.deploymentService.forceFail(deployment.id, 'deployment failed after startup');

      expect(failedDeployment.status).toBe('failed');
      expect(failedDeployment.liveUrl).toBeNull();
      expect(failedDeployment.statusReason).toBe('deployment failed after startup');
    } finally {
      await repos.cleanup();
    }
  });
});
