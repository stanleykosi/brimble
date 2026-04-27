import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildDesiredCaddyConfig } from '../src/services/caddy-config.js';
import { createTestConfig } from './helpers.js';

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
      {
        id: 'dep_1',
        projectId: 'project_local',
        slug: 'dep-1',
        sourceType: 'git',
        sourceGitUrl: 'https://github.com/example/repo',
        sourceArchiveFilename: null,
        sourceArchivePath: null,
        sourceRootPath: '/data/workspaces/dep_1/src',
        status: 'running',
        substage: 'complete',
        statusReason: null,
        imageTag: 'brimble-local/local:dep-1',
        containerName: 'brimble-app-dep-1',
        containerId: 'abc',
        routeMode: 'hostname',
        routeHost: 'dep-1.localhost',
        routePath: null,
        liveUrl: 'http://dep-1.localhost:8080/',
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

    const routes = (((document.apps as any).http.servers.control_plane.routes) as Array<Record<string, unknown>>);
    expect(JSON.stringify(routes)).toContain('dep-1.localhost');
    expect(JSON.stringify(routes)).toContain('brimble-app-dep-1:3000');
  });

  it('creates path routes with prefix stripping', () => {
    const document = buildDesiredCaddyConfig(config, [
      {
        id: 'dep_2',
        projectId: 'project_local',
        slug: 'dep-2',
        sourceType: 'archive',
        sourceGitUrl: null,
        sourceArchiveFilename: 'sample.tgz',
        sourceArchivePath: '/data/uploads/dep_2/sample.tgz',
        sourceRootPath: '/data/workspaces/dep_2/src',
        status: 'running',
        substage: 'complete',
        statusReason: null,
        imageTag: 'brimble-local/local:dep-2',
        containerName: 'brimble-app-dep-2',
        containerId: 'def',
        routeMode: 'path',
        routeHost: null,
        routePath: '/apps/dep-2',
        liveUrl: 'http://localhost:8080/apps/dep-2/',
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

    const routes = (((document.apps as any).http.servers.control_plane.routes) as Array<Record<string, unknown>>);
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
        {
          id: 'dep_3',
          projectId: 'project_local',
          slug: 'dep-3',
          sourceType: 'archive',
          sourceGitUrl: null,
          sourceArchiveFilename: 'sample.tgz',
          sourceArchivePath: '/data/uploads/dep_3/sample.tgz',
          sourceRootPath: '/data/workspaces/dep_3/src',
          status: 'running',
          substage: 'complete',
          statusReason: null,
          imageTag: 'brimble-local/local:dep-3',
          containerName: 'brimble-app-dep-3',
          containerId: 'ghi',
          routeMode: 'path',
          routeHost: null,
          routePath: '/apps/dep-3',
          liveUrl: 'https://control.example.com/apps/dep-3/',
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
      ]
    );

    const routes = (((document.apps as any).http.servers.control_plane.routes) as Array<Record<string, any>>);
    expect(routes).toHaveLength(3);

    const [apiRoute, pathRoute, frontendRoute] = routes;
    if (!apiRoute || !pathRoute || !frontendRoute) {
      throw new Error('expected control-plane routes to be defined');
    }

    expect(apiRoute.match[0].host).toEqual(['control.example.com']);
    expect(pathRoute.match[0].host).toEqual(['control.example.com']);
    expect(frontendRoute.match[0].host).toEqual(['control.example.com']);
  });

  afterAll(async () => {
    await cleanup();
  });
});
