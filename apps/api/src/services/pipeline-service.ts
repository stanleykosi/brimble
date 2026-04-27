import type { DeploymentDetail, DeploymentEventPhase } from '@brimble/contracts';

import { AppError, toAppError } from '../utils/errors.js';
import { CaddyService } from './caddy-service.js';
import { DeploymentEventService } from './deployment-event-service.js';
import { DeploymentService } from './deployment-service.js';
import { DockerRuntimeService } from './docker-runtime-service.js';
import { RailpackService } from './railpack-service.js';
import { SourceService } from './source-service.js';

export class PipelineService {
  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly eventService: DeploymentEventService,
    private readonly sourceService: SourceService,
    private readonly railpackService: RailpackService,
    private readonly dockerRuntimeService: DockerRuntimeService,
    private readonly caddyService: CaddyService
  ) {}

  async processDeployment(deploymentId: string): Promise<DeploymentDetail> {
    let deployment = this.deploymentService.transitionStatus(deploymentId, 'building', {
      substage: 'source_fetching'
    });

    try {
      const sourceRoot = await this.sourceService.acquireSource(deployment);
      deployment = this.deploymentService.updateDeployment(deploymentId, { sourceRootPath: sourceRoot });
      deployment = this.deploymentService.setSubstage(deploymentId, 'source_ready');

      deployment = this.deploymentService.setSubstage(deploymentId, 'railpack_preparing');
      const artifacts = await this.railpackService.prepare(deployment, sourceRoot);
      deployment = this.deploymentService.updateDeployment(deploymentId, {
        railpackPlanPath: artifacts.planPath,
        railpackInfoPath: artifacts.infoPath
      });

      deployment = this.deploymentService.setSubstage(deploymentId, 'image_building');
      const imageTag = await this.railpackService.buildImage(deployment, sourceRoot, artifacts.planPath);
      deployment = this.deploymentService.transitionStatus(deploymentId, 'deploying', {
        substage: 'container_starting',
        patch: {
          imageTag
        }
      });

      const runtime = await this.dockerRuntimeService.startContainer(deployment);
      deployment = this.deploymentService.updateDeployment(deploymentId, {
        containerName: runtime.containerName,
        containerId: runtime.containerId,
        internalPort: runtime.internalPort
      });

      deployment = this.deploymentService.setSubstage(deploymentId, 'route_configuring');
      await this.caddyService.applyRoutes([this.deploymentService.getDeployment(deploymentId)]);

      deployment = this.deploymentService.setSubstage(deploymentId, 'health_checking');
      await this.caddyService.waitForDeployment(this.deploymentService.getDeployment(deploymentId));

      deployment = this.deploymentService.transitionStatus(deploymentId, 'running', {
        substage: 'complete',
        patch: {
          liveUrl: this.deploymentService.computeLiveUrl(this.deploymentService.getDeployment(deploymentId))
        }
      });

      this.eventService.appendSystem(
        deploymentId,
        'DEPLOYMENT_RUNNING',
        'Deployment is reachable through Caddy',
        'deploy',
        {
          liveUrl: deployment.liveUrl,
          imageTag: deployment.imageTag
        }
      );

      await this.cleanupWorkspace(
        deploymentId,
        'Failed to clean deployment workspace after the deployment reached running state'
      );

      return deployment;
    } catch (error) {
      const appError = toAppError(error);
      await this.handleFailure(deploymentId, appError);
      throw appError;
    }
  }

  private async handleFailure(deploymentId: string, error: AppError): Promise<void> {
    const current = this.deploymentService.getDeployment(deploymentId);

    this.deploymentService.forceFail(deploymentId, error.message);
    this.eventService.appendSystem(deploymentId, error.code, error.message, 'system', error.details);

    if (current.containerName) {
      try {
        const runtimeTail = await this.dockerRuntimeService.captureRuntimeLogTail(current.containerName);

        for (const line of runtimeTail) {
          this.eventService.appendLog(deploymentId, 'runtime', 'stderr', {
            message: line,
            chunk: false
          });
        }
      } catch (captureError) {
        this.appendCleanupFailure(
          deploymentId,
          'RUNTIME_LOG_CAPTURE_FAILED',
          'Failed to capture runtime logs during failure cleanup',
          'runtime',
          captureError
        );
      }

      try {
        await this.dockerRuntimeService.stopAndRemoveContainer(current.containerName);
      } catch (cleanupError) {
        this.appendCleanupFailure(
          deploymentId,
          'CONTAINER_CLEANUP_FAILED',
          'Failed to stop and remove the deployment container during cleanup',
          'runtime',
          cleanupError
        );
      }
    }

    try {
      await this.caddyService.applyRoutes();
    } catch (cleanupError) {
      this.appendCleanupFailure(
        deploymentId,
        'CADDY_ROUTE_CLEANUP_FAILED',
        'Failed to rebuild Caddy routes during failure cleanup',
        'deploy',
        cleanupError
      );
    }

    await this.cleanupWorkspace(
      deploymentId,
      'Failed to clean deployment workspace during failure cleanup'
    );
  }

  private appendCleanupFailure(
    deploymentId: string,
    code: string,
    message: string,
    phase: DeploymentEventPhase,
    error: unknown
  ): void {
    const cleanupError = toAppError(error);
    this.eventService.appendSystem(deploymentId, code, message, phase, {
      cause: cleanupError.message,
      errorCode: cleanupError.code,
      ...(cleanupError.details ? { details: cleanupError.details } : {})
    });
  }

  private async cleanupWorkspace(deploymentId: string, message: string): Promise<void> {
    try {
      await this.sourceService.cleanupWorkspace(deploymentId);
    } catch (cleanupError) {
      this.appendCleanupFailure(
        deploymentId,
        'WORKSPACE_CLEANUP_FAILED',
        message,
        'system',
        cleanupError
      );
    }
  }
}
