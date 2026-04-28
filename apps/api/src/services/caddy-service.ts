import type { DeploymentDetail } from '@brimble/contracts';

import type { AppConfig } from '../config/env.js';
import { DeploymentRepository } from '../repositories/deployment-repository.js';
import { AppError } from '../utils/errors.js';
import { buildDesiredCaddyConfig } from './caddy-config.js';
import { getPrimaryIngressHost } from './ingress-hosts.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReachableThroughCaddy(response: Response): boolean {
  return response.status < 500;
}

function getHealthcheckTargets(
  config: Pick<AppConfig, 'CONTROL_PLANE_PUBLIC_URL'>,
  deployment: DeploymentDetail
): Array<{
  url: string;
  headers?: Record<string, string>;
}> {
  if (deployment.routeMode === 'hostname' && deployment.routeHost) {
    return [
      {
        url: 'http://caddy/healthz',
        headers: {
          Host: deployment.routeHost
        }
      },
      {
        url: 'http://caddy/',
        headers: {
          Host: deployment.routeHost
        }
      }
    ];
  }

  const basePath = deployment.routePath ?? `/apps/${deployment.slug}`;
  const ingressHost = getPrimaryIngressHost(config);
  return [
    {
      url: `http://caddy${basePath}/healthz`,
      headers: {
        Host: ingressHost
      }
    },
    {
      url: `http://caddy${basePath}/`,
      headers: {
        Host: ingressHost
      }
    }
  ];
}

export class CaddyService {
  constructor(
    private readonly config: AppConfig,
    private readonly deploymentRepository: DeploymentRepository
  ) {}

  async waitForAdmin(): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.config.DEPLOY_HEALTHCHECK_TIMEOUT_MS) {
      try {
        const response = await fetch(`${this.config.CADDY_ADMIN_URL.replace(/\/$/, '')}/config/`, {
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          return;
        }
      } catch {}

      await sleep(this.config.DEPLOY_HEALTHCHECK_INTERVAL_MS);
    }

    throw new AppError({
      code: 'CADDY_LOAD_FAILED',
      message: 'Caddy admin API did not become reachable in time'
    });
  }

  async applyRoutes(extraDeployments: DeploymentDetail[] = []): Promise<void> {
    const currentActive = this.deploymentRepository.listByStatuses(['deploying', 'running']);
    const deduped = new Map<string, DeploymentDetail>();

    for (const deployment of [...currentActive, ...extraDeployments]) {
      if (
        deployment.containerName &&
        deployment.internalPort &&
        (deployment.routeMode === 'path' || deployment.routeHost)
      ) {
        deduped.set(deployment.id, deployment);
      }
    }

    const document = buildDesiredCaddyConfig(this.config, [...deduped.values()]);
    let response: Response;

    try {
      response = await fetch(`${this.config.CADDY_ADMIN_URL.replace(/\/$/, '')}/load`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(document)
      });
    } catch (error) {
      throw new AppError({
        code: 'CADDY_LOAD_FAILED',
        message: 'Failed to load desired Caddy config',
        details: {
          cause: error instanceof Error ? error.message : String(error)
        },
        cause: error
      });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new AppError({
        code: 'CADDY_LOAD_FAILED',
        message: 'Failed to load desired Caddy config',
        details: {
          status: response.status,
          body: text
        }
      });
    }
  }

  async waitForDeployment(deployment: DeploymentDetail): Promise<void> {
    const startedAt = Date.now();
    const targets = getHealthcheckTargets(this.config, deployment);

    while (Date.now() - startedAt < this.config.DEPLOY_HEALTHCHECK_TIMEOUT_MS) {
      for (const target of targets) {
        try {
          const response = await fetch(target.url, {
            signal: AbortSignal.timeout(5000),
            headers: target.headers,
            redirect: 'manual'
          });

          if (isReachableThroughCaddy(response)) {
            return;
          }
        } catch {}
      }

      await sleep(this.config.DEPLOY_HEALTHCHECK_INTERVAL_MS);
    }

    throw new AppError({
      code: 'HEALTHCHECK_TIMEOUT',
      message: `Deployment ${deployment.id} did not become reachable through Caddy`
    });
  }
}
