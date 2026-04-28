import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeploymentDetail } from '@brimble/contracts';

import type { CaddyConfigDocument, CaddyRoute } from '../src/services/caddy-config.js';
import { CaddyService } from '../src/services/caddy-service.js';
import { createDeploymentDetail, createTestConfig } from './helpers.js';

function createDeployment(overrides: Partial<DeploymentDetail> = {}): DeploymentDetail {
  return createDeploymentDetail({
    status: 'deploying',
    substage: 'health_checking',
    imageTag: 'brimble-local/local:dep-test',
    containerName: 'brimble-app-dep-test',
    containerId: 'container-test',
    internalPort: 3000,
    ...overrides
  });
}

function routeHasHost(route: CaddyRoute, expectedHost: string): boolean {
  return route.match.some((match) => match.host.includes(expectedHost));
}

function routeHasPath(route: CaddyRoute, expectedPaths: string[]): boolean {
  return route.match.some((match) =>
    expectedPaths.every((expectedPath) => match.path?.includes(expectedPath))
  );
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

      await service.waitForDeployment(createDeployment({
        id: 'dep_path',
        slug: 'dep-path',
        sourceType: 'archive',
        sourceGitUrl: null,
        sourceArchiveFilename: 'sample.tgz',
        sourceArchivePath: '/data/uploads/dep_path/sample.tgz',
        imageTag: 'brimble-local/local:dep-path',
        containerName: 'brimble-app-dep-path',
        containerId: 'abc123',
        routeMode: 'path',
        routeHost: null,
        routePath: '/apps/dep-path',
      }));

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
          createDeployment({
            id: 'dep_deploying',
            slug: 'dep-deploying',
            sourceGitUrl: 'https://github.com/example/deploying',
            imageTag: 'brimble-local/local:dep-deploying',
            containerName: 'brimble-app-dep-deploying',
            containerId: 'container-deploying',
            routeHost: 'dep-deploying.localhost',
          }),
          createDeployment({
            id: 'dep_running',
            slug: 'dep-running',
            sourceGitUrl: 'https://github.com/example/running',
            status: 'running',
            substage: 'complete',
            imageTag: 'brimble-local/local:dep-running',
            containerName: 'brimble-app-dep-running',
            containerId: 'container-running',
            routeHost: 'dep-running.localhost',
            liveUrl: 'http://dep-running.localhost:8080/',
            runningAt: new Date().toISOString()
          })
        ]
      } as never);

      await service.applyRoutes([
        createDeployment({
          id: 'dep_extra',
          slug: 'dep-extra',
          sourceType: 'archive',
          sourceGitUrl: null,
          sourceArchiveFilename: 'sample.tgz',
          sourceArchivePath: '/data/uploads/dep_extra/sample.tgz',
          substage: 'route_configuring',
          imageTag: 'brimble-local/local:dep-extra',
          containerName: 'brimble-app-dep-extra',
          containerId: 'container-extra',
          routeMode: 'path',
          routeHost: null,
          routePath: '/apps/dep-extra',
        })
      ]);

      const loadCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/load'));
      expect(loadCall).toBeDefined();

      const body = JSON.parse(String(loadCall?.[1]?.body ?? '{}')) as CaddyConfigDocument;
      const routes = body.apps.http.servers.control_plane.routes;
      const hostnameRoutes = routes.filter((route) =>
        route.match.some((match) => match.host.every((host) => host !== 'localhost'))
      );
      const pathRoutes = routes.filter((route) =>
        route.match.some((match) => Array.isArray(match.path))
      );

      expect(
        hostnameRoutes.some((route) => routeHasHost(route, 'dep-deploying.localhost'))
      ).toBe(true);
      expect(
        hostnameRoutes.some((route) => routeHasHost(route, 'dep-running.localhost'))
      ).toBe(true);
      expect(
        pathRoutes.some((route) =>
          routeHasPath(route, ['/apps/dep-extra', '/apps/dep-extra/*'])
        )
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
