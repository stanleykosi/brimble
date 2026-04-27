import { describe, expect, it, vi } from 'vitest';

import { QueueService } from '../src/services/queue-service.js';

describe('QueueService', () => {
  it('respects PIPELINE_MAX_CONCURRENCY when draining deployments', async () => {
    const pending = [{ id: 'dep-1' }, { id: 'dep-2' }, { id: 'dep-3' }];
    const releaseById = new Map<string, () => void>();
    const started: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const queueService = new QueueService(
      {
        claimNextPending: vi.fn(() => pending.shift() ?? null)
      } as never,
      {
        processDeployment: vi.fn(async (deploymentId: string) => {
          started.push(deploymentId);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);

          await new Promise<void>((resolve) => {
            releaseById.set(deploymentId, () => {
              inFlight -= 1;
              resolve();
            });
          });
        })
      } as never,
      2
    );

    queueService.kick();

    await vi.waitFor(() => {
      expect(started).toEqual(['dep-1', 'dep-2']);
    });
    expect(maxInFlight).toBe(2);

    releaseById.get('dep-1')?.();

    await vi.waitFor(() => {
      expect(started).toEqual(['dep-1', 'dep-2', 'dep-3']);
    });

    releaseById.get('dep-2')?.();
    releaseById.get('dep-3')?.();

    await vi.waitFor(() => {
      expect(inFlight).toBe(0);
    });
    expect(maxInFlight).toBe(2);
  });
});
