import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  createDeploymentFieldsSchema,
  deploymentEventsQuerySchema,
  listDeploymentsQuerySchema,
  sourceTypeSchema,
  type DeploymentEvent
} from '@brimble/contracts';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';

import type { AppConfig } from './config/env.js';
import { toPublicConfig } from './config/env.js';
import { AppError, toAppError } from './utils/errors.js';
import {
  hasAcceptedArchiveExtension,
  moveFile,
  sanitizeFilename,
  writeStreamToFile
} from './utils/filesystem.js';
import { DeploymentEventService } from './services/deployment-event-service.js';
import { DeploymentService } from './services/deployment-service.js';
import { QueueService } from './services/queue-service.js';

type ApiDeploymentService = Pick<
  DeploymentService,
  | 'listDeployments'
  | 'getDeployment'
  | 'planPendingDeployment'
  | 'persistPendingDeployment'
>;
type ApiDeploymentEventService = Pick<
  DeploymentEventService,
  'list' | 'getLatestSequence' | 'subscribe'
>;
type ApiQueueService = Pick<QueueService, 'kick'>;

export interface ApiContext {
  config: AppConfig;
  deploymentService: ApiDeploymentService;
  deploymentEventService: ApiDeploymentEventService;
  queueService: ApiQueueService;
  startupState?: {
    isReady: boolean;
  };
}

const EVENT_STREAM_REPLAY_PAGE_SIZE = 1000;

function parseEventStreamAfter(
  request: FastifyRequest<{ Querystring: { after?: string } }>
): number {
  const queryAfter = Number.parseInt(request.query.after ?? '0', 10);
  const headerAfter = Number.parseInt(String(request.headers['last-event-id'] ?? '0'), 10);

  return [queryAfter, headerAfter].filter(Number.isFinite).reduce((max, value) => Math.max(max, value), 0);
}

function formatSseEvent(event: string, id: number, payload: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function replayDeploymentEvents(
  eventService: ApiDeploymentEventService,
  deploymentId: string,
  after: number,
  through: number,
  write: (event: DeploymentEvent) => boolean
): number {
  let nextAfter = after;
  let lastSentSequence = after;

  while (lastSentSequence < through) {
    const history = eventService.list(deploymentId, nextAfter, EVENT_STREAM_REPLAY_PAGE_SIZE);
    if (history.length === 0) {
      return lastSentSequence;
    }

    for (const event of history) {
      if (event.sequence > through) {
        return lastSentSequence;
      }

      if (!write(event)) {
        return lastSentSequence;
      }

      lastSentSequence = event.sequence;
    }

    if (history.length < EVENT_STREAM_REPLAY_PAGE_SIZE) {
      return lastSentSequence;
    }

    nextAfter = lastSentSequence;
  }

  return lastSentSequence;
}

async function readCreateParts(
  request: FastifyRequest,
  config: AppConfig
): Promise<{
  fields: Record<string, string>;
  archive: { filename: string; tempPath: string } | null;
  cleanup: () => Promise<void>;
}> {
  const tempRoot = path.join(config.STORAGE_ROOT, 'uploads', '_incoming', randomUUID());
  await mkdir(tempRoot, { recursive: true });

  const fields: Record<string, string> = {};
  let archive: { filename: string; tempPath: string } | null = null;

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        archive = await persistIncomingArchive(part, tempRoot, config);
        continue;
      }

      fields[part.fieldname] = String(part.value);
    }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    fields,
    archive,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };
}

