import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

import type { DeploymentDetail } from '@brimble/contracts';
import { FormDataEncoder } from 'form-data-encoder';
import type { FormData } from 'formdata-node';

import type { AppConfig } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.js';
import { DeploymentEventRepository } from '../src/repositories/deployment-event-repository.js';
import { DeploymentRepository } from '../src/repositories/deployment-repository.js';
import { ProjectRepository } from '../src/repositories/project-repository.js';
import { DeploymentEventService } from '../src/services/deployment-event-service.js';
import { DeploymentService } from '../src/services/deployment-service.js';

export async function createTestConfig(): Promise<{ config: AppConfig; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'brimble-api-test-'));

  return {
    config: {
      NODE_ENV: 'test',
      APP_PORT: 3001,
      SQLITE_PATH: path.join(root, 'db', 'app.sqlite'),
      STORAGE_ROOT: root,
      UPLOAD_MAX_BYTES: 104857600,
      PIPELINE_MAX_CONCURRENCY: 1,
      DEFAULT_ROUTE_MODE: 'hostname',
      HOSTNAME_SUFFIX: 'localhost',
      CONTROL_PLANE_PUBLIC_URL: 'http://localhost:8080',
      DEPLOY_DEFAULT_PORT: 3000,
      DEPLOY_HEALTHCHECK_INTERVAL_MS: 2000,
      DEPLOY_HEALTHCHECK_TIMEOUT_MS: 60000,
      CADDY_ADMIN_URL: 'http://caddy:2019',
      APP_NETWORK_NAME: 'brimble_local_network',
      RAILPACK_FRONTEND_IMAGE: 'ghcr.io/railwayapp/railpack-frontend',
      KEEP_WORKSPACES: true,
      VITE_API_BASE: '/api',
      acceptedArchiveExtensions: ['.zip', '.tar.gz', '.tgz']
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

export async function createTestRepositories() {
  const { config, cleanup } = await createTestConfig();
  const db = await createDatabase(config);
  const projectRepository = new ProjectRepository(db);
  const deploymentRepository = new DeploymentRepository(db);
  const deploymentEventRepository = new DeploymentEventRepository(db);
  const deploymentEventService = new DeploymentEventService(deploymentEventRepository);
  const deploymentService = new DeploymentService(
    config,
    projectRepository,
    deploymentRepository,
    deploymentEventService
  );

  projectRepository.ensureSeedProject();

  return {
    config,
    db,
    projectRepository,
    deploymentRepository,
    deploymentEventRepository,
    deploymentEventService,
    deploymentService,
    cleanup: async () => {
      db.close();
      await cleanup();
    }
  };
}

export function encodeFormData(formData: FormData) {
  const encoder = new FormDataEncoder(formData);
  return {
    headers: encoder.headers,
    payload: Readable.from(encoder)
  };
}

export function createDeploymentDetail(overrides: Partial<DeploymentDetail> = {}): DeploymentDetail {
  const id = overrides.id ?? 'dep_test';
  const slug = overrides.slug ?? id.replaceAll('_', '-');
  const now = new Date().toISOString();

  return {
    id,
    projectId: 'project_local',
    slug,
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
    routeHost: `${slug}.localhost`,
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
    updatedAt: now,
    ...overrides
  };
}

export function createGitPendingDeploymentInput() {
  const gitUrl = 'https://github.com/example/repo';

  return {
    fields: { sourceType: 'git' as const, gitUrl },
    sourceType: 'git' as const,
    sourceGitUrl: gitUrl,
    sourceArchiveFilename: null,
    sourceArchivePath: null
  };
}
