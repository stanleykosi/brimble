import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createTestConfig } from './helpers.js';

describe('startup request gate', () => {
  it('allows health checks but rejects API requests until startup reconciliation finishes', async () => {
    const { config, cleanup } = await createTestConfig();
    const deploymentService = {
      listDeployments: vi.fn(() => [])
    } as never;
    const app = await buildApp({
      config,
      deploymentService,
      deploymentEventService: {
        getLatestSequence: () => 0,
        list: () => [],
        subscribe: () => () => {}
      } as never,
      queueService: {
        kick: () => {}
      } as never,
      startupState: {
        isReady: false
      }
    });

    try {
      const healthResponse = await app.inject({
        method: 'GET',
        url: '/api/health'
      });
      const configResponse = await app.inject({
        method: 'GET',
        url: '/api/public-config'
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(configResponse.statusCode).toBe(503);
      expect(configResponse.json().error.message).toBe('API is still completing startup reconciliation');
    } finally {
      await app.close();
      await cleanup();
    }
  });
});
