import type { DeploymentDetail } from '@brimble/contracts';

import type { AppConfig } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { type CommandResult, runCommand } from '../utils/process.js';
import { DeploymentEventService } from './deployment-event-service.js';

interface DockerImageInspect {
  Config?: {
    ExposedPorts?: Record<string, unknown>;
  };
}

export function resolveRuntimePortFromInspect(
  documents: DockerImageInspect[],
  fallbackPort: number
): number {
  const exposed = Object.keys(documents[0]?.Config?.ExposedPorts ?? {}).filter((value) =>
    value.endsWith('/tcp')
  );

  if (exposed.length === 1) {
    return Number.parseInt(exposed[0]!.split('/')[0]!, 10);
  }

  return fallbackPort;
}

export function isMissingContainerInspectResult(result: CommandResult): boolean {
  if (result.code === 0) {
    return false;
  }

  const output = [...result.stderr, ...result.stdout].join('\n');
  return /no such (?:container|object)/i.test(output);
}

export function isMissingContainerRemoveResult(result: CommandResult): boolean {
  if (result.code === 0) {
    return false;
  }

  const output = [...result.stderr, ...result.stdout].join('\n');
  return /no such (?:container|object)/i.test(output);
}

export class DockerRuntimeService {
  constructor(
    private readonly config: AppConfig,
    private readonly eventService: DeploymentEventService
  ) {}

  async startContainer(deployment: DeploymentDetail): Promise<{
    containerName: string;
    containerId: string;
    internalPort: number;
  }> {
    if (!deployment.imageTag) {
      throw new AppError({
        code: 'CONTAINER_START_FAILED',
        message: 'Cannot start a container before the deployment has an imageTag'
      });
    }

    const containerName = `brimble-app-${deployment.slug}`;
    const internalPort = await this.resolveInternalPort(deployment.imageTag);

    await this.stopAndRemoveContainer(containerName);

    const result = await runCommand({
      command: 'docker',
      args: [
        'run',
        '-d',
        '--name',
        containerName,
        '--network',
        this.config.APP_NETWORK_NAME,
        '--label',
        'com.brimble.local.managed=true',
        '--label',
        `com.brimble.local.project=${deployment.projectId}`,
        '--label',
        `com.brimble.local.deployment=${deployment.id}`,
        '-e',
        `PORT=${internalPort}`,
        deployment.imageTag
      ],
      onStdoutLine: (line) => {
        this.eventService.appendLog(deployment.id, 'deploy', 'stdout', { message: line, chunk: false });
      },
      onStderrLine: (line) => {
        this.eventService.appendLog(deployment.id, 'deploy', 'stderr', { message: line, chunk: false });
      }
    });

    if (result.code !== 0 || result.stdout.length === 0) {
      throw new AppError({
        code: 'CONTAINER_START_FAILED',
        message: 'docker run failed',
        details: {
          stderr: result.stderr.join('\n')
        }
      });
    }

    const containerId = result.stdout[result.stdout.length - 1]!.trim();

    this.eventService.appendSystem(
      deployment.id,
      'CONTAINER_STARTED',
      'Runtime container started',
      'deploy',
      {
        containerName,
        containerId,
        internalPort
      }
    );

    return {
      containerName,
      containerId,
      internalPort
    };
  }

  async resolveInternalPort(imageTag: string): Promise<number> {
    const inspect = await runCommand({
      command: 'docker',
      args: ['image', 'inspect', imageTag]
    });

    if (inspect.code !== 0) {
      throw new AppError({
        code: 'IMAGE_INSPECT_FAILED',
        message: `Failed to inspect image ${imageTag}`
      });
    }

    const documents = JSON.parse(inspect.stdout.join('\n')) as DockerImageInspect[];
    return resolveRuntimePortFromInspect(documents, this.config.DEPLOY_DEFAULT_PORT);
  }

  async containerExists(containerName: string): Promise<boolean> {
    const result = await runCommand({
      command: 'docker',
      args: ['container', 'inspect', containerName]
    });

    if (result.code === 0) {
      return true;
    }

    if (isMissingContainerInspectResult(result)) {
      return false;
    }

    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Failed to inspect container ${containerName}`,
      details: {
        stdout: result.stdout.join('\n'),
        stderr: result.stderr.join('\n')
      }
    });
  }

  async captureRuntimeLogTail(containerName: string, tailLines = 200): Promise<string[]> {
    const result = await runCommand({
      command: 'docker',
      args: ['logs', '--tail', String(tailLines), containerName]
    });

    return [...result.stdout, ...result.stderr];
  }

  async stopAndRemoveContainer(containerName: string): Promise<void> {
    const result = await runCommand({
      command: 'docker',
      args: ['rm', '-f', containerName]
    });

    if (result.code === 0 || isMissingContainerRemoveResult(result)) {
      return;
    }

    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Failed to remove container ${containerName}`,
      details: {
        stdout: result.stdout.join('\n'),
        stderr: result.stderr.join('\n')
      }
    });
  }

  async listManagedContainers(): Promise<string[]> {
    const result = await runCommand({
      command: 'docker',
      args: [
        'ps',
        '-a',
        '--filter',
        'label=com.brimble.local.managed=true',
        '--format',
        '{{.Names}}'
      ]
    });

    if (result.code !== 0) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Failed to list managed containers',
        details: {
          stdout: result.stdout.join('\n'),
          stderr: result.stderr.join('\n')
        }
      });
    }

    return result.stdout.map((line) => line.trim()).filter(Boolean);
  }
}
