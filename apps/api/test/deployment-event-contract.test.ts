import { describe, expect, it } from 'vitest';

import { deploymentEventSchema, deploymentEventsResponseSchema } from '@brimble/contracts';

describe('deployment event contracts', () => {
  it('preserves system payload fields when parsing deployment events', () => {
    const event = deploymentEventSchema.parse({
      sequence: 12,
      eventType: 'system',
      phase: 'system',
      stream: 'meta',
      payload: {
        code: 'CADDY_ROUTE_CLEANUP_FAILED',
        message: 'Failed to rebuild Caddy routes during failure cleanup',
        data: {
          deploymentId: 'dep_123'
        }
      },
      createdAt: new Date().toISOString()
    });

    expect(event.payload).toEqual({
      code: 'CADDY_ROUTE_CLEANUP_FAILED',
      message: 'Failed to rebuild Caddy routes during failure cleanup',
      data: {
        deploymentId: 'dep_123'
      }
    });
  });

  it('preserves system payload fields when parsing deployment event pages', () => {
    const response = deploymentEventsResponseSchema.parse({
      items: [
        {
          sequence: 13,
          eventType: 'system',
          phase: 'system',
          stream: 'meta',
          payload: {
            code: 'PIPELINE_INTERRUPTED_BY_RESTART',
            message: 'Deployment was interrupted because the backend service restarted',
            data: {
              deploymentId: 'dep_456'
            }
          },
          createdAt: new Date().toISOString()
        }
      ],
      nextAfter: 13
    });

    expect(response.items[0]?.payload).toEqual({
      code: 'PIPELINE_INTERRUPTED_BY_RESTART',
      message: 'Deployment was interrupted because the backend service restarted',
      data: {
        deploymentId: 'dep_456'
      }
    });
  });
});
