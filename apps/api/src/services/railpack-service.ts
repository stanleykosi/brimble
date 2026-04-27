import path from 'node:path';

import type { DeploymentDetail } from '@brimble/contracts';

import type { AppConfig } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { runCommand } from '../utils/process.js';
import { DeploymentEventService } from './deployment-event-service.js';

export class RailpackService {
  constructor(
    private readonly config: AppConfig,
    private readonly eventService: DeploymentEventService
  ) {}

  async prepare(deployment: DeploymentDetail, sourceRootPath: string): Promise<{
    planPath: string;
    infoPath: string;
  }> {
    const workspaceRoot = path.join(this.config.STORAGE_ROOT, 'workspaces', deployment.id);
    const planPath = path.join(workspaceRoot, 'railpack-plan.json');
    const infoPath = path.join(workspaceRoot, 'railpack-info.json');

    this.eventService.appendSystem(
      deployment.id,
      'RAILPACK_PREPARE_STARTED',
      'Running railpack prepare',
      'prepare'
    );

    const result = await runCommand({
      command: 'railpack',
      args: ['prepare', sourceRootPath, '--plan-out', planPath, '--info-out', infoPath],
      onStdoutLine: (line) => {
        this.eventService.appendLog(deployment.id, 'prepare', 'stdout', { message: line, chunk: false });
      },
      onStderrLine: (line) => {
        this.eventService.appendLog(deployment.id, 'prepare', 'stderr', { message: line, chunk: false });
      }
    });

    if (result.code !== 0) {
      throw new AppError({
        code: 'RAILPACK_PREPARE_FAILED',
        message: 'railpack prepare failed',
        details: {
          stderr: result.stderr.join('\n')
        }
      });
    }

    this.eventService.appendSystem(
      deployment.id,
      'RAILPACK_PREPARE_FINISHED',
      'railpack prepare completed',
      'prepare'
    );

    return {
      planPath,
      infoPath
    };
  }

  async buildImage(deployment: DeploymentDetail, sourceRootPath: string, planPath: string): Promise<string> {
    const imageTag = `brimble-local/local:${deployment.slug}`;

    this.eventService.appendSystem(
      deployment.id,
      'IMAGE_BUILD_STARTED',
      'Building image with docker buildx',
      'build',
      {
        imageTag
      }
    );

    const result = await runCommand({
      command: 'docker',
      args: [
        'buildx',
        'build',
        '--load',
        '--build-arg',
        `BUILDKIT_SYNTAX=${this.config.RAILPACK_FRONTEND_IMAGE}`,
        '-t',
        imageTag,
        '-f',
        planPath,
        sourceRootPath
      ],
      env: {
        DOCKER_BUILDKIT: '1'
      },
      onStdoutLine: (line) => {
        this.eventService.appendLog(deployment.id, 'build', 'stdout', { message: line, chunk: false });
      },
      onStderrLine: (line) => {
        this.eventService.appendLog(deployment.id, 'build', 'stderr', { message: line, chunk: false });
      }
    });

    if (result.code !== 0) {
      throw new AppError({
        code: 'IMAGE_BUILD_FAILED',
        message: 'docker buildx build failed',
        details: {
          stderr: result.stderr.join('\n')
        }
      });
    }

    const verify = await runCommand({
      command: 'docker',
      args: ['image', 'inspect', imageTag]
    });

    if (verify.code !== 0) {
      throw new AppError({
        code: 'IMAGE_BUILD_FAILED',
        message: `Built image ${imageTag} could not be inspected`
      });
    }

    this.eventService.appendSystem(
      deployment.id,
      'IMAGE_BUILD_FINISHED',
      'Image built successfully',
      'build',
      {
        imageTag
      }
    );

    return imageTag;
  }
}
