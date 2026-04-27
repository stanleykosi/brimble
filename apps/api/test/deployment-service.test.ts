import { describe, expect, it } from 'vitest';

import { getPublishedControlPlaneUrl, toPublicConfig } from '../src/config/env.js';
import { DeploymentService } from '../src/services/deployment-service.js';

describe('published ingress URLs', () => {
  it('normalizes public control-plane URLs to the direct Caddy ingress', () => {
    expect(
      getPublishedControlPlaneUrl({
        CONTROL_PLANE_PUBLIC_URL: 'https://control.example.com'
      } as never)
    ).toBe('http://control.example.com:8080');

    expect(
      toPublicConfig({
        CONTROL_PLANE_PUBLIC_URL: 'https://control.example.com',
        DEFAULT_ROUTE_MODE: 'hostname',
        HOSTNAME_SUFFIX: 'localhost',
        UPLOAD_MAX_BYTES: 104857600,
        acceptedArchiveExtensions: ['.zip', '.tar.gz', '.tgz']
      } as never).controlPlaneUrl
    ).toBe('http://control.example.com:8080');
  });

  it('emits live URLs against the direct Caddy ingress even when the configured public URL is not directly reachable', () => {
    const service = new DeploymentService(
      {
        CONTROL_PLANE_PUBLIC_URL: 'https://control.example.com',
        DEFAULT_ROUTE_MODE: 'hostname',
        STORAGE_ROOT: '/data',
        HOSTNAME_SUFFIX: 'control.example.com'
      } as never,
      {} as never,
      {} as never,
      {} as never
    );

    expect(
      service.computeLiveUrl({
        id: 'dep_hostname',
        projectId: 'project_local',
        slug: 'dep-hostname',
        sourceType: 'git',
        sourceGitUrl: 'https://github.com/example/repo',
        sourceArchiveFilename: null,
        sourceArchivePath: null,
        sourceRootPath: '/data/workspaces/dep_hostname/src',
        status: 'running',
        substage: 'complete',
        statusReason: null,
        imageTag: 'brimble-local/local:dep-hostname',
        containerName: 'brimble-app-dep-hostname',
        containerId: 'container-1',
        routeMode: 'hostname',
        routeHost: 'dep-hostname.control.example.com',
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
      })
    ).toBe('http://dep-hostname.control.example.com:8080/');

    expect(
      service.computeLiveUrl({
        id: 'dep_path',
        projectId: 'project_local',
        slug: 'dep-path',
        sourceType: 'archive',
        sourceGitUrl: null,
        sourceArchiveFilename: 'sample.tgz',
        sourceArchivePath: '/data/uploads/dep_path/sample.tgz',
        sourceRootPath: '/data/workspaces/dep_path/src',
        status: 'running',
        substage: 'complete',
        statusReason: null,
        imageTag: 'brimble-local/local:dep-path',
        containerName: 'brimble-app-dep-path',
        containerId: 'container-2',
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
      })
    ).toBe('http://control.example.com:8080/apps/dep-path/');
  });
});
