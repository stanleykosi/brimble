import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { FormData, File } from 'formdata-node';
import type { DeploymentEvent } from '@brimble/contracts';
import type { Response as InjectResponse } from 'light-my-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { DeploymentEventService } from '../src/services/deployment-event-service.js';
import type { QueueService } from '../src/services/queue-service.js';
import { createGitPendingDeploymentInput, createTestRepositories, encodeFormData } from './helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

async function createTestApp() {
  const repos = await createTestRepositories();
  cleanups.push(repos.cleanup);
  const app = await buildApp({
    config: repos.config,
    deploymentService: repos.deploymentService,
    deploymentEventService: repos.deploymentEventService,
    queueService: { kick() {} } as QueueService
  });
  cleanups.push(async () => {
    await app.close();
  });
  return { app, ...repos };
}

async function createStreamTestApp(
  deploymentEventService: Pick<DeploymentEventService, 'getLatestSequence' | 'list' | 'subscribe'>
) {
  const repos = await createTestRepositories();
  cleanups.push(repos.cleanup);

  const deployment = repos.deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

  const app = await buildApp({
    config: repos.config,
    deploymentService: repos.deploymentService,
    deploymentEventService: deploymentEventService as DeploymentEventService,
    queueService: { kick() {} } as QueueService
  });

  cleanups.push(async () => {
    await app.close();
  });

  return { app, deployment };
}

async function readStreamUntil(response: InjectResponse, pattern: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let buffer = '';
    const stream = response.stream();

    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');

      if (buffer.includes(pattern)) {
        stream.destroy();
        response.raw.res.destroy();
        resolve(buffer);
      }
    });

    stream.on('close', () => {
      resolve(buffer);
    });
    stream.on('error', reject);
  });
}

