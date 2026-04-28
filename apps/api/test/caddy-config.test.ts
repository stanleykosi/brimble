import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildDesiredCaddyConfig } from '../src/services/caddy-config.js';
import { createDeploymentDetail, createTestConfig } from './helpers.js';

describe('buildDesiredCaddyConfig', () => {
  let config: Awaited<ReturnType<typeof createTestConfig>>['config'];
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const context = await createTestConfig();
    config = context.config;
    cleanup = context.cleanup;
  });

  it('creates hostname routes', () => {
    const document = buildDesiredCaddyConfig(config, [
      createDeploymentDetail({
        id: 'dep_1',
        slug: 'dep-1',
        status: 'running',
        substage: 'complete',
        imageTag: 'brimble-local/local:dep-1',
        containerName: 'brimble-app-dep-1',
        containerId: 'abc',
        routeHost: 'dep-1.localhost',
        liveUrl: 'http://dep-1.localhost:8080/',
        internalPort: 3000
      })
    ]);

    const routes = document.apps.http.servers.control_plane.routes;
    expect(JSON.stringify(routes)).toContain('dep-1.localhost');
    expect(JSON.stringify(routes)).toContain('brimble-app-dep-1:3000');
  });

  it('creates path routes with prefix stripping', () => {
    const document = buildDesiredCaddyConfig(config, [
      createDeploymentDetail({
        id: 'dep_2',
        slug: 'dep-2',
        sourceType: 'archive',
        sourceGitUrl: null,
        sourceArchiveFilename: 'sample.tgz',
        sourceArchivePath: '/data/uploads/dep_2/sample.tgz',
        status: 'running',
        substage: 'complete',
        imageTag: 'brimble-local/local:dep-2',
        containerName: 'brimble-app-dep-2',
        containerId: 'def',
        routeMode: 'path',
        routeHost: null,
        routePath: '/apps/dep-2',
        liveUrl: 'http://localhost:8080/apps/dep-2/',
        internalPort: 3000
      })
    ]);

    const routes = document.apps.http.servers.control_plane.routes;
    expect(JSON.stringify(routes)).toContain('/apps/dep-2');
    expect(JSON.stringify(routes)).toContain('strip_path_prefix');
  });

  it('uses the configured ingress host for control-plane and path routes', () => {
    const document = buildDesiredCaddyConfig(
      {
        ...config,
        CONTROL_PLANE_PUBLIC_URL: 'https://control.example.com'
      },
      [
        createDeploymentDetail({
          id: 'dep_3',
          slug: 'dep-3',
          sourceType: 'archive',
          sourceGitUrl: null,
          sourceArchiveFilename: 'sample.tgz',
          sourceArchivePath: '/data/uploads/dep_3/sample.tgz',
          status: 'running',
          substage: 'complete',
          imageTag: 'brimble-local/local:dep-3',
          containerName: 'brimble-app-dep-3',
          containerId: 'ghi',
          routeMode: 'path',
          routeHost: null,
          routePath: '/apps/dep-3',
          liveUrl: 'https://control.example.com/apps/dep-3/',
          internalPort: 3000
        })
      ]
    );

    const routes = document.apps.http.servers.control_plane.routes;
    expect(routes).toHaveLength(3);

    const [apiRoute, pathRoute, frontendRoute] = routes;
    if (!apiRoute || !pathRoute || !frontendRoute) {
      throw new Error('expected control-plane routes to be defined');
    }

    const [apiMatch] = apiRoute.match;
    const [pathMatch] = pathRoute.match;
    const [frontendMatch] = frontendRoute.match;
    if (!apiMatch || !pathMatch || !frontendMatch) {
      throw new Error('expected control-plane route matches to be defined');
    }

    expect(apiMatch.host).toEqual(['control.example.com']);
    expect(pathMatch.host).toEqual(['control.example.com']);
    expect(frontendMatch.host).toEqual(['control.example.com']);
  });

  afterAll(async () => {
    await cleanup();
  });
});
