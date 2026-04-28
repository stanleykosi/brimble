import { DeploymentRepository } from '../repositories/deployment-repository.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { DeploymentEventService } from './deployment-event-service.js';
import { DeploymentService } from './deployment-service.js';
import { DockerRuntimeService } from './docker-runtime-service.js';
import { CaddyService } from './caddy-service.js';

type StartupDockerRuntimeService = Pick<
  DockerRuntimeService,
  'containerExists' | 'listManagedContainers' | 'stopAndRemoveContainer'
>;
type StartupCaddyService = Pick<CaddyService, 'waitForAdmin' | 'applyRoutes'>;

export class StartupReconcileService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly deploymentRepository: DeploymentRepository,
    private readonly deploymentService: DeploymentService,
    private readonly eventService: DeploymentEventService,
    private readonly dockerRuntimeService: StartupDockerRuntimeService,
    private readonly caddyService: StartupCaddyService
  ) {}

  async reconcile(): Promise<void> {
    this.projectRepository.ensureSeedProject();

    const interrupted = this.deploymentRepository.listByStatuses(['pending', 'building', 'deploying']);
    for (const deployment of interrupted) {
      this.deploymentService.forceFail(
        deployment.id,
        'Deployment was interrupted because the backend service restarted'
      );
      this.eventService.appendSystem(
        deployment.id,
        'PIPELINE_INTERRUPTED_BY_RESTART',
        'Deployment was interrupted because the backend service restarted'
      );
    }

    const running = this.deploymentRepository.listRunning();
    for (const deployment of running) {
      if (!deployment.containerName) {
        this.deploymentService.forceFail(
          deployment.id,
          'Running deployment was missing its container metadata after restart'
        );
        continue;
      }

      const exists = await this.dockerRuntimeService.containerExists(deployment.containerName);
      if (!exists) {
        this.deploymentService.forceFail(
          deployment.id,
          'Deployment container was missing when the backend restarted'
        );
      }
    }

    await this.caddyService.waitForAdmin();
    await this.caddyService.applyRoutes();

    const activeNames = new Set(
      this.deploymentRepository
        .listRunning()
        .map((deployment) => deployment.containerName)
        .filter((value): value is string => Boolean(value))
    );

    const managedContainers = await this.dockerRuntimeService.listManagedContainers();
    for (const containerName of managedContainers) {
      if (!activeNames.has(containerName)) {
        await this.dockerRuntimeService.stopAndRemoveContainer(containerName);
      }
    }
  }
}
