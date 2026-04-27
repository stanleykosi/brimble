import { DeploymentService } from './deployment-service.js';
import { PipelineService } from './pipeline-service.js';

export class QueueService {
  private activeWorkers = 0;

  constructor(
    private readonly deploymentService: Pick<DeploymentService, 'claimNextPending'>,
    private readonly pipelineService: PipelineService,
    private readonly maxConcurrency = 1
  ) {}

  kick(): void {
    this.fillWorkers();
  }

  private fillWorkers(): void {
    while (this.activeWorkers < this.maxConcurrency) {
      const next = this.deploymentService.claimNextPending();

      if (!next) {
        return;
      }

      this.activeWorkers += 1;
      void this.runWorker(next.id);
    }
  }

  private async runWorker(initialDeploymentId: string): Promise<void> {
    let currentDeploymentId: string | null = initialDeploymentId;

    try {
      while (currentDeploymentId) {
        try {
          await this.pipelineService.processDeployment(currentDeploymentId);
        } catch {
          // The pipeline already persists failure state and diagnostics.
        }

        currentDeploymentId = this.deploymentService.claimNextPending()?.id ?? null;
      }
    } finally {
      this.activeWorkers -= 1;
      this.fillWorkers();
    }
  }
}
