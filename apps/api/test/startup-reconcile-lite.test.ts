import { describe, expect, it, vi } from 'vitest';

import { StartupReconcileService } from '../src/services/startup-reconcile-service.js';
import { AppError } from '../src/utils/errors.js';

describe('StartupReconcileService', () => {
  it('does not force-fail running deployments when Docker inspection errors', async () => {
    const forceFail = vi.fn();
    const waitForAdmin = vi.fn();
    const applyRoutes = vi.fn();

    const startupReconcileService = new StartupReconcileService(
      {
        ensureSeedProject: () => {}
      } as never,
      {
        listByStatuses: () => [],
        listRunning: () =>
          [
            {
              id: 'dep_running',
              containerName: 'brimble-app-dep-running'
            }
          ] as never[]
      } as never,
      {
        forceFail
      } as never,
      {
        appendSystem: vi.fn()
      } as never,
      {
        containerExists: async () => {
          throw new AppError({
            code: 'VALIDATION_ERROR',
            message: 'Failed to inspect container brimble-app-dep-running'
          });
        }
      } as never,
      {
        waitForAdmin,
        applyRoutes
      } as never
    );

    await expect(startupReconcileService.reconcile()).rejects.toThrow(
      'Failed to inspect container brimble-app-dep-running'
    );
    expect(forceFail).not.toHaveBeenCalled();
    expect(waitForAdmin).not.toHaveBeenCalled();
    expect(applyRoutes).not.toHaveBeenCalled();
  });

  it('fails startup reconciliation when listing managed containers fails', async () => {
    const startupReconcileService = new StartupReconcileService(
      {
        ensureSeedProject: () => {}
      } as never,
      {
        listByStatuses: () => [],
        listRunning: () => []
      } as never,
      {
        forceFail: vi.fn()
      } as never,
      {
        appendSystem: vi.fn()
      } as never,
      {
        containerExists: async () => true,
        listManagedContainers: async () => {
          throw new AppError({
            code: 'VALIDATION_ERROR',
            message: 'Failed to list managed containers'
          });
        }
      } as never,
      {
        waitForAdmin: async () => {},
        applyRoutes: async () => {}
      } as never
    );

    await expect(startupReconcileService.reconcile()).rejects.toThrow(
      'Failed to list managed containers'
    );
  });
});
