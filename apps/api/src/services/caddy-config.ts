import type { DeploymentDetail } from '@brimble/contracts';

import type { AppConfig } from '../config/env.js';
import { getIngressHosts } from './ingress-hosts.js';

type CaddyMatch = {
  host: string[];
  path?: string[];
};

type CaddyReverseProxyHandle = {
  handler: 'reverse_proxy';
  upstreams: Array<{ dial: string }>;
};

type CaddyRewriteHandle = {
  handler: 'rewrite';
  strip_path_prefix: string;
};

type CaddyHandle = CaddyReverseProxyHandle | CaddyRewriteHandle;

export type CaddyRoute = {
  match: CaddyMatch[];
  handle: CaddyHandle[];
  terminal: true;
};

export type CaddyConfigDocument = {
  admin: {
    listen: string;
  };
  apps: {
    http: {
      servers: {
        control_plane: {
          listen: string[];
          automatic_https: {
            disable: true;
            disable_redirects: true;
          };
          routes: CaddyRoute[];
        };
      };
    };
  };
};

function reverseProxyHandle(dial: string): CaddyReverseProxyHandle {
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
  if (!deployment.routeHost) {
    throw new Error(`Hostname deployment ${deployment.id} is missing routeHost`);
  }

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
): CaddyConfigDocument {
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
