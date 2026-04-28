import { describe, expect, it } from 'vitest';

import { getPublishedControlPlaneUrl, toPublicConfig } from '../src/config/env.js';
import { DeploymentService } from '../src/services/deployment-service.js';
import { createDeploymentDetail } from './helpers.js';

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
      service.computeLiveUrl(createDeploymentDetail({
        id: 'dep_hostname',
        slug: 'dep-hostname',
        status: 'running',
        substage: 'complete',
        imageTag: 'brimble-local/local:dep-hostname',
        containerName: 'brimble-app-dep-hostname',
        containerId: 'container-1',
        routeHost: 'dep-hostname.control.example.com',
        internalPort: 3000
      }))
    ).toBe('http://dep-hostname.control.example.com:8080/');

    expect(
      service.computeLiveUrl(createDeploymentDetail({
        id: 'dep_path',
        slug: 'dep-path',
        sourceType: 'archive',
        sourceGitUrl: null,
        sourceArchiveFilename: 'sample.tgz',
        sourceArchivePath: '/data/uploads/dep_path/sample.tgz',
        status: 'running',
        substage: 'complete',
        imageTag: 'brimble-local/local:dep-path',
        containerName: 'brimble-app-dep-path',
        containerId: 'container-2',
        routeMode: 'path',
        routeHost: null,
        routePath: '/apps/dep-path',
        internalPort: 3000
      }))
    ).toBe('http://control.example.com:8080/apps/dep-path/');
  });
});
