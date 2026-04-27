import type { DeploymentDetail, DeploymentEvent } from '@brimble/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PipelineService } from '../src/services/pipeline-service.js';
import { AppError } from '../src/utils/errors.js';

function createDeployment(id: string): DeploymentDetail {
  const now = new Date().toISOString();

  return {
    id,
    projectId: 'project_local',
    slug: id.replaceAll('_', '-'),
    sourceType: 'git',
    sourceGitUrl: 'https://github.com/example/repo',
    sourceArchiveFilename: null,
    sourceArchivePath: null,
    sourceRootPath: `/data/workspaces/${id}/src`,
    status: 'pending',
    substage: 'queued',
    statusReason: null,
    imageTag: null,
    containerName: null,
    containerId: null,
    routeMode: 'hostname',
    routeHost: `${id}.localhost`,
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

function createHarness(id: string) {
  const deployment = createDeployment(id);
  const events: DeploymentEvent[] = [];

  const appendEvent = (
    eventType: DeploymentEvent['eventType'],
    payload: DeploymentEvent['payload'],
    phase: DeploymentEvent['phase'],
    stream: DeploymentEvent['stream']
  ) => {
    events.push({
      sequence: events.length + 1,
      eventType,
      phase,
      stream,
      payload,
      createdAt: new Date().toISOString()
    });
  };

  const deploymentService = {
    getDeployment: () => ({ ...deployment }),
    updateDeployment: (_id: string, patch: Partial<DeploymentDetail>) => {
      Object.assign(deployment, patch, {
        updatedAt: patch.updatedAt ?? new Date().toISOString()
      });
      return { ...deployment };
    },
    setSubstage: (_id: string, substage: DeploymentDetail['substage'], reason: string | null = null) => {
      deployment.substage = substage;
      deployment.statusReason = reason;
      deployment.updatedAt = new Date().toISOString();
      appendEvent(
        'status',
        {
          fromStatus: deployment.status,
          toStatus: deployment.status,
          substage,
          reason
        },
        null,
        null
      );
      return { ...deployment };
    },
    transitionStatus: (
      _id: string,
      nextStatus: DeploymentDetail['status'],
      options: { substage: DeploymentDetail['substage']; reason?: string | null; patch?: Partial<DeploymentDetail> }
    ) => {
      const previousStatus = deployment.status;
      deployment.status = nextStatus;
      deployment.substage = options.substage;
      deployment.statusReason = nextStatus === 'failed' ? options.reason ?? 'Deployment failed' : null;
      deployment.updatedAt = new Date().toISOString();

      if (options.patch) {
        Object.assign(deployment, options.patch);
      }

      if (nextStatus === 'running') {
        deployment.runningAt = deployment.runningAt ?? new Date().toISOString();
      }

      if (nextStatus === 'failed') {
        deployment.failedAt = deployment.failedAt ?? new Date().toISOString();
        deployment.liveUrl = null;
      }

      appendEvent(
        'status',
        {
          fromStatus: previousStatus,
          toStatus: nextStatus,
          substage: options.substage,
          reason: options.reason ?? null
        },
        null,
        null
      );

      return { ...deployment };
    },
    forceFail: (_id: string, reason: string, substage: DeploymentDetail['substage'] = 'cleanup') => {
      deployment.status = 'failed';
      deployment.substage = substage;
      deployment.statusReason = reason;
      deployment.liveUrl = null;
      deployment.failedAt = deployment.failedAt ?? new Date().toISOString();
      deployment.updatedAt = new Date().toISOString();

      appendEvent(
        'status',
        {
          fromStatus: 'deploying',
          toStatus: 'failed',
          substage,
          reason
        },
        null,
        null
      );

      return { ...deployment };
    },
    computeLiveUrl: (current: DeploymentDetail) => `http://${current.routeHost}:8080/`
  };

  const deploymentEventService = {
    appendSystem: (
      _deploymentId: string,
      code: string,
      message: string,
      phase: DeploymentEvent['phase'],
      data?: Record<string, unknown>
    ) => {
      appendEvent('system', { code, message, ...(data ? { data } : {}) }, phase, 'meta');
    },
    appendLog: (
      _deploymentId: string,
      phase: DeploymentEvent['phase'],
      stream: 'stdout' | 'stderr' | 'meta',
      payload: { message: string; chunk?: boolean }
    ) => {
      appendEvent('log', { message: payload.message, chunk: payload.chunk ?? false }, phase, stream);
    },
    appendStatus: (
      _deploymentId: string,
      payload: {
        fromStatus: DeploymentDetail['status'] | null;
        toStatus: DeploymentDetail['status'];
        substage: DeploymentDetail['substage'];
        reason: string | null;
      }
    ) => {
      appendEvent('status', payload, null, null);
    },
    list: () => [...events]
  };

  return {
    deployment,
    deploymentService,
    deploymentEventService
  };
}

describe('PipelineService workspace cleanup', () => {
  it('cleans the workspace after a successful deployment reaches running state', async () => {
    const harness = createHarness('dep_success');
    const cleanupWorkspace = vi.fn(async () => {});

    const service = new PipelineService(
      harness.deploymentService as never,
      harness.deploymentEventService as never,
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

    const runningDeployment = await service.processDeployment(harness.deployment.id);

    expect(runningDeployment.status).toBe('running');
    expect(cleanupWorkspace).toHaveBeenCalledWith(harness.deployment.id);
  });

  it('records the primary failure and still attempts workspace cleanup during failure handling', async () => {
    const harness = createHarness('dep_failure');
    const cleanupWorkspace = vi.fn(async () => {});
    let applyRoutesCalls = 0;

    const service = new PipelineService(
      harness.deploymentService as never,
      harness.deploymentEventService as never,
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
        captureRuntimeLogTail: async () => ['runtime tail'],
        stopAndRemoveContainer: async () => {}
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

    await expect(service.processDeployment(harness.deployment.id)).rejects.toMatchObject({
      code: 'CADDY_LOAD_FAILED',
      message: 'primary caddy route load failed'
    });

    expect(harness.deployment.status).toBe('failed');
    expect(harness.deployment.statusReason).toBe('primary caddy route load failed');
    expect(cleanupWorkspace).toHaveBeenCalledWith(harness.deployment.id);
    expect(
      harness.deploymentEventService.list().some(
        (event) =>
          event.eventType === 'system' &&
          'code' in event.payload &&
          event.payload.code === 'CADDY_ROUTE_CLEANUP_FAILED'
      )
    ).toBe(true);
  });
});
