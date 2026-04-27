import path from 'node:path';

import type {
  CreateDeploymentFields,
  DeploymentDetail,
  DeploymentStatus,
  DeploymentSubstage,
  ListDeploymentsQuery,
  RouteMode,
  SourceType
} from '@brimble/contracts';
import { ulid } from 'ulid';

import { getPublishedControlPlaneUrl, type AppConfig } from '../config/env.js';
import { DeploymentRepository, type DeploymentPatch } from '../repositories/deployment-repository.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { AppError } from '../utils/errors.js';
import { assertValidTransition } from './deployment-state.js';
import { DeploymentEventService } from './deployment-event-service.js';

type CreatePendingDeploymentInput = {
  fields: CreateDeploymentFields;
  sourceType: SourceType;
  sourceGitUrl: string | null;
  sourceArchiveFilename: string | null;
  sourceArchivePath: string | null;
};

type PendingDeploymentRecord = Parameters<DeploymentRepository['create']>[0];

export class DeploymentService {
  constructor(
    private readonly config: AppConfig,
    private readonly projectRepository: ProjectRepository,
    private readonly deploymentRepository: DeploymentRepository,
    private readonly eventService: DeploymentEventService
  ) {}

  listDeployments(query: ListDeploymentsQuery): DeploymentDetail[] {
    return this.deploymentRepository.list(query);
  }

  getDeployment(id: string): DeploymentDetail {
    return this.deploymentRepository.requireById(id);
  }

  claimNextPending(): DeploymentDetail | null {
    const claimed = this.deploymentRepository.claimOldestPending(new Date().toISOString());

    if (!claimed) {
      return null;
    }

    this.eventService.appendStatus(claimed.id, {
      fromStatus: 'pending',
      toStatus: 'building',
      substage: 'queued',
      reason: null
    });

    return claimed;
  }

  planPendingDeployment(input: CreatePendingDeploymentInput): PendingDeploymentRecord {
    const token = ulid().toLowerCase();
    const id = `dep_${token}`;
    const slug = `dep-${token}`;
    const routeMode = input.fields.routeMode ?? this.config.DEFAULT_ROUTE_MODE;
    const routeFields = this.getRouteFields(slug, routeMode);
    const now = new Date().toISOString();

    return {
      id,
      projectId: this.projectRepository.getLocalProjectId(),
      slug,
      sourceType: input.sourceType,
      sourceGitUrl: input.sourceGitUrl,
      sourceArchiveFilename: input.sourceArchiveFilename,
      sourceArchivePath: input.sourceArchivePath,
      sourceRootPath: path.join(this.config.STORAGE_ROOT, 'workspaces', id, 'src'),
      status: 'pending',
      substage: 'queued',
      statusReason: null,
      imageTag: null,
      containerName: null,
      containerId: null,
      routeMode,
      routeHost: routeFields.routeHost,
      routePath: routeFields.routePath,
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

  persistPendingDeployment(deployment: PendingDeploymentRecord): DeploymentDetail {
    this.deploymentRepository.create(deployment);

    this.eventService.appendStatus(deployment.id, {
      fromStatus: null,
      toStatus: 'pending',
      substage: 'queued',
      reason: null
    });

    return this.getDeployment(deployment.id);
  }

  createPendingDeployment(input: CreatePendingDeploymentInput): DeploymentDetail {
    return this.persistPendingDeployment(this.planPendingDeployment(input));
  }

  updateDeployment(id: string, patch: DeploymentPatch): DeploymentDetail {
    this.deploymentRepository.update(id, {
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    });

    return this.getDeployment(id);
  }

  setSubstage(
    deploymentId: string,
    substage: DeploymentSubstage,
    reason: string | null = null
  ): DeploymentDetail {
    const current = this.getDeployment(deploymentId);
    const updated = this.updateDeployment(deploymentId, {
      substage,
      statusReason: reason
    });

    this.eventService.appendStatus(deploymentId, {
      fromStatus: current.status,
      toStatus: current.status,
      substage,
      reason
    });

    return updated;
  }

  transitionStatus(
    deploymentId: string,
    nextStatus: DeploymentStatus,
    options: {
      substage: DeploymentSubstage | null;
      reason?: string | null;
      patch?: DeploymentPatch;
    }
  ): DeploymentDetail {
    const current = this.getDeployment(deploymentId);

    if (current.status !== nextStatus) {
      assertValidTransition(current.status, nextStatus);
    }

    const now = new Date().toISOString();
    const patch: DeploymentPatch = {
      status: nextStatus,
      substage: options.substage,
      statusReason: nextStatus === 'failed' ? options.reason ?? 'Deployment failed' : null,
      updatedAt: now,
      ...options.patch
    };

    if (nextStatus === 'building' && !current.buildStartedAt) {
      patch.buildStartedAt = now;
    }

    if (nextStatus === 'deploying') {
      patch.buildFinishedAt = current.buildFinishedAt ?? now;
      patch.deployStartedAt = current.deployStartedAt ?? now;
    }

    if (nextStatus === 'running') {
      patch.deployFinishedAt = now;
      patch.runningAt = now;
    }

    if (nextStatus === 'failed') {
      patch.failedAt = now;
    }

    const updated = this.updateDeployment(deploymentId, patch);
    this.eventService.appendStatus(deploymentId, {
      fromStatus: current.status,
      toStatus: nextStatus,
      substage: options.substage,
      reason: options.reason ?? null
    });

    return updated;
  }

  forceFail(
    deploymentId: string,
    reason: string,
    substage: DeploymentSubstage = 'cleanup'
  ): DeploymentDetail {
    const current = this.getDeployment(deploymentId);
    const now = new Date().toISOString();
    const updated = this.updateDeployment(deploymentId, {
      status: 'failed',
      substage,
      statusReason: reason,
      liveUrl: null,
      failedAt: current.failedAt ?? now,
      updatedAt: now
    });

    this.eventService.appendStatus(deploymentId, {
      fromStatus: current.status,
      toStatus: 'failed',
      substage,
      reason
    });

    return updated;
  }

  computeLiveUrl(deployment: DeploymentDetail): string {
    const base = new URL(getPublishedControlPlaneUrl(this.config));

    if (deployment.routeMode === 'hostname') {
      if (!deployment.routeHost) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: `Deployment ${deployment.id} has no hostname route configured`
        });
      }

      return `${base.protocol}//${deployment.routeHost}:${base.port}/`;
    }

    return new URL(`${deployment.routePath ?? `/apps/${deployment.slug}/`}/`, base).toString();
  }

  private getRouteFields(
    slug: string,
    routeMode: RouteMode
  ): { routeHost: string | null; routePath: string | null } {
    if (routeMode === 'hostname') {
      return {
        routeHost: `${slug}.${this.config.HOSTNAME_SUFFIX}`,
        routePath: null
      };
    }

    return {
      routeHost: null,
      routePath: `/apps/${slug}`
    };
  }
}
