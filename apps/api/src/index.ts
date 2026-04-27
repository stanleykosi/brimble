import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDatabase } from './db/database.js';
import { DeploymentEventRepository } from './repositories/deployment-event-repository.js';
import { DeploymentRepository } from './repositories/deployment-repository.js';
import { ProjectRepository } from './repositories/project-repository.js';
import { CaddyService } from './services/caddy-service.js';
import { DeploymentEventService } from './services/deployment-event-service.js';
import { DeploymentService } from './services/deployment-service.js';
import { DockerRuntimeService } from './services/docker-runtime-service.js';
import { PipelineService } from './services/pipeline-service.js';
import { QueueService } from './services/queue-service.js';
import { RailpackService } from './services/railpack-service.js';
import { SourceService } from './services/source-service.js';
import { StartupReconcileService } from './services/startup-reconcile-service.js';

async function main(): Promise<void> {
  const config = loadConfig();

  await mkdir(path.join(config.STORAGE_ROOT, 'uploads'), { recursive: true });
  await mkdir(path.join(config.STORAGE_ROOT, 'workspaces'), { recursive: true });

  const db = await createDatabase(config);
  const projectRepository = new ProjectRepository(db);
  const deploymentRepository = new DeploymentRepository(db);
  const eventRepository = new DeploymentEventRepository(db);
  const eventService = new DeploymentEventService(eventRepository);
  const deploymentService = new DeploymentService(
    config,
    projectRepository,
    deploymentRepository,
    eventService
  );
  const sourceService = new SourceService(config, eventService);
  const railpackService = new RailpackService(config, eventService);
  const dockerRuntimeService = new DockerRuntimeService(config, eventService);
  const caddyService = new CaddyService(config, deploymentRepository);
  const pipelineService = new PipelineService(
    deploymentService,
    eventService,
    sourceService,
    railpackService,
    dockerRuntimeService,
    caddyService
  );
  const queueService = new QueueService(
    deploymentService,
    pipelineService,
    config.PIPELINE_MAX_CONCURRENCY
  );
  const startupReconcileService = new StartupReconcileService(
    projectRepository,
    deploymentRepository,
    deploymentService,
    eventService,
    dockerRuntimeService,
    caddyService
  );
  const startupState = {
    isReady: false
  };

  projectRepository.ensureSeedProject();

  const app = await buildApp({
    config,
    deploymentService,
    deploymentEventService: eventService,
    queueService,
    startupState
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  await app.listen({
    host: '0.0.0.0',
    port: config.APP_PORT
  });

  try {
    await startupReconcileService.reconcile();
    startupState.isReady = true;
    queueService.kick();
  } catch (error) {
    app.log.error({ err: error }, 'Startup reconciliation failed');
    await app.close();
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