async function persistIncomingArchive(
  part: MultipartFile,
  tempRoot: string,
  config: AppConfig
): Promise<{ filename: string; tempPath: string }> {
  if (part.fieldname !== 'archiveFile') {
    part.file.resume();
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Unexpected file field ${part.fieldname}`,
      statusCode: 400
    });
  }

  const filename = sanitizeFilename(part.filename ?? 'source.bin');
  const tempPath = path.join(tempRoot, filename);
  await writeStreamToFile(part.file, tempPath, config.UPLOAD_MAX_BYTES);

  if (!hasAcceptedArchiveExtension(filename)) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `Unsupported archive format: ${filename}`,
      statusCode: 400
    });
  }

  return {
    filename,
    tempPath
  };
}

async function sendError(reply: FastifyReply, error: unknown): Promise<FastifyReply> {
  const appError = toAppError(error);

  return reply.code(appError.statusCode).send({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details ?? null
    }
  });
}

export async function buildApp(context: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: context.config.UPLOAD_MAX_BYTES
    }
  });

  app.setErrorHandler(async (error, _request, reply) => {
    await sendError(reply, error);
  });

  app.addHook('onRequest', async (request) => {
    if (request.raw.url?.startsWith('/api/health')) {
      return;
    }

    if (context.startupState && !context.startupState.isReady) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'API is still completing startup reconciliation',
        statusCode: 503
      });
    }
  });

  app.get('/api/health', async () => {
    return {
      status: 'ok' as const,
      time: new Date().toISOString(),
      version: '0.1.0'
    };
  });

  app.get('/api/public-config', async () => {
    return toPublicConfig(context.config);
  });

  app.get('/api/deployments', async (request, reply) => {
    const parsed = listDeploymentsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return await sendError(
        reply,
        new AppError({
          code: 'VALIDATION_ERROR',
          message: 'Invalid deployment list filters',
          statusCode: 400,
          details: {
            issues: parsed.error.flatten()
          }
        })
      );
    }

    return {
      items: context.deploymentService.listDeployments(parsed.data)
    };
  });

  app.post('/api/deployments', async (request, reply) => {
    const parts = await readCreateParts(request, context.config);

    try {
      const parsed = createDeploymentFieldsSchema.safeParse({
        sourceType: parts.fields.sourceType,
        gitUrl: parts.fields.gitUrl,
        routeMode: parts.fields.routeMode
      });

      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'Invalid deployment request',
          statusCode: 400,
          details: {
            issues: parsed.error.flatten()
          }
        });
      }

      if (parsed.data.sourceType === 'git' && !parsed.data.gitUrl?.startsWith('https://')) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'gitUrl must be a public https:// URL',
          statusCode: 400,
          details: {
            field: 'gitUrl'
          }
        });
      }

      if (parsed.data.sourceType === 'archive' && !parts.archive) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'archiveFile is required when sourceType=archive',
          statusCode: 400,
          details: {
            field: 'archiveFile'
          }
        });
      }

      if (parsed.data.sourceType === 'git' && parts.archive) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'archiveFile is not allowed when sourceType=git',
          statusCode: 400,
          details: {
            field: 'archiveFile'
          }
        });
      }

      const sourceType = sourceTypeSchema.parse(parsed.data.sourceType);
      const plannedDeployment = context.deploymentService.planPendingDeployment({
        fields: parsed.data,
        sourceType,
        sourceGitUrl: sourceType === 'git' ? parsed.data.gitUrl ?? null : null,
        sourceArchiveFilename: sourceType === 'archive' ? parts.archive?.filename ?? null : null,
        sourceArchivePath: null
      });

      if (sourceType === 'archive' && parts.archive) {
        const finalArchivePath = path.join(context.config.STORAGE_ROOT, 'uploads', plannedDeployment.id, parts.archive.filename);
        await moveFile(parts.archive.tempPath, finalArchivePath);

        try {
          const deployment = context.deploymentService.persistPendingDeployment({
            ...plannedDeployment,
            sourceArchivePath: finalArchivePath
          });
          context.queueService.kick();
          return reply.code(202).send(deployment);
        } catch (error) {
          await rm(path.dirname(finalArchivePath), { recursive: true, force: true });
          throw error;
        }
      }

      const deployment = context.deploymentService.persistPendingDeployment(plannedDeployment);
      context.queueService.kick();
      return reply.code(202).send(deployment);
    } finally {
      await parts.cleanup();
    }
  });

  app.get('/api/deployments/:id', async (request, reply) => {
    try {
      return context.deploymentService.getDeployment((request.params as { id: string }).id);
    } catch (error) {
      return await sendError(reply, error);
    }
  });

  app.get('/api/deployments/:id/events', async (request, reply) => {
    try {
      const deploymentId = (request.params as { id: string }).id;
      context.deploymentService.getDeployment(deploymentId);

      const parsed = deploymentEventsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'Invalid event history query',
          statusCode: 400,
          details: {
            issues: parsed.error.flatten()
          }
        });
      }

      const items = context.deploymentEventService.list(
        deploymentId,
        parsed.data.after,
        parsed.data.limit
      );

      return {
        items,
        nextAfter: items.at(-1)?.sequence ?? parsed.data.after
      };
    } catch (error) {
      return await sendError(reply, error);
    }
  });

  app.get('/api/deployments/:id/events/stream', async (request, reply) => {
    const deploymentId = (request.params as { id: string }).id;

    try {
      context.deploymentService.getDeployment(deploymentId);
      const after = parseEventStreamAfter(request as FastifyRequest<{ Querystring: { after?: string } }>);

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });

      let streamClosed = false;
      let replayComplete = false;
      let lastSentSequence = after;
      let heartbeat: NodeJS.Timeout | null = null;
      let unsubscribe = () => {};
      const bufferedEvents: DeploymentEvent[] = [];

      const cleanup = () => {
        if (streamClosed) {
          return;
        }

        streamClosed = true;

        if (heartbeat) {
          clearInterval(heartbeat);
        }

        unsubscribe();
        request.raw.off('aborted', cleanup);
        reply.raw.off('close', cleanup);
        reply.raw.off('error', cleanup);
      };

      const writeChunk = (chunk: string): boolean => {
        if (streamClosed) {
          return false;
        }

        try {
          reply.raw.write(chunk);
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      const writeEvent = (event: DeploymentEvent): boolean => {
        if (event.sequence <= lastSentSequence) {
          return true;
        }

        const wrote = writeChunk(formatSseEvent('deployment.event', event.sequence, event));
        if (wrote) {
          lastSentSequence = event.sequence;
        }

        return wrote;
      };

      request.raw.on('aborted', cleanup);
      reply.raw.on('close', cleanup);
      reply.raw.on('error', cleanup);

      unsubscribe = context.deploymentEventService.subscribe(deploymentId, (event) => {
        if (streamClosed) {
          return;
        }

        if (!replayComplete) {
          bufferedEvents.push(event);
          return;
        }

        writeEvent(event);
      });

      const replayThrough = context.deploymentEventService.getLatestSequence(deploymentId);
      lastSentSequence = replayDeploymentEvents(
        context.deploymentEventService,
        deploymentId,
        after,
        replayThrough,
        writeEvent
      );
      replayComplete = true;

      bufferedEvents.sort((left, right) => left.sequence - right.sequence);
      for (const event of bufferedEvents) {
        if (!writeEvent(event)) {
          break;
        }
      }

      if (streamClosed) {
        return;
      }

      heartbeat = setInterval(() => {
        writeChunk(
          `event: deployment.heartbeat\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`
        );
      }, 10000);
    } catch (error) {
      if (!reply.sent) {
        await sendError(reply, error);
      }
    }
  });

  return app;
}
