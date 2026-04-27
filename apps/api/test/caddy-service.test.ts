import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeploymentDetail } from '@brimble/contracts';

import { CaddyService } from '../src/services/caddy-service.js';
import { createTestConfig } from './helpers.js';

function createDeployment(overrides: Partial<DeploymentDetail> = {}): DeploymentDetail {
  return {
    id: 'dep_test',
    projectId: 'project_local',
    slug: 'dep-test',
    sourceType: 'git',
    sourceGitUrl: 'https://github.com/example/repo',
    sourceArchiveFilename: null,
    sourceArchivePath: null,
    sourceRootPath: '/data/workspaces/dep_test/src',
    status: 'deploying',
    substage: 'health_checking',
    statusReason: null,
    imageTag: 'brimble-local/local:dep-test',
    containerName: 'brimble-app-dep-test',
    containerId: 'container-test',
    routeMode: 'hostname',
    routeHost: 'dep-test.localhost',
    routePath: null,
    liveUrl: null,
    internalPort: 3000,
    railpackPlanPath: null,
    railpackInfoPath: null,
    buildStartedAt: null,
    buildFinishedAt: null,
    deployStartedAt: null,
    deployFinishedAt: null,
    runningAt: null,
    failedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('CaddyService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('probes path-mode deployments with the configured ingress Host header', async () => {
    const context = await createTestConfig();

    try {
      const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
      global.fetch = fetchMock as typeof fetch;

      const service = new CaddyService(
        {
          ...context.config,
          CONTROL_PLANE_PUBLIC_URL: 'https://control.example.com'
        },
        {} as never
      );

      await service.waitForDeployment({
        id: 'dep_path',
        projectId: 'project_local',
        slug: 'dep-path',
        sourceType: 'archive',
        sourceGitUrl: null,
        sourceArchiveFilename: 'sample.tgz',
        sourceArchivePath: '/data/uploads/dep_path/sample.tgz',
        sourceRootPath: '/data/workspaces/dep_path/src',
        status: 'deploying',
        substage: 'health_checking',
        statusReason: null,
        imageTag: 'brimble-local/local:dep-path',
        containerName: 'brimble-app-dep-path',
        containerId: 'abc123',
        routeMode: 'path',
        routeHost: null,
        routePath: '/apps/dep-path',
        liveUrl: null,
        internalPort: 3000,
        railpackPlanPath: null,
        railpackInfoPath: null,
        buildStartedAt: null,
        buildFinishedAt: null,
        deployStartedAt: null,
        deployFinishedAt: null,
        runningAt: null,
        failedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://caddy/apps/dep-path/healthz',
        expect.objectContaining({
          headers: {
            Host: 'control.example.com'
          }
        })
      );
    } finally {
      await context.cleanup();
    }
  });

  it('treats non-5xx HTTP responses from Caddy as ingress reachability success', async () => {
    const context = await createTestConfig();

    try {
      const fetchMock = vi.fn(async () => new Response('missing health endpoint', { status: 404 }));
      global.fetch = fetchMock as typeof fetch;

      const service = new CaddyService(context.config, {} as never);

      await expect(
        service.waitForDeployment(
          createDeployment({
            id: 'dep_http_response',
            slug: 'dep-http-response',
            routeHost: 'dep-http-response.localhost'
          })
        )
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await context.cleanup();
    }
  });

  it('keeps probing when Caddy returns proxy failure statuses', async () => {
    const context = await createTestConfig();

    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));
      global.fetch = fetchMock as typeof fetch;

      const service = new CaddyService(context.config, {} as never);

      await expect(
        service.waitForDeployment(
          createDeployment({
            id: 'dep_proxy_retry',
            slug: 'dep-proxy-retry',
            routeHost: 'dep-proxy-retry.localhost'
          })
        )
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await context.cleanup();
    }
  });

  it('times out when Caddy keeps returning proxy failure statuses', async () => {
    const context = await createTestConfig();

    try {
      const fetchMock = vi.fn(async () => new Response('service unavailable', { status: 503 }));
      global.fetch = fetchMock as typeof fetch;

      const service = new CaddyService(
        {
          ...context.config,
          DEPLOY_HEALTHCHECK_INTERVAL_MS: 1,
          DEPLOY_HEALTHCHECK_TIMEOUT_MS: 1
        },
        {} as never
      );

      await expect(
        service.waitForDeployment(
          createDeployment({
            id: 'dep_proxy_timeout',
            slug: 'dep-proxy-timeout',
            routeHost: 'dep-proxy-timeout.localhost'
          })
        )
      ).rejects.toMatchObject({
        code: 'HEALTHCHECK_TIMEOUT'
      });

      expect(fetchMock).toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it('wraps caddy load transport failures with CADDY_LOAD_FAILED', async () => {
    const context = await createTestConfig();

    try {
      global.fetch = vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:2019');
      }) as typeof fetch;

      const service = new CaddyService(context.config, {
        listByStatuses: () => []
      } as never);

      await expect(service.applyRoutes()).rejects.toMatchObject({
        code: 'CADDY_LOAD_FAILED',
        message: 'Failed to load desired Caddy config'
      });
    } finally {
      await context.cleanup();
    }
  });

  it('keeps deploying and running deployments in caddy reloads', async () => {
    const context = await createTestConfig();

    try {
      const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
        return new Response(init?.body ?? '', { status: 200 });
      });
      global.fetch = fetchMock as typeof fetch;

      const service = new CaddyService(context.config, {
        listByStatuses: () => [
          {
            id: 'dep_deploying',
            projectId: 'project_local',
            slug: 'dep-deploying',
            sourceType: 'git',
            sourceGitUrl: 'https://github.com/example/deploying',
            sourceArchiveFilename: null,
            sourceArchivePath: null,
            sourceRootPath: '/data/workspaces/dep_deploying/src',
            status: 'deploying',
            substage: 'health_checking',
            statusReason: null,
            imageTag: 'brimble-local/local:dep-deploying',
            containerName: 'brimble-app-dep-deploying',
            containerId: 'container-deploying',
            routeMode: 'hostname',
            routeHost: 'dep-deploying.localhost',
            routePath: null,
            liveUrl: null,
            internalPort: 3000,
            railpackPlanPath: null,
            railpackInfoPath: null,
            buildStartedAt: null,
            buildFinishedAt: null,
            deployStartedAt: null,
            deployFinishedAt: null,
            runningAt: null,
            failedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          {
            id: 'dep_running',
            projectId: 'project_local',
            slug: 'dep-running',
            sourceType: 'git',
            sourceGitUrl: 'https://github.com/example/running',
            sourceArchiveFilename: null,
            sourceArchivePath: null,
            sourceRootPath: '/data/workspaces/dep_running/src',
            status: 'running',
            substage: 'complete',
            statusReason: null,
            imageTag: 'brimble-local/local:dep-running',
            containerName: 'brimble-app-dep-running',
            containerId: 'container-running',
            routeMode: 'hostname',
            routeHost: 'dep-running.localhost',
            routePath: null,
            liveUrl: 'http://dep-running.localhost:8080/',
            internalPort: 3000,
            railpackPlanPath: null,
            railpackInfoPath: null,
            buildStartedAt: null,
            buildFinishedAt: null,
            deployStartedAt: null,
            deployFinishedAt: null,
            runningAt: new Date().toISOString(),
            failedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]
      } as never);

      await service.applyRoutes([
        {
          id: 'dep_extra',
          projectId: 'project_local',
          slug: 'dep-extra',
          sourceType: 'archive',
          sourceGitUrl: null,
          sourceArchiveFilename: 'sample.tgz',
          sourceArchivePath: '/data/uploads/dep_extra/sample.tgz',
          sourceRootPath: '/data/workspaces/dep_extra/src',
          status: 'deploying',
          substage: 'route_configuring',
          statusReason: null,
          imageTag: 'brimble-local/local:dep-extra',
          containerName: 'brimble-app-dep-extra',
          containerId: 'container-extra',
          routeMode: 'path',
          routeHost: null,
          routePath: '/apps/dep-extra',
          liveUrl: null,
          internalPort: 3000,
          railpackPlanPath: null,
          railpackInfoPath: null,
          buildStartedAt: null,
          buildFinishedAt: null,
          deployStartedAt: null,
          deployFinishedAt: null,
          runningAt: null,
          failedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]);

      const loadCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/load'));
      expect(loadCall).toBeDefined();

      const body = JSON.parse(String(loadCall?.[1]?.body ?? '{}')) as Record<string, any>;
      const routes = (body.apps?.http?.servers?.control_plane?.routes ?? []) as Array<Record<string, any>>;
      const hostnameRoutes = routes.filter((route) =>
        route.match?.some(
          (match: Record<string, any>) =>
            Array.isArray(match.host) && match.host.every((host: string) => host !== 'localhost')
        )
      );
      const pathRoutes = routes.filter((route) =>
        route.match?.some((match: Record<string, any>) => Array.isArray(match.path))
      );

      expect(
        hostnameRoutes.some((route) =>
          route.match?.some((match: Record<string, any>) => match.host?.includes('dep-deploying.localhost'))
        )
      ).toBe(true);
      expect(
        hostnameRoutes.some((route) =>
          route.match?.some((match: Record<string, any>) => match.host?.includes('dep-running.localhost'))
        )
      ).toBe(true);
      expect(
        pathRoutes.some((route) =>
          route.match?.some(
            (match: Record<string, any>) =>
              match.path?.includes('/apps/dep-extra') &&
              match.path?.includes('/apps/dep-extra/*')
          )
        )
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