describe('deployment API', () => {
  it('rejects git deployments without a gitUrl', async () => {
    const { app } = await createTestApp();
    const formData = new FormData();
    formData.set('sourceType', 'git');
    const encoded = encodeFormData(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/deployments',
      headers: encoded.headers,
      payload: encoded.payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Invalid deployment request');
  });

  it('rejects archive deployments with unsupported extensions', async () => {
    const { app, config } = await createTestApp();
    const formData = new FormData();
    formData.set('sourceType', 'archive');
    formData.set(
      'archiveFile',
      new File([Buffer.from('hello')], 'sample.txt', {
        type: 'text/plain'
      })
    );
    const encoded = encodeFormData(formData);

    const response = await app.inject({
      method: 'POST',
      url: '/api/deployments',
      headers: encoded.headers,
      payload: encoded.payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Unsupported archive format');

    const incomingRoot = path.join(config.STORAGE_ROOT, 'uploads', '_incoming');
    const entries = await readdir(incomingRoot).catch(() => []);
    expect(entries).toHaveLength(0);
  });

  it('replays SSE events after Last-Event-ID', async () => {
    const { app, deploymentService, deploymentEventService } = await createTestApp();
    const deployment = deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

    deploymentEventService.appendLog(deployment.id, 'prepare', 'stdout', {
      message: 'first event',
      chunk: false
    });
    deploymentEventService.appendLog(deployment.id, 'prepare', 'stdout', {
      message: 'second event',
      chunk: false
    });

    const response = (await app.inject({
      method: 'GET',
      url: `/api/deployments/${deployment.id}/events/stream`,
      headers: {
        'Last-Event-ID': '1'
      },
      payloadAsStream: true,
      simulate: {
        end: true,
        split: false,
        error: false,
        close: true
      }
    })) as InjectResponse;

    const text = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const stream = response.stream();

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');

        if (buffer.includes('second event')) {
          stream.destroy();
          resolve(buffer);
        }
      });

      stream.on('close', () => {
        resolve(buffer);
      });
      stream.on('error', reject);
    });

    expect(response.statusCode).toBe(200);
    expect(text).toContain('id: 2');
    expect(text).toContain('second event');
  });

  it('pages full persisted event history through SSE replay', async () => {
    const { app, deploymentService, deploymentEventService } = await createTestApp();
    const deployment = deploymentService.createPendingDeployment(createGitPendingDeploymentInput());

    for (let index = 0; index < 2504; index += 1) {
      deploymentEventService.appendLog(deployment.id, 'build', 'stdout', {
        message: `event ${index + 1}`,
        chunk: false
      });
    }

    const historyResponse = await app.inject({
      method: 'GET',
      url: `/api/deployments/${deployment.id}/events`
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().items).toHaveLength(500);
    expect(historyResponse.json().nextAfter).toBe(500);

    const response = (await app.inject({
      method: 'GET',
      url: `/api/deployments/${deployment.id}/events/stream?after=500`,
      payloadAsStream: true,
      simulate: {
        end: true,
        split: false,
        error: false,
        close: true
      }
    })) as InjectResponse;

    const text = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const stream = response.stream();

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');

        if (buffer.includes('event 2504')) {
          stream.destroy();
          resolve(buffer);
        }
      });

      stream.on('close', () => {
        resolve(buffer);
      });
      stream.on('error', reject);
    });

    expect(response.statusCode).toBe(200);
    expect(text).toContain('id: 2505');
    expect(text).toContain('event 2504');
    expect((text.match(/event: deployment\.event/g) ?? []).length).toBe(2005);
  });

  it('delivers events appended while the stream is replaying persisted history', async () => {
    const calls: string[] = [];
    const historicalEvent: DeploymentEvent = {
      sequence: 1,
      eventType: 'log',
      phase: 'build',
      stream: 'stdout',
      payload: {
        message: 'persisted replay event',
        chunk: false
      },
      createdAt: new Date().toISOString()
    };
    const concurrentEvent: DeploymentEvent = {
      sequence: 2,
      eventType: 'log',
      phase: 'build',
      stream: 'stdout',
      payload: {
        message: 'event emitted during stream setup',
        chunk: false
      },
      createdAt: new Date().toISOString()
    };
    let subscriber: ((event: DeploymentEvent) => void) | undefined;
    let emittedDuringReplay = false;

    const { app, deployment } = await createStreamTestApp({
      subscribe: (_deploymentId, callback) => {
        calls.push('subscribe');
        subscriber = callback;
        return () => {
          calls.push('unsubscribe');
        };
      },
      getLatestSequence: () => {
        calls.push('latest');
        return historicalEvent.sequence;
      },
      list: (_deploymentId, after) => {
        calls.push(`list:${after}`);

        if (!emittedDuringReplay) {
          emittedDuringReplay = true;
          subscriber?.(concurrentEvent);
        }

        return after === 0 ? [historicalEvent] : [];
      }
    });

    const response = (await app.inject({
      method: 'GET',
      url: `/api/deployments/${deployment.id}/events/stream`,
      payloadAsStream: true,
      simulate: {
        end: true,
        split: false,
        error: false,
        close: true
      }
    })) as InjectResponse;

    const text = await readStreamUntil(response, 'event emitted during stream setup');

    expect(response.statusCode).toBe(200);
    expect(text).toContain('persisted replay event');
    expect(text).toContain('event emitted during stream setup');
    expect(calls.indexOf('subscribe')).toBeLessThan(calls.indexOf('list:0'));
  });

  it('cleans up SSE subscriptions when the client disconnects', async () => {
    const unsubscribe = vi.fn();
    const liveEvent: DeploymentEvent = {
      sequence: 1,
      eventType: 'log',
      phase: 'build',
      stream: 'stdout',
      payload: {
        message: 'disconnect cleanup event',
        chunk: false
      },
      createdAt: new Date().toISOString()
    };

    const { app, deployment } = await createStreamTestApp({
      subscribe: (_deploymentId, callback) => {
        setTimeout(() => {
          callback(liveEvent);
        }, 0);

        return unsubscribe;
      },
      getLatestSequence: () => 0,
      list: () => []
    });

    const response = (await app.inject({
      method: 'GET',
      url: `/api/deployments/${deployment.id}/events/stream`,
      payloadAsStream: true,
      simulate: {
        end: true,
        split: false,
        error: false,
        close: true
      }
    })) as InjectResponse;

    await readStreamUntil(response, 'disconnect cleanup event');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
