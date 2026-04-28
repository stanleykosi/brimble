import { describe, expect, it } from 'vitest';

import { StartupReconcileService } from '../src/services/startup-reconcile-service.js';
import { createGitPendingDeploymentInput, createTestRepositories } from './helpers.js';

describe('StartupReconcileService', () => {
  it('marks interrupted deployments as failed', async () => {
    const repos = await createTestRepositories();

    try {
      const deployment = repos.deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

      const startupReconcileService = new StartupReconcileService(
        repos.projectRepository,
        repos.deploymentRepository,
        repos.deploymentService,
        repos.deploymentEventService,
        {
          containerExists: async () => false,
          listManagedContainers: async () => [],
          stopAndRemoveContainer: async () => {}
        },
        {
          waitForAdmin: async () => {},
          applyRoutes: async () => {}
        }
      );

      await startupReconcileService.reconcile();

      const updated = repos.deploymentService.getDeployment(deployment.id);
      expect(updated.status).toBe('failed');

      const events = repos.deploymentEventService.list(deployment.id);
      expect(
        events.some(
          (event) =>
            event.eventType === 'system' &&
            'code' in event.payload &&
            event.payload.code === 'PIPELINE_INTERRUPTED_BY_RESTART'
        )
      ).toBe(true);
    } finally {
      await repos.cleanup();
    }
  });

  it('waits for caddy before reloading routes during startup reconciliation', async () => {
    const repos = await createTestRepositories();

    try {
      const calls: string[] = [];
      const deployment = repos.deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

      repos.deploymentService.transitionStatus(deployment.id, 'building', {
        substage: 'source_fetching'
      });
      repos.deploymentService.transitionStatus(deployment.id, 'deploying', {
        substage: 'container_starting',
        patch: {
          containerName: 'brimble-app-deployment',
          containerId: 'container-123',
          internalPort: 3000
        }
      });
      repos.deploymentService.transitionStatus(deployment.id, 'running', {
        substage: 'complete'
      });

      const startupReconcileService = new StartupReconcileService(
        repos.projectRepository,
        repos.deploymentRepository,
        repos.deploymentService,
        repos.deploymentEventService,
        {
          containerExists: async () => true,
          listManagedContainers: async () => [],
          stopAndRemoveContainer: async () => {}
        },
        {
          waitForAdmin: async () => {
            calls.push('waitForAdmin');
          },
          applyRoutes: async () => {
            calls.push('applyRoutes');
          }
        }
      );

      await startupReconcileService.reconcile();

      expect(calls).toEqual(['waitForAdmin', 'applyRoutes']);
    } finally {
      await repos.cleanup();
    }
  });
});
