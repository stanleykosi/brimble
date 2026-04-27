import type { DeploymentDetail } from '@brimble/contracts';

import type { AppConfig } from '../config/env.js';
import { getIngressHosts } from './ingress-hosts.js';

type CaddyRoute = Record<string, unknown>;

function reverseProxyHandle(dial: string): Record<string, unknown> {
  return {
    handler: 'reverse_proxy',
    upstreams: [{ dial }]
  };
}

function buildPathRoute(deployment: DeploymentDetail, ingressHosts: string[]): CaddyRoute {
  const routePath = deployment.routePath ?? `/apps/${deployment.slug}`;
  return {
    match: [
      {
        host: ingressHosts,
        path: [routePath, `${routePath}/*`]
      }
    ],
    handle: [
      {
        handler: 'rewrite',
        strip_path_prefix: routePath
      },
      reverseProxyHandle(`${deployment.containerName}:${deployment.internalPort}`)
    ],
    terminal: true
  };
}

function buildHostnameRoute(deployment: DeploymentDetail): CaddyRoute {
  return {
    match: [
      {
        host: [deployment.routeHost]
      }
    ],
    handle: [reverseProxyHandle(`${deployment.containerName}:${deployment.internalPort}`)],
    terminal: true
  };
}

export function buildDesiredCaddyConfig(
  config: AppConfig,
  runningDeployments: DeploymentDetail[]
): Record<string, unknown> {
  const ingressHosts = getIngressHosts(config);
  const pathRoutes = runningDeployments
    .filter((deployment) => deployment.routeMode === 'path')
    .map((deployment) => buildPathRoute(deployment, ingressHosts));
  const hostnameRoutes = runningDeployments
    .filter((deployment) => deployment.routeMode === 'hostname')
    .map(buildHostnameRoute);

  return {
    admin: {
      listen: '0.0.0.0:2019'
    },
    apps: {
      http: {
        servers: {
          control_plane: {
            listen: [':80'],
            automatic_https: {
              disable: true,
              disable_redirects: true
            },
            routes: [
              {
                match: [
                  {
                    host: ingressHosts,
                    path: ['/api*']
                  }
                ],
                handle: [reverseProxyHandle(`backend:${config.APP_PORT}`)],
                terminal: true
              },
              ...pathRoutes,
              {
                match: [
                  {
                    host: ingressHosts
                  }
                ],
                handle: [reverseProxyHandle('frontend:80')],
                terminal: true
              },
              ...hostnameRoutes
            ]
          }
        }
      }
    }
  };
}
